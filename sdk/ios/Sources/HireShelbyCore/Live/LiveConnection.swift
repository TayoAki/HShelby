import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Transport

/// Why a WebSocket ended.
enum WebSocketFailure: Error, Equatable {
    /// The handshake was refused with 401, or the server closed with 4001 ("reconnect with fresh credentials").
    case unauthorized
    /// Closed with this code (1000 normal, 1001 going away, 1008 policy…).
    case closed(code: Int)
    /// The connection failed or dropped.
    case failed
}

/// One open WebSocket.
protocol WebSocketConnection: Sendable {
    /// The next text message. Throws ``WebSocketFailure`` when the socket ends.
    func receive() async throws -> String
    func send(_ text: String) async throws
    func close()
}

/// Opens WebSockets; stubbed in tests.
protocol WebSocketTransport: Sendable {
    func connect(url: URL, headers: [String: String]) async throws -> any WebSocketConnection
}

/// `URLSessionWebSocketTask` on the SDK's URLSession.
final class URLSessionWebSocketTransport: WebSocketTransport, @unchecked Sendable {
    let session: URLSession

    init(session: URLSession) {
        self.session = session
    }

    func connect(url: URL, headers: [String: String]) async throws -> any WebSocketConnection {
        var request = URLRequest(url: url, timeoutInterval: 30)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 64 * 1024
        task.resume()
        return Connection(task: task)
    }

    final class Connection: WebSocketConnection, @unchecked Sendable {
        let task: URLSessionWebSocketTask

        init(task: URLSessionWebSocketTask) {
            self.task = task
        }

        func receive() async throws -> String {
            do {
                let message = try await withTaskCancellationHandler {
                    try await task.receive()
                } onCancel: { [task] in
                    task.cancel(with: .goingAway, reason: nil)
                }
                switch message {
                case .string(let text): return text
                case .data(let data): return String(decoding: data, as: UTF8.self)
                @unknown default: return ""
                }
            } catch {
                throw failure()
            }
        }

        func send(_ text: String) async throws {
            do {
                try await task.send(.string(text))
            } catch {
                throw failure()
            }
        }

        func close() {
            task.cancel(with: .normalClosure, reason: nil)
        }

        private func failure() -> WebSocketFailure {
            if let response = task.response as? HTTPURLResponse, response.statusCode == 401 { return .unauthorized }
            let code = task.closeCode.rawValue
            if code == 4001 { return .unauthorized }
            return code == 0 ? .failed : .closed(code: code)
        }
    }
}

// MARK: - Live connection

/// What the live connection reports to the conversation.
enum LiveSignal: Sendable, Equatable {
    case connecting
    /// `ready` arrived: catch up once, since events may have been missed while disconnected.
    case connected
    case disconnected
    case event(WireLiveEvent)
}

/// The `/v1/live` WebSocket while the chat is on screen: authenticates with the access token, sends a heartbeat
/// every 15 s (the dashboard's "In chat"), reconnects with backoff, and refreshes the token when the server
/// asks (401 at the handshake, or close code 4001 when the token's 15 minutes are up).
actor LiveConnection {
    static let heartbeatSeconds = 15.0

    private let url: URL
    private let transport: any WebSocketTransport
    private let tokenProvider: @Sendable () async throws -> String
    private let invalidateToken: @Sendable (String) async -> Void
    private let sleeper: any Sleeper
    private let backoff: Backoff
    private let log: Log
    private let userAgent: String

    private var runTask: Task<Void, Never>?
    private var connection: (any WebSocketConnection)?
    private var isConnected = false

    init(
        url: URL,
        transport: any WebSocketTransport,
        tokenProvider: @escaping @Sendable () async throws -> String,
        invalidateToken: @escaping @Sendable (String) async -> Void,
        sleeper: any Sleeper,
        backoff: Backoff = .live,
        log: Log,
        userAgent: String
    ) {
        self.url = url
        self.transport = transport
        self.tokenProvider = tokenProvider
        self.invalidateToken = invalidateToken
        self.sleeper = sleeper
        self.backoff = backoff
        self.log = log
        self.userAgent = userAgent
    }

    /// The live URL for an API base URL: `https://api…` → `wss://api…/v1/live`.
    static func url(forAPIBase base: URL) -> URL? {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        components.path = path + "/v1/live"
        return components.url
    }

    var isRunning: Bool { runTask != nil }

    /// Connects and keeps reconnecting until ``stop()``.
    func start(_ handler: @escaping @Sendable (LiveSignal) async -> Void) {
        guard runTask == nil else { return }
        runTask = Task { await self.run(handler) }
    }

    func stop() {
        runTask?.cancel()
        runTask = nil
        connection?.close()
        connection = nil
        isConnected = false
    }

    /// Tells the team the user is typing. Dropped while disconnected.
    func send(_ command: WireLiveCommand) async {
        guard isConnected, let connection else { return }
        try? await connection.send(command.json)
    }

    private func run(_ handler: @escaping @Sendable (LiveSignal) async -> Void) async {
        var attempt = 0
        var refreshedAfterAuthFailure = false
        while !Task.isCancelled {
            var token: String?
            var connectedAt: Date?
            do {
                await handler(.connecting)
                let current = try await tokenProvider()
                token = current
                let socket = try await transport.connect(
                    url: url,
                    headers: ["Authorization": "Bearer \(current)", "User-Agent": userAgent]
                )
                guard !Task.isCancelled else {
                    socket.close()
                    break
                }
                connection = socket
                let heartbeat = Task {
                    while !Task.isCancelled {
                        try await sleeper.sleep(seconds: Self.heartbeatSeconds)
                        try await socket.send(WireLiveCommand.heartbeat.json)
                    }
                }
                defer { heartbeat.cancel() }
                while !Task.isCancelled {
                    let text = try await socket.receive()
                    guard let event = WireLiveEvent(json: text) else { continue }
                    if event == .ready {
                        attempt = 0
                        refreshedAfterAuthFailure = false
                        isConnected = true
                        connectedAt = Date()
                        log.debug("Live: connected")
                        await handler(.connected)
                    } else {
                        await handler(.event(event))
                    }
                }
            } catch {
                connection = nil
                let wasConnected = isConnected
                isConnected = false
                if wasConnected { await handler(.disconnected) }
                if Task.isCancelled { break }
                // the server closes every socket when its token's 15 minutes are up (4001), which not every
                // platform reports as such
                let likelyExpired = connectedAt.map { Date().timeIntervalSince($0) > 14 * 60 } ?? false
                if (error as? WebSocketFailure) == .unauthorized || likelyExpired {
                    if let token { await invalidateToken(token) }
                    if !refreshedAfterAuthFailure {
                        // reconnect right away with a fresh token
                        refreshedAfterAuthFailure = true
                        log.debug("Live: reconnecting with a fresh token")
                        continue
                    }
                }
                if let error = error as? HireShelbyError, error.code == .cancelled { break }
                let delay = backoff.delay(forAttempt: attempt)
                attempt += 1
                log.debug("Live: disconnected; retrying in \(String(format: "%.1f", delay)) s")
                do {
                    try await sleeper.sleep(seconds: delay)
                } catch {
                    break
                }
            }
        }
        connection?.close()
        connection = nil
        isConnected = false
    }
}
