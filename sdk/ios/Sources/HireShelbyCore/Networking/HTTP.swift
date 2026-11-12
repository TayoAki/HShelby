import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One HTTP request, independent of URLSession so tests can stub the transport.
struct HTTPRequest: Sendable, Equatable {
    var method: String
    var url: URL
    var headers: [String: String]
    var body: Data?
    var timeout: TimeInterval

    func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

/// One HTTP response; header names are lowercased.
struct HTTPResponse: Sendable {
    var status: Int
    var headers: [String: String]
    var body: Data

    init(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.status = status
        self.headers = Dictionary(headers.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { _, last in last })
        self.body = body
    }

    func header(_ name: String) -> String? { headers[name.lowercased()] }
}

/// Sends HTTP requests. Throws for transport failures only; any status is a response.
protocol HTTPTransport: Sendable {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse
}

/// The SDK's single URLSession. Cookies and the URL cache are off: every request carries its own credentials.
final class URLSessionHTTPTransport: HTTPTransport, @unchecked Sendable {
    let session: URLSession

    init(session: URLSession) {
        self.session = session
    }

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        #if canImport(Darwin)
        configuration.waitsForConnectivity = false
        #endif
        return URLSession(configuration: configuration)
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        var urlRequest = URLRequest(url: request.url, timeoutInterval: request.timeout)
        urlRequest.httpMethod = request.method
        for (name, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        urlRequest.httpBody = request.body

        let taskBox = Locked<URLSessionDataTask?>(nil)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HTTPResponse, Error>) in
                let task = session.dataTask(with: urlRequest) { data, response, error in
                    if let error {
                        continuation.resume(throwing: error)
                        return
                    }
                    guard let http = response as? HTTPURLResponse else {
                        continuation.resume(throwing: URLError(.badServerResponse))
                        return
                    }
                    var headers: [String: String] = [:]
                    for (key, value) in http.allHeaderFields {
                        if let key = key as? String, let value = value as? String { headers[key] = value }
                    }
                    continuation.resume(returning: HTTPResponse(status: http.statusCode, headers: headers, body: data ?? Data()))
                }
                taskBox.withLock { $0 = task }
                task.resume()
                if Task.isCancelled { task.cancel() }
            }
        } onCancel: {
            taskBox.current?.cancel()
        }
    }
}
