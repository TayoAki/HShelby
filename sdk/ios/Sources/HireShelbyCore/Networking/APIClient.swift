import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Which failures a request may be retried after.
enum RetryMode: Sendable, Equatable {
    /// Repeating it can't do harm (reads, idempotent writes, sends keyed by `clientId`): retry connection
    /// failures and 5xx.
    case idempotent
    /// Retry only when the request certainly never reached the server (no connection could be made).
    case unsentOnly
}

/// A request to the API, relative to the base URL.
struct APIRequest: Sendable {
    var method: String
    var path: String
    var query: [URLQueryItem] = []
    var body: Data? = nil
    var headers: [String: String] = [:]
    var retry: RetryMode = .idempotent
    var timeout: TimeInterval = 30

    static func get(_ path: String, query: [URLQueryItem] = []) -> APIRequest {
        APIRequest(method: "GET", path: path, query: query)
    }

    static func post<Body: Encodable>(_ path: String, _ body: Body, retry: RetryMode = .idempotent) -> APIRequest {
        APIRequest(method: "POST", path: path, body: try? APIClient.encoder.encode(body), retry: retry)
    }

    static func patch<Body: Encodable>(_ path: String, _ body: Body) -> APIRequest {
        APIRequest(method: "PATCH", path: path, body: try? APIClient.encoder.encode(body))
    }

    static func delete(_ path: String) -> APIRequest {
        APIRequest(method: "DELETE", path: path)
    }

    var summary: String { "\(method) \(path)" }
}

/// Builds requests, retries with backoff, honours 429 `Retry-After`, and turns error bodies into
/// ``HireShelbyError``. Authentication (and refreshing it) is ``DeviceSession``'s job.
struct APIClient: Sendable {
    let baseURL: URL
    let transport: any HTTPTransport
    let sleeper: any Sleeper
    var backoff: Backoff = .request
    /// Attempts per request, the first included.
    var maxAttempts = 4
    /// A longer `Retry-After` than this is returned to the caller as `rate_limited` instead of waited out.
    var maxRetryAfter: Double = 60
    let userAgent: String
    let log: Log

    /// A fresh encoder per use: JSONEncoder isn't Sendable on every SDK this package supports.
    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    static var decoder: JSONDecoder { JSONDecoder() }

    func url(for request: APIRequest) throws -> URL {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        guard var components = URLComponents(string: base + request.path) else {
            throw HireShelbyError.invalidInput("Bad API URL")
        }
        if !request.query.isEmpty { components.queryItems = request.query }
        guard let url = components.url else { throw HireShelbyError.invalidInput("Bad API URL") }
        return url
    }

    func httpRequest(for request: APIRequest, accessToken: String?) throws -> HTTPRequest {
        var headers = ["Accept": "application/json", "User-Agent": userAgent]
        if request.body != nil { headers["Content-Type"] = "application/json" }
        if let accessToken { headers["Authorization"] = "Bearer \(accessToken)" }
        for (name, value) in request.headers { headers[name] = value }
        return HTTPRequest(method: request.method, url: try url(for: request), headers: headers, body: request.body, timeout: request.timeout)
    }

    /// Sends a request, retrying what's safe to retry. Returns 2xx and 304 responses; throws everything else.
    func send(_ request: APIRequest, accessToken: String?) async throws -> HTTPResponse {
        let http = try httpRequest(for: request, accessToken: accessToken)
        var attempt = 0
        while true {
            try checkCancellation()
            let response: HTTPResponse
            do {
                response = try await transport.send(http)
            } catch {
                if Self.isCancellation(error) { throw HireShelbyError.cancelled }
                let retryable = request.retry == .idempotent || Self.neverReachedServer(error)
                log.debug("\(request.summary) failed to connect (attempt \(attempt + 1))")
                if retryable, attempt + 1 < maxAttempts {
                    try await wait(backoff.delay(forAttempt: attempt))
                    attempt += 1
                    continue
                }
                throw HireShelbyError.connectionFailed("\(request.summary): \(Self.describe(error))")
            }

            log.debug("\(request.summary) → \(response.status)")
            if (200..<300).contains(response.status) || response.status == 304 { return response }

            let error = Self.error(from: response)
            if response.status == 429, attempt + 1 < maxAttempts {
                // the server refused before doing anything, so any request may be repeated
                let wait = error.retryAfter ?? backoff.delay(forAttempt: attempt)
                if wait <= maxRetryAfter {
                    try await self.wait(wait)
                    attempt += 1
                    continue
                }
            }
            if response.status >= 500, request.retry == .idempotent, attempt + 1 < maxAttempts {
                try await wait(backoff.delay(forAttempt: attempt))
                attempt += 1
                continue
            }
            throw error
        }
    }

    /// Sends a request and decodes its JSON body.
    func send<Response: Decodable>(_ request: APIRequest, accessToken: String?, as type: Response.Type) async throws -> Response {
        try Self.decode(type, from: try await send(request, accessToken: accessToken))
    }

    static func decode<Response: Decodable>(_ type: Response.Type, from response: HTTPResponse) throws -> Response {
        do {
            return try decoder.decode(type, from: response.body)
        } catch {
            throw HireShelbyError.invalidResponse("Couldn't read \(type) from the response: \(error)", status: response.status)
        }
    }

    static func error(from response: HTTPResponse) -> HireShelbyError {
        let retryAfter = response.header("Retry-After").flatMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        if let body = try? decoder.decode(WireErrorBody.self, from: response.body) {
            return HireShelbyError(
                code: HireShelbyError.Code(rawValue: body.error.code),
                status: response.status,
                message: body.error.message,
                retryAfter: retryAfter
            )
        }
        let code: HireShelbyError.Code = switch response.status {
        case 401: .unauthorized
        case 403: .forbidden
        case 404: .notFound
        case 429: .rateLimited
        case 500...: .internalError
        default: .invalidResponse
        }
        return HireShelbyError(code: code, status: response.status, message: "HTTP \(response.status)", retryAfter: retryAfter)
    }

    private func wait(_ seconds: Double) async throws {
        do {
            try await sleeper.sleep(seconds: seconds)
        } catch {
            throw HireShelbyError.cancelled
        }
    }

    private func checkCancellation() throws {
        if Task.isCancelled { throw HireShelbyError.cancelled }
    }

    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let error = error as? URLError, error.code == .cancelled { return true }
        return false
    }

    /// Failures that happen before a request leaves the device, so even non-idempotent requests can be retried.
    static func neverReachedServer(_ error: Error) -> Bool {
        guard let error = error as? URLError else { return false }
        switch error.code {
        case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed,
             .internationalRoamingOff, .callIsActive:
            return true
        default:
            return false
        }
    }

    static func describe(_ error: Error) -> String {
        if let error = error as? URLError { return "URLError \(error.code.rawValue)" }
        return String(describing: type(of: error))
    }
}
