import Foundation

/// Reads an identity token's `user_id` without verifying it (the server verifies), so the SDK can tell when a
/// token belongs to a different user than the device's and start a new session first.
enum IdentityToken {
    enum Problem: Error, Equatable {
        case looksLikeSecret
        case tooLong
        case malformed
    }

    /// The token's `user_id` claim (a string, or an integer as its decimal string).
    static func userId(in token: String) -> Result<String, Problem> {
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if token.hasPrefix("ids_") { return .failure(.looksLikeSecret) }
        if token.count > Limits.identityToken { return .failure(.tooLong) }
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let payload = base64URLDecode(String(parts[1])),
              let claims = try? JSONDecoder().decode(JSONValue.self, from: payload)
        else { return .failure(.malformed) }
        switch claims["user_id"] {
        case .string(let value)?:
            let trimmed = value.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty ? .failure(.malformed) : .success(trimmed)
        case .number(let value)? where value.rounded() == value && abs(value) <= 9_007_199_254_740_991:
            return .success(String(Int64(value)))
        default:
            return .failure(.malformed)
        }
    }

    static func base64URLDecode(_ value: String) -> Data? {
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder == 1 { return nil }
        if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        return Data(base64Encoded: base64)
    }
}
