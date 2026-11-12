import Foundation
import XCTest
@testable import HireShelbyCore

// MARK: - Sleeper

/// Returns at once for short waits (backoff, debounce) and parks long ones (polling, heartbeats) until cancelled,
/// so tests never spin. Records every wait.
final class TestSleeper: Sleeper, @unchecked Sendable {
    private let recorded = Locked<[Double]>([])
    let parkAtOrAbove: Double

    init(parkAtOrAbove: Double = 5) {
        self.parkAtOrAbove = parkAtOrAbove
    }

    var waits: [Double] { recorded.current }

    func sleep(seconds: Double) async throws {
        recorded.withLock { $0.append(seconds) }
        if seconds >= parkAtOrAbove {
            try await Task.sleep(nanoseconds: 1_000_000_000_000)
        }
        await Task.yield()
        try Task.checkCancellation()
    }
}

// MARK: - HTTP

/// Records requests and answers them with a handler.
final class StubHTTP: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (HTTPRequest) async throws -> HTTPResponse
    private let state = Locked<(requests: [HTTPRequest], handler: Handler?)>(([], nil))

    init(_ handler: Handler? = nil) {
        state.withLock { $0.handler = handler }
    }

    var requests: [HTTPRequest] { state.current.requests }

    func setHandler(_ handler: @escaping Handler) {
        state.withLock { $0.handler = handler }
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let handler = state.withLock { value -> Handler? in
            value.requests.append(request)
            return value.handler
        }
        guard let handler else { return .json(404, #"{"error":{"code":"not_found","message":"Route not found"}}"#) }
        return try await handler(request)
    }
}

extension HTTPResponse {
    static func json(_ status: Int, _ body: String, headers: [String: String] = [:]) -> HTTPResponse {
        var headers = headers
        headers["Content-Type"] = "application/json"
        return HTTPResponse(status: status, headers: headers, body: Data(body.utf8))
    }

    static func json<Body: Encodable>(_ status: Int, encoding body: Body) -> HTTPResponse {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return HTTPResponse(status: status, headers: ["Content-Type": "application/json"], body: (try? encoder.encode(body)) ?? Data())
    }

    static func error(_ status: Int, _ code: String, _ message: String = "", headers: [String: String] = [:]) -> HTTPResponse {
        json(status, #"{"error":{"code":"\#(code)","message":"\#(message)"}}"#, headers: headers)
    }
}

extension HTTPRequest {
    var path: String { url.path }

    var query: [String: String] {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, last in last })
    }

    var bearer: String? {
        header("Authorization").flatMap { $0.hasPrefix("Bearer ") ? String($0.dropFirst(7)) : nil }
    }

    var jsonBody: [String: Any]? {
        guard let body else { return nil }
        return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }

    var summary: String { "\(method) \(path)" }
}

// MARK: - Fake API

/// A small in-memory /v1 API with the real one's rules that matter to the SDK: device secrets and access tokens,
/// sessions ending, messages deduplicated by clientId with increasing seqs, paging, read state, uploads, cards,
/// tracking. Faults can be injected per route.
final class FakeAPI: @unchecked Sendable {
    struct Device {
        var id: String
        var secret: String
        var sessionVersion = 1
        var ended = false
        var identity = WireIdentity(userId: nil, name: nil, email: nil, verified: false)
        var metadata: [String: String]?
        var push: [String: Any]?
        var messages: [WireMessage] = []
        var userReadSeq = 0
        var conversationId: String?
        var aiConsent: String?
    }

    enum Fault {
        case status(HTTPResponse)
        case connectionError(URLError.Code)
    }

    private let lock = NSRecursiveLock()
    private var devices: [String: Device] = [:]
    private var tokens: [String: (deviceId: String, version: Int)] = [:]
    private var counter = 0
    private var faults: [String: [Fault]] = [:]
    private(set) var uploads: [String: Data] = [:]
    private(set) var clicks: [String] = []
    private(set) var tracked: [String] = []
    private(set) var logouts: [String] = []
    var trackedEventNames = ["paywall_declined"]
    /// The app turned AI replies on (what `GET /v1/conversation` reports).
    var aiEnabled = false
    let storageHost = "storage.test"

