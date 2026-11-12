import Foundation

/// What the SDK reports about the device and app (never IDFA or IDFV).
enum DeviceInfo {
    static func current() -> WireDeviceDetails {
        WireDeviceDetails(
            model: clip(modelIdentifier(), 100),
            osVersion: clip(osVersion(), 50),
            appVersion: clip(appVersion(), 50),
            sdkVersion: HireShelbyVersion.current,
            locale: clip(locale(), 35),
            timezone: clip(TimeZone.current.identifier, 64)
        )
    }

    /// "iPhone16,1"; on the simulator, the simulated model.
    static func modelIdentifier() -> String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !simulated.isEmpty {
            return simulated
        }
        #if canImport(Darwin)
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        if size > 0 {
            var machine = [CChar](repeating: 0, count: size)
            sysctlbyname("hw.machine", &machine, &size, nil, 0)
            let bytes = machine.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
            if let model = String(bytes: bytes, encoding: .utf8), !model.isEmpty { return model }
        }
        #endif
        return "unknown"
    }

    static func osVersion() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return v.patchVersion > 0 ? "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)" : "\(v.majorVersion).\(v.minorVersion)"
    }

    /// "1.4.0 (212)": the marketing version and the build.
    static func appVersion() -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String
        let build = info["CFBundleVersion"] as? String
        switch (version, build) {
        case let (version?, build?) where version != build: return "\(version) (\(build))"
        case let (version?, _): return version
        case let (nil, build?): return build
        default: return ""
        }
    }

    /// The app's language and the user's region as a BCP 47 tag ("de-AT"): what the team writes in.
    static func locale() -> String {
        let language = Bundle.main.preferredLocalizations.first ?? Locale.preferredLanguages.first ?? "en"
        let languageTag = language.replacingOccurrences(of: "_", with: "-")
        if languageTag.contains("-") { return languageTag }
        if let region = Locale.current.region?.identifier, !region.isEmpty { return "\(languageTag)-\(region)" }
        return languageTag
    }

    static func clip(_ value: String, _ max: Int) -> String {
        value.count > max ? String(value.prefix(max)) : value
    }
}

/// The APNs environment a device token belongs to.
public enum HireShelbyPushEnvironment: String, Sendable, CaseIterable {
    /// Sandbox on the simulator and in development-signed builds, production otherwise (TestFlight, App Store),
    /// read from the app's embedded provisioning profile.
    case automatic
    case sandbox
    case production

    /// The concrete environment: `.automatic` resolved for this build.
    var resolved: String {
        switch self {
        case .sandbox: return "sandbox"
        case .production: return "production"
        case .automatic: return Self.detect()
        }
    }

    static func detect() -> String {
        #if targetEnvironment(simulator)
        return "sandbox"
        #else
        guard
            let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
            let data = try? Data(contentsOf: url)
        else {
            return "production" // App Store builds carry no profile
        }
        return apsEnvironment(inProvisioningProfile: data) ?? "production"
        #endif
    }

    /// Reads `aps-environment` from a provisioning profile (a signed blob with a plist inside).
    static func apsEnvironment(inProvisioningProfile data: Data) -> String? {
        let text = String(decoding: data, as: UTF8.self)
        guard
            let start = text.range(of: "<?xml"),
            let end = text.range(of: "</plist>", range: start.upperBound..<text.endIndex),
            let plistData = String(text[start.lowerBound..<end.upperBound]).data(using: .utf8),
            let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
            let entitlements = plist["Entitlements"] as? [String: Any],
            let environment = entitlements["aps-environment"] as? String
        else { return nil }
        return environment == "development" ? "sandbox" : "production"
    }
}
