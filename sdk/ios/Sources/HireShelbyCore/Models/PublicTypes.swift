import Foundation

/// Who the device is, as the Hire Shelby API sees it.
public struct HireShelbyIdentity: Equatable, Sendable {
    public var userId: String?
    public var name: String?
    public var email: String?
    /// True when the identity came from a valid identity token (``HireShelbyClient/identify(token:)``).
    public var isVerified: Bool

    public static let anonymous = HireShelbyIdentity(userId: nil, name: nil, email: nil, isVerified: false)

    init(_ wire: WireIdentity) {
        self.init(userId: wire.userId, name: wire.name, email: wire.email, isVerified: wire.verified)
    }

    public init(userId: String?, name: String?, email: String?, isVerified: Bool) {
        self.userId = userId
        self.name = name
        self.email = email
        self.isVerified = isVerified
    }
}

/// A paywall the app can show, so the team can send an offer for it.
///
/// Titles are for the team; customers never see them. Report the list with
/// ``HireShelbyClient/reportPaywalls(_:)`` whenever it changes.
public struct HireShelbyPaywall: Equatable, Sendable, Identifiable {
    /// Where the paywall comes from.
    public enum Source: String, Sendable, CaseIterable {
        case revenueCat = "revenuecat"
        case superwall
        case adapty
        case app
    }

    /// A product on the paywall, as StoreKit or the vendor SDK localized it.
    public struct Product: Equatable, Sendable {
        public var id: String
        /// Localized price, e.g. "$4.99".
        public var price: String?
        /// ISO 8601 duration, e.g. "P1M".
        public var period: String?
        /// ISO 8601 duration of the free trial, e.g. "P1W".
        public var trial: String?

        public init(id: String, price: String? = nil, period: String? = nil, trial: String? = nil) {
            self.id = id
            self.price = price
            self.period = period
            self.trial = trial
        }
    }

    /// 1–64 letters, digits, `_`, `.` or `-`.
    public var id: String
    /// 1–60 characters, shown to the team.
    public var title: String
    public var source: Source
    /// False when the paywall exists but can't be presented on this device right now.
    public var isPresentable: Bool
    /// At most 10 per paywall and 40 in total.
    public var products: [Product]

    public init(id: String, title: String, source: Source = .app, isPresentable: Bool = true, products: [Product] = []) {
        self.id = id
        self.title = title
        self.source = source
        self.isPresentable = isPresentable
        self.products = products
    }

    var wire: WirePaywall {
        WirePaywall(
            id: id,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            source: source.rawValue,
            presentable: isPresentable,
            products: products.map {
                WirePaywallProduct(
                    id: $0.id.trimmingCharacters(in: .whitespacesAndNewlines),
                    price: $0.price.map { DeviceInfo.clip($0.trimmingCharacters(in: .whitespaces), 50) },
                    period: $0.period.map { DeviceInfo.clip($0.trimmingCharacters(in: .whitespaces), 20) },
                    trial: $0.trial.map { DeviceInfo.clip($0.trimmingCharacters(in: .whitespaces), 20) }
                )
            }
        )
    }
}

/// Something that happened in the SDK, for the app's analytics or flows. Carries no personal data.
public enum HireShelbyEvent: Equatable, Sendable {
    /// The chat came on screen.
    case chatOpened
    /// The chat left the screen.
    case chatClosed
    /// The server accepted a message the user wrote.
    case messageSent
    /// The user tapped a review card's button.
    case reviewOpened
    /// The user tapped an offer card's button and the SDK called the app's paywall handler.
    case paywallOpened(paywallId: String)
    /// ``HireShelbyClient/deleteData()`` finished.
    case dataDeleted
    /// The server refused an identity token (`identity_token_invalid` or `identity_token_expired`): fetch a fresh
    /// one from your server and call `identify(token:)` again. An existing verification stays.
    case identityRejected(HireShelbyError)
}

/// What ``HireShelbyClient/track(_:)`` did.
public struct HireShelbyTrackResult: Equatable, Sendable {
    /// The event went to the server (only events an enabled automation listens for leave the device).
    public var delivered: Bool
    /// An automation sent a message right away.
    public var sent: Bool
    /// The automation asked the app to open the chat to show it.
    public var openChat: Bool

    public static let skipped = HireShelbyTrackResult(delivered: false, sent: false, openChat: false)
}

/// Limits the API enforces, checked on the device first so a bad value never blocks a whole update.
enum Limits {
    static let messageLength = 4000
    static let photosPerMessage = 4
    static let photoBytes = 1024 * 1024
    static let photoPixels = 2048
    static let userId = 255
    static let name = 200
    static let email = 254
    static let identityToken = 4096
    static let metadataEntries = 20
    static let metadataKey = 64
    static let metadataValue = 512
    static let paywalls = 20
    static let paywallTitle = 60
    static let productsPerPaywall = 10
    static let productsTotal = 40
    static let transactionIds = 20

    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }

    static let appIdPattern = "^app_[0-9A-Za-z]{22}$"
    static let paywallIdPattern = "^[A-Za-z0-9_.-]{1,64}$"
    static let eventPattern = "^[a-z0-9_.-]{1,64}$"
    static let transactionIdPattern = "^[0-9]{1,20}$"
}