    func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    var allDevices: [Device] { locked { Array(devices.values).sorted { $0.id < $1.id } } }

    /// Makes the next `count` requests to `route` ("POST /v1/messages") fail.
    func fail(_ route: String, with fault: Fault, times count: Int = 1) {
        locked { faults[route, default: []].append(contentsOf: Array(repeating: fault, count: count)) }
    }

    func clearFaults() {
        locked { faults = [:] }
    }

    /// Adds a team reply to a device's conversation.
    @discardableResult
    func reply(to deviceId: String, text: String, byAi: Bool = false, card: WireCard? = nil) -> WireMessage {
        locked {
            var device = devices[deviceId]!
            let message = WireMessage(
                id: UUID().uuidString.lowercased(), seq: device.messages.count + 1, sender: "agent",
                kind: card == nil ? "text" : (card.map { if case .review = $0 { "review" } else { "paywall" } } ?? "text"),
                text: text, card: card, author: WireAuthor(name: "Sam", initial: "S", photoUrl: nil), byAi: byAi,
                createdAt: ISODate.format(Date())
            )
            device.conversationId = device.conversationId ?? UUID().uuidString.lowercased()
            device.messages.append(message)
            devices[deviceId] = device
            return message
        }
    }

    /// Ends a device as the dashboard's "Delete user data" would.
    func deleteDevice(_ deviceId: String) {
        locked { _ = devices.removeValue(forKey: deviceId) }
    }

    /// Expires every access token (the 15 minutes passed).
    func expireTokens() {
        locked { tokens = [:] }
    }

    func handle(_ request: HTTPRequest) async throws -> HTTPResponse {
        let route = "\(request.method) \(routeKey(request.path))"
        if let fault = locked({ () -> Fault? in
            guard var queue = faults[route], !queue.isEmpty else { return nil }
            let first = queue.removeFirst()
            faults[route] = queue
            return first
        }) {
            switch fault {
            case .status(let response): return response
            case .connectionError(let code): throw URLError(code)
            }
        }
        return locked { respond(request) }
    }

    private func routeKey(_ path: String) -> String {
        if path.hasPrefix("/v1/actions/") { return "/v1/actions/:id/click" }
        if path.hasPrefix("/put/") { return "/put" }
        return path
    }

    private func nextId(_ prefix: String) -> String {
        counter += 1
        return "\(prefix)\(counter)"
    }

    private func issueToken(for device: Device) -> String {
        let token = nextId("tok_")
        tokens[token] = (device.id, device.sessionVersion)
        return token
    }

    private func authenticated(_ request: HTTPRequest) -> Device? {
        guard let token = request.bearer, let entry = tokens[token], let device = devices[entry.deviceId],
              !device.ended, device.sessionVersion == entry.version else { return nil }
        return device
    }

    private func conversation(_ device: Device) -> WireConversation? {
        guard let id = device.conversationId else { return nil }
        let lastSeq = device.messages.last?.seq ?? 0
        let unread = device.messages.filter { $0.sender == "agent" && $0.seq > device.userReadSeq }.count
        return WireConversation(id: id, status: "open", lastSeq: lastSeq, userReadSeq: device.userReadSeq, unread: unread)
    }

