import Foundation
#if canImport(Security)
import Security
#endif

// MARK: - Credentials

/// What the SDK keeps secret: the device secret (the long-lived refresh credential), the current access token,
/// and device secrets whose logout hasn't reached the server yet.
struct StoredCredentials: Codable, Equatable, Sendable {
    struct Session: Codable, Equatable, Sendable {
        var deviceSecret: String
        var accessToken: String?
        var accessTokenExpiresAt: Date?
    }
    var session: Session?
    /// Logged-out device secrets still to be sent to `POST /v1/session/logout`.
    var pendingLogouts: [String] = []
}

/// Secure storage for ``StoredCredentials``: the Keychain on Apple platforms, memory in tests and on Linux.
protocol CredentialStore: Sendable {
    func load() throws -> StoredCredentials?
    func save(_ credentials: StoredCredentials) throws
    func delete() throws
}

/// Keeps credentials in memory only.
final class InMemoryCredentialStore: CredentialStore {
    private let value = Locked<StoredCredentials?>(nil)

    init(_ initial: StoredCredentials? = nil) {
        value.withLock { $0 = initial }
    }

    func load() throws -> StoredCredentials? { value.current }
    func save(_ credentials: StoredCredentials) throws { value.withLock { $0 = credentials } }
    func delete() throws { value.withLock { $0 = nil } }
}

#if canImport(Security)
/// One generic-password Keychain item per App ID and API host, readable after the first unlock and never
/// migrated to another device.
final class KeychainCredentialStore: CredentialStore {
    private let service = "com.hireshelby.sdk"
    private let account: String

    init(appId: String, apiHost: String) {
        account = "\(appId)@\(apiHost)"
    }

    private var baseQuery: [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        return query
    }

    func load() throws -> StoredCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Self.error(status) }
        return try? JSONDecoder().decode(StoredCredentials.self, from: data)
    }

    func save(_ credentials: StoredCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw Self.error(status) }
        var add = baseQuery
        add.merge(update) { _, new in new }
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else { throw Self.error(added) }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.error(status) }
    }

    private static func error(_ status: OSStatus) -> HireShelbyError {
        HireShelbyError(code: .secureStorageUnavailable, message: "Keychain error \(status)")
    }
}
#endif

// MARK: - Files

/// Small JSON files and photo files in the SDK's own directory (Application Support/HireShelby/<App ID>),
/// excluded from backups and protected until first unlock.
struct FileStore: Sendable {
    let directory: URL

    static func defaultDirectory(appId: String) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("HireShelby", isDirectory: true).appendingPathComponent(appId, isDirectory: true)
    }

    func url(for name: String) -> URL {
        directory.appendingPathComponent(name, isDirectory: false)
    }

    func ensureDirectory(_ url: URL? = nil) {
        let target = url ?? directory
        guard !FileManager.default.fileExists(atPath: target.path) else { return }
        try? FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        #if canImport(Darwin)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var excluded = target
        try? excluded.setResourceValues(values)
        #endif
    }

    func read<Value: Decodable>(_ type: Value.Type, from name: String) -> Value? {
        guard let data = try? Data(contentsOf: url(for: name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    func write<Value: Encodable>(_ value: Value, to name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        writeData(data, to: name)
    }

    func writeData(_ data: Data, to name: String) {
        let target = url(for: name)
        ensureDirectory(target.deletingLastPathComponent())
        #if os(iOS)
        try? data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try? data.write(to: target, options: [.atomic])
        #endif
    }

    func readData(_ name: String) -> Data? {
        try? Data(contentsOf: url(for: name))
    }

    func exists(_ name: String) -> Bool {
        FileManager.default.fileExists(atPath: url(for: name).path)
    }

    func remove(_ name: String) {
        try? FileManager.default.removeItem(at: url(for: name))
    }
}
