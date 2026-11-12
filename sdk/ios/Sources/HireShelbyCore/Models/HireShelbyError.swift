import Foundation

/// An error from the SDK or the Hire Shelby API.
///
/// API errors carry the server's stable `code` (for example ``Code/verificationRequired``) and the HTTP status.
/// Local failures use codes such as ``Code/connectionFailed`` with no status.
public struct HireShelbyError: Error, Sendable, Equatable, CustomStringConvertible {
    /// A stable error code. Server codes match the API's `{ error: { code } }`.
    public struct Code: RawRepresentable, Hashable, Sendable, ExpressibleByStringLiteral, CustomStringConvertible {
        public let rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }
        public init(stringLiteral value: String) { self.rawValue = value }
        public var description: String { rawValue }

        // Server codes the SDK can meet.
        public static let unauthorized: Code = "unauthorized"
        public static let forbidden: Code = "forbidden"
        public static let notFound: Code = "not_found"
        public static let validationFailed: Code = "validation_failed"
        public static let deviceBlocked: Code = "device_blocked"
        public static let clientIdReused: Code = "client_id_reused"
        public static let identityTokenInvalid: Code = "identity_token_invalid"
        public static let identityTokenExpired: Code = "identity_token_expired"
        public static let identityMismatch: Code = "identity_mismatch"
        public static let verificationRequired: Code = "verification_required"
        public static let deleteFailed: Code = "delete_failed"
        public static let uploadsNotConfigured: Code = "uploads_not_configured"
        public static let uploadIncomplete: Code = "upload_incomplete"
        public static let invalidAttachment: Code = "invalid_attachment"
        public static let tooManyUploads: Code = "too_many_uploads"
        public static let rateLimited: Code = "rate_limited"
        public static let internalError: Code = "internal_error"

        // Local codes.
        /// The request never got an answer: offline, timed out or the connection dropped.
        public static let connectionFailed: Code = "connection_failed"
        /// The operation was cancelled.
        public static let cancelled: Code = "cancelled"
        /// `configure(appId:)` hasn't been called, or was called with a malformed App ID.
        public static let notConfigured: Code = "not_configured"
        /// The server answered with something the SDK couldn't read.
        public static let invalidResponse: Code = "invalid_response"
        /// The Keychain refused to store the session.
        public static let secureStorageUnavailable: Code = "secure_storage_unavailable"
        /// An argument was out of bounds (for example a photo over 1 MB).
        public static let invalidInput: Code = "invalid_input"
    }

    public let code: Code
    /// The HTTP status for API errors; nil for local ones.
    public let status: Int?
    /// A developer-facing explanation. Not localized; don't show it to users.
    public let message: String
    /// Seconds the server asked to wait (429 `Retry-After`).
    public let retryAfter: Double?

    public init(code: Code, status: Int? = nil, message: String, retryAfter: Double? = nil) {
        self.code = code
        self.status = status
        self.message = message
        self.retryAfter = retryAfter
    }

    public var description: String {
        status.map { "\(code.rawValue) (\($0)): \(message)" } ?? "\(code.rawValue): \(message)"
    }

    /// Worth trying again later without changing anything: connection problems, rate limits, server errors.
    public var isTransient: Bool {
        if code == .connectionFailed || code == .rateLimited { return true }
        // a 503 that won't change by waiting: the server has no photo storage
        if code == .uploadsNotConfigured { return false }
        if let status, status >= 500 { return true }
        return false
    }

    static func connectionFailed(_ detail: String) -> HireShelbyError {
        HireShelbyError(code: .connectionFailed, message: detail)
    }

    static let cancelled = HireShelbyError(code: .cancelled, message: "Cancelled")

    static func invalidResponse(_ detail: String, status: Int? = nil) -> HireShelbyError {
        HireShelbyError(code: .invalidResponse, status: status, message: detail)
    }

    static func invalidInput(_ detail: String) -> HireShelbyError {
        HireShelbyError(code: .invalidInput, message: detail)
    }

    static let notConfigured = HireShelbyError(code: .notConfigured, message: "Call HireShelby.configure(appId:) with your App ID first")
}

/// The API's error body: `{ "error": { "code": "…", "message": "…" } }`.
struct WireErrorBody: Decodable {
    struct Detail: Decodable {
        let code: String
        let message: String
    }
    let error: Detail
}