    private func respond(_ request: HTTPRequest) -> HTTPResponse {
        let unauthorized = HTTPResponse.error(401, "unauthorized", "Access token is missing, invalid or expired")
        let body = request.jsonBody ?? [:]
        switch (request.method, routeKey(request.path)) {
        case ("POST", "/v1/devices"):
            if let token = body["identityToken"] as? String, token.contains("bad") {
                return .error(422, "identity_token_invalid", "Identity token rejected")
            }
            var device = Device(id: nextId("dev_"), secret: nextId("dvs_"))
            if let labels = body["identity"] as? [String: Any] {
                device.identity.userId = labels["userId"] as? String
                device.identity.name = labels["name"] as? String
                device.identity.email = labels["email"] as? String
            }
            if body["identityToken"] != nil {
                device.identity.verified = true
            }
            device.metadata = body["metadata"] as? [String: String]
            device.push = body["push"] as? [String: Any]
            devices[device.id] = device
            let token = issueToken(for: device)
            return .json(201, encoding: DeviceSessionBody(deviceSecret: device.secret, accessToken: token, expiresIn: 900, identity: device.identity))
        case ("POST", "/v1/session/refresh"):
            guard let secret = body["deviceSecret"] as? String,
                  let device = devices.values.first(where: { $0.secret == secret && !$0.ended }) else { return unauthorized }
            return .json(200, #"{"accessToken":"\#(issueToken(for: device))","expiresIn":900}"#)
        case ("POST", "/v1/session/logout"):
            if let secret = body["deviceSecret"] as? String, let id = devices.values.first(where: { $0.secret == secret })?.id {
                devices[id]?.ended = true
                devices[id]?.sessionVersion += 1
                logouts.append(id)
            }
            return HTTPResponse(status: 204)
        default:
            break
        }

        if request.method == "PUT", request.url.host == storageHost {
            uploads[request.path] = request.body ?? Data()
            return HTTPResponse(status: 200)
        }

        guard var device = authenticated(request) else { return unauthorized }
        var deleted = false
        defer { devices[device.id] = deleted ? nil : device }
        switch (request.method, routeKey(request.path)) {
        case ("PATCH", "/v1/device"):
            if let labels = body["identity"] as? [String: Any], let userId = labels["userId"] as? String,
               let current = device.identity.userId, current != userId {
                return .error(409, "identity_mismatch", "This device belongs to another user")
            }
            if let token = body["identityToken"] as? String {
                if token.contains("bad") { return .error(422, "identity_token_invalid", "Identity token rejected") }
                device.identity.verified = true
            }
            if let labels = body["identity"] as? [String: Any] {
                device.identity.userId = (labels["userId"] as? String) ?? device.identity.userId
                device.identity.name = (labels["name"] as? String) ?? device.identity.name
                device.identity.email = (labels["email"] as? String) ?? device.identity.email
            }
            if let metadata = body["metadata"] as? [String: String] { device.metadata = metadata }
            if body.keys.contains("push") { device.push = body["push"] as? [String: Any] }
            return .json(200, encoding: ["identity": device.identity])
        case ("DELETE", "/v1/device"):
            deleted = true
            return .json(200, #"{"deleted":true}"#)
        case ("GET", "/v1/conversation"):
            let query = request.query
            let limit = Int(query["limit"] ?? "") ?? 50
            var page: [WireMessage]
            var hasMore: Bool
            if let after = Int(query["after"] ?? "") {
                let newer = device.messages.filter { $0.seq > after }
                page = Array(newer.prefix(limit))
                hasMore = newer.count > limit
            } else {
                let before = Int(query["before"] ?? "") ?? Int.max
                let older = device.messages.filter { $0.seq < before }
                page = Array(older.suffix(limit))
                hasMore = older.count > limit
            }
            return .json(200, encoding: SyncBody(
                identity: device.identity, sending: WireSending(allowed: true, reason: nil), ai: ai(device),
                conversation: conversation(device), messages: page, hasMore: hasMore
            ))
        case ("POST", "/v1/ai-consent"):
            guard let consent = body["consent"] as? String, ["granted", "declined"].contains(consent) else {
                return .error(400, "validation_failed", "consent: expected granted or declined")
            }
            device.aiConsent = consent
            return .json(200, encoding: ["ai": ai(device)])
        case ("POST", "/v1/messages"):
            let clientId = body["clientId"] as? String ?? ""
            if let existing = device.messages.first(where: { $0.clientId == clientId }) {
                return .json(200, encoding: SendBody(message: existing, conversation: conversation(device)!))
            }
            let text = (body["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let ids = body["attachmentIds"] as? [String] ?? []
            if text.isEmpty && ids.isEmpty { return .error(400, "validation_failed", "body: send text, a photo, or both") }
            device.conversationId = device.conversationId ?? UUID().uuidString.lowercased()
            let message = WireMessage(
                id: UUID().uuidString.lowercased(), seq: device.messages.count + 1, sender: "user", text: text,
                clientId: clientId,
                attachments: ids.map { WireAttachment(id: $0, url: "https://\(storageHost)/get/\($0)", contentType: "image/jpeg", width: 10, height: 10) },
                createdAt: ISODate.format(Date())
            )
            device.messages.append(message)
            device.userReadSeq = message.seq
            return .json(201, encoding: SendBody(message: message, conversation: conversation(device)!))
        case ("POST", "/v1/uploads"):
            let id = UUID().uuidString.lowercased()
            let checksum = body["checksum"] as? String ?? ""
            return .json(201, #"{"attachmentId":"\#(id)","uploadUrl":"https://\#(storageHost)/put/\#(id)","method":"PUT","headers":{"Content-Type":"image/jpeg","x-amz-checksum-sha256":"\#(checksum)"},"expiresIn":900}"#)
        case ("POST", "/v1/read"):
            let seq = body["seq"] as? Int ?? 0
            device.userReadSeq = max(device.userReadSeq, seq)
            return .json(200, #"{"unread":\#(conversation(device)?.unread ?? 0)}"#)
        case ("GET", "/v1/unread"):
            return .json(200, #"{"unread":\#(conversation(device)?.unread ?? 0)}"#)
        case ("POST", "/v1/actions/:id/click"):
            let id = String(request.path.dropFirst("/v1/actions/".count).dropLast("/click".count))
            clicks.append(id)
            return .json(200, #"{"actionClickedAt":"2026-11-12T10:00:00.000Z","first":true}"#)
        case ("GET", "/v1/track/events"):
            let names = trackedEventNames.map { "\"\($0)\"" }.joined(separator: ",")
            return .json(200, #"{"events":[\#(names)],"ttlSeconds":300}"#)
        case ("POST", "/v1/track"):
            tracked.append(body["event"] as? String ?? "")
            return .json(200, #"{"sent":false,"openChat":false}"#)
        default:
            return .error(404, "not_found", "Route not found")
        }
    }

    private struct DeviceSessionBody: Encodable {
        let deviceSecret: String
        let accessToken: String
        let expiresIn: Int
        let identity: WireIdentity
    }

    private func ai(_ device: Device) -> WireAI {
        WireAI(enabled: aiEnabled, consent: device.aiConsent, processors: aiEnabled ? ["OpenRouter", "Anthropic"] : [])
    }

    func aiConsent(of deviceId: String) -> String? {
        locked { devices[deviceId]?.aiConsent }
    }

    private struct SyncBody: Encodable {
        let identity: WireIdentity
        let sending: WireSending
        let ai: WireAI
        let conversation: WireConversation?
        let messages: [WireMessage]
        let hasMore: Bool
    }

    private struct SendBody: Encodable {
        let message: WireMessage
        let conversation: WireConversation
    }
}

// MARK: - WebSocket

/// A scripted WebSocket server: each connection plays the next script.
final class StubWebSocketTransport: WebSocketTransport, @unchecked Sendable {
    enum Step: Sendable {
        case connectFails(WebSocketFailure)
        /// Sends these messages, then ends with `failure` (or stays open when nil).
        case session(messages: [String], then: WebSocketFailure?)
    }

    private let state = Locked<(scripts: [Step], connections: [(url: URL, headers: [String: String])], sent: [String])>(([], [], []))
    private let open = Locked<[Connection]>([])

    init(_ scripts: [Step] = []) {
        state.withLock { $0.scripts = scripts }
    }

    var connections: [(url: URL, headers: [String: String])] { state.current.connections }
    var sent: [String] { state.current.sent }

    /// Drops every open connection, as a network change would.
    func dropAll() {
        for connection in open.withLock({ value -> [Connection] in defer { value = [] }; return value }) {
            connection.drop()
        }
    }

    func connect(url: URL, headers: [String: String]) async throws -> any WebSocketConnection {
        let step = state.withLock { value -> Step in
            value.connections.append((url, headers))
            return value.scripts.isEmpty ? .session(messages: [#"{"type":"ready"}"#], then: nil) : value.scripts.removeFirst()
        }
        switch step {
        case .connectFails(let failure):
            throw failure
        case .session(let messages, let failure):
            let connection = Connection(messages: messages, failure: failure) { [state] text in state.withLock { $0.sent.append(text) } }
            open.withLock { $0.append(connection) }
            return connection
        }
    }

    final class Connection: WebSocketConnection, @unchecked Sendable {
        private let queue: Locked<[String]>
        private let failure: WebSocketFailure?
        private let onSend: @Sendable (String) -> Void
        private let ended = Locked<WebSocketFailure?>(nil)

        init(messages: [String], failure: WebSocketFailure?, onSend: @escaping @Sendable (String) -> Void) {
            queue = Locked(messages)
            self.failure = failure
            self.onSend = onSend
        }

        func receive() async throws -> String {
            if let next = queue.withLock({ $0.isEmpty ? nil : $0.removeFirst() }) { return next }
            if let failure { throw failure }
            // stay open until closed, dropped or cancelled
            while ended.current == nil, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000)
            }
            throw ended.current ?? .closed(code: 1000)
        }

        func send(_ text: String) async throws {
            onSend(text)
        }

        func close() {
            ended.withLock { $0 = $0 ?? .closed(code: 1000) }
        }

        func drop() {
            ended.withLock { $0 = $0 ?? .closed(code: 1006) }
        }
    }
}

// MARK: - Helpers

let testAppId = "app_0123456789abcdefghijKL"

func temporaryDirectory() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("hireshelby-tests-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// Waits until `condition` holds, polling the main actor.
@MainActor
func eventually(timeout: TimeInterval = 5, _ message: String = "condition", _ condition: @MainActor () async -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if await condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
    XCTFail("Timed out waiting for \(message)")
}

func fixture(_ name: String) throws -> Data {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
        throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing fixture \(name)"])
    }
    return try Data(contentsOf: url)
}

/// A client wired to a fake API.
@MainActor
func makeClient(
    api: FakeAPI,
    http: StubHTTP? = nil,
    webSocket: StubWebSocketTransport = StubWebSocketTransport(),
    credentials: InMemoryCredentialStore = InMemoryCredentialStore(),
    directory: URL = temporaryDirectory(),
    sleeper: TestSleeper = TestSleeper(),
    logHandler: HireShelbyLogHandler? = nil
) throws -> HireShelbyClient {
    let transport = http ?? StubHTTP { request in try await api.handle(request) }
    let instant = Backoff(base: 1, maximum: 30, jitter: { 1 })
    return try HireShelbyClient(
        configuration: .init(
            appId: testAppId,
            apiBaseURL: URL(string: "https://api.test")!,
            logLevel: logHandler == nil ? .off : .debug,
            logHandler: logHandler,
            usesRemoteAppearance: false,
            storageDirectory: directory
        ),
        dependencies: .init(
            http: transport,
            webSocket: webSocket,
            credentials: credentials,
            sleeper: sleeper,
            deviceDetails: WireDeviceDetails(model: "iPhone16,1", osVersion: "18.1", appVersion: "1.0 (1)", sdkVersion: HireShelbyVersion.current, locale: "en-US", timezone: "Europe/Berlin"),
            monitorsNetwork: false,
            syncDelay: 0,
            requestBackoff: Backoff(base: 0.1, maximum: 1, jitter: { 1 }),
            outboxBackoff: instant,
            liveBackoff: instant
        )
    )
}
