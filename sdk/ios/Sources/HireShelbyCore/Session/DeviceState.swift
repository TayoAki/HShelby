import Foundation

/// What the SDK reports about the device besides messages: details, identity labels, metadata, push, paywalls,
/// StoreKit state and the app's own appearance. The SDK keeps what it wants the server to know (`desired`) and
/// what the server last accepted (`acknowledged`); an update sends the difference.
struct DeviceStateSnapshot: Codable, Equatable, Sendable {
    var device: WireDeviceDetails?
    var identity: WireIdentityLabels?
    var metadata: [String: String]?
    /// Nil: no token (a token the server has gets cleared with `push: null`).
    var push: WirePushRegistration?
    /// The person opted in to promotional notifications in the app (App Review 4.5.4). Nil: never reported.
    var promotionalPush: Bool?
    var paywalls: [WirePaywall]?
    var storekit: WireStoreKit?
    var appearance: JSONValue?

    /// The body of `POST /v1/devices`: everything there is.
    func registrationBody(appId: String, identityToken: String?) -> DeviceStateBody {
        DeviceStateBody(
            appId: appId,
            device: device,
            identity: identity?.isEmpty == false ? identity : nil,
            identityToken: identityToken,
            metadata: metadata,
            push: push.map { .value($0) } ?? .omit,
            promotionalPush: promotionalPush,
            paywalls: paywalls,
            storekit: storekit,
            appearance: appearance
        )
    }

    /// The body of `PATCH /v1/device`: only what differs from what the server has.
    func updateBody(since acknowledged: DeviceStateSnapshot, identityToken: String?, acknowledgedToken: String?) -> DeviceStateBody {
        var body = DeviceStateBody()
        if let device, device != acknowledged.device { body.device = device }
        if let identity, !identity.isEmpty, identity != acknowledged.identity { body.identity = identity }
        if let identityToken, identityToken != acknowledgedToken { body.identityToken = identityToken }
        if let metadata, metadata != acknowledged.metadata { body.metadata = metadata }
        if push != acknowledged.push { body.push = push.map { .value($0) } ?? .null }
        if let promotionalPush, promotionalPush != acknowledged.promotionalPush { body.promotionalPush = promotionalPush }
        if let paywalls, paywalls != acknowledged.paywalls { body.paywalls = paywalls }
        if let storekit, storekit != acknowledged.storekit { body.storekit = storekit }
        if let appearance, appearance != acknowledged.appearance { body.appearance = appearance }
        return body
    }

    /// Removes the fields a `validation_failed` message names (`"paywalls.0.id: …; appearance.colors…"`), so one
    /// bad value can't block the rest. Returns the fields removed.
    @discardableResult
    mutating func dropFields(namedIn message: String) -> Set<String> {
        var dropped = Set<String>()
        for issue in message.split(separator: ";") {
            let path = issue.split(separator: ":", maxSplits: 1).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
            let field = path.split(separator: ".").first.map(String.init) ?? ""
            switch field {
            case "device" where device != nil: device = nil; dropped.insert(field)
            case "identity" where identity != nil: identity = nil; dropped.insert(field)
            case "metadata" where metadata != nil: metadata = nil; dropped.insert(field)
            case "push" where push != nil: push = nil; dropped.insert(field)
            case "promotionalPush" where promotionalPush != nil: promotionalPush = nil; dropped.insert(field)
            case "paywalls" where paywalls != nil: paywalls = nil; dropped.insert(field)
            case "storekit" where storekit != nil: storekit = nil; dropped.insert(field)
            case "appearance" where appearance != nil: appearance = nil; dropped.insert(field)
            default: continue
            }
        }
        return dropped
    }
}

/// A field that can be left out, cleared with `null`, or set.
enum Patch<Value: Encodable & Sendable>: Sendable {
    case omit
    case null
    case value(Value)
}

/// `RegisterDeviceInput` / `DeviceUpdateInput`. Absent fields are left out of the JSON (the API's schemas are
/// strict, so nothing else may appear); `push` can be an explicit `null`.
struct DeviceStateBody: Encodable, Sendable {
    var appId: String?
    var device: WireDeviceDetails?
    var identity: WireIdentityLabels?
    var identityToken: String?
    var metadata: [String: String]?
    var push: Patch<WirePushRegistration> = .omit
    var promotionalPush: Bool?
    var paywalls: [WirePaywall]?
    var storekit: WireStoreKit?
    var appearance: JSONValue?

    private enum Keys: String, CodingKey {
        case appId, device, identity, identityToken, metadata, push, promotionalPush, paywalls, storekit, appearance
    }

    var isEmpty: Bool {
        if case .omit = push {
            return appId == nil && device == nil && identity == nil && identityToken == nil && metadata == nil
                && promotionalPush == nil && paywalls == nil && storekit == nil && appearance == nil
        }
        return false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encodeIfPresent(appId, forKey: .appId)
        try c.encodeIfPresent(device, forKey: .device)
        try c.encodeIfPresent(identity, forKey: .identity)
        try c.encodeIfPresent(identityToken, forKey: .identityToken)
        try c.encodeIfPresent(metadata, forKey: .metadata)
        switch push {
        case .omit: break
        case .null: try c.encodeNil(forKey: .push)
        case .value(let registration): try c.encode(registration, forKey: .push)
        }
        try c.encodeIfPresent(promotionalPush, forKey: .promotionalPush)
        try c.encodeIfPresent(paywalls, forKey: .paywalls)
        try c.encodeIfPresent(storekit, forKey: .storekit)
        try c.encodeIfPresent(appearance, forKey: .appearance)
    }
}

/// What the SDK stores between launches about the device's state (not secret: the secret is in the Keychain).
struct PersistedDeviceState: Codable, Equatable, Sendable {
    var desired = DeviceStateSnapshot()
    var acknowledged = DeviceStateSnapshot()
    /// The server's latest view of who the device is.
    var identity: WireIdentity?
}
