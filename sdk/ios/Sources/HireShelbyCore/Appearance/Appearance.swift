import Foundation

/// The chat design the team published in the dashboard ("Chat design"), as the SDK applies it.
///
/// Every property is optional: nil means "use the app's own value", then the SDK's default. Colors are
/// `#RRGGBB` per mode. The SDK fetches it by App ID without registering and switches to a new version the next
/// time the chat opens, never mid-conversation.
public struct HireShelbyAppearance: Equatable, Sendable {
    /// A color for light mode, dark mode, or both (`#RRGGBB`).
    public struct ModeColor: Equatable, Sendable {
        public var light: String?
        public var dark: String?

        public init(light: String? = nil, dark: String? = nil) {
            self.light = light
            self.dark = dark
        }
    }

    /// An image the team chose.
    public enum Image: Equatable, Sendable {
        /// An SF Symbol name.
        case symbol(String)
        /// A PNG from the team's asset library.
        case remote(URL)
        /// No image.
        case hidden
    }

    public enum ColorScheme: String, Equatable, Sendable {
        /// Follow the app.
        case app, light, dark
    }

    public enum FontDesign: String, Equatable, Sendable {
        case `default`, rounded, serif, monospaced
    }

    public struct Offset: Equatable, Sendable {
        public var x: Double
        public var y: Double
    }

    public var version: Int = 0

    public var accent: ModeColor?
    public var onAccent: ModeColor?
    public var chatBackground: ModeColor?
    public var incomingBackground: ModeColor?
    public var incomingForeground: ModeColor?
    public var welcomeIconColor: ModeColor?
    public var colorScheme: ColorScheme?

    /// Texts per language tag (`en`, `pt-BR`); see ``localized(_:languages:)``.
    public var title: [String: String]?
    public var welcomeTitle: [String: String]?
    public var welcomeText: [String: String]?
    public var hidesTitle: Bool?
    public var hidesWelcomeTitle: Bool?
    public var hidesWelcomeText: Bool?

    public var welcomeIcon: Image?
    public var welcomeIconSize: Double?
    public var welcomeIconCornerRadius: Double?
    /// Points to move the welcome icon by.
    public var welcomeIconOffset: Offset?

    public var fontDesign: FontDesign?
    public var showsCloseButton: Bool?
    public var closeIcon: Image?
    /// Older outgoing bubbles fade toward white.
    public var fadesOlderMessages: Bool?

    public var cardButtonIcon: Image?
    /// `.hidden` removes the chevron after the label.
    public var cardTrailingIcon: Image?
    public var cardIconSize: Double?
    public var cardButtonColor: ModeColor?
    public var cardButtonTextColor: ModeColor?

    /// Teammates' first names above their replies.
    public var showsTeamNames = false
    /// Teammates' photos (or initials) beside their replies.
    public var showsTeamPhotos = false

    public init() {}

    /// The text for the user's language: the exact tag, then the base language (`pt-BR` → `pt`), else nil (use
    /// the app's own text).
    public static func localized(_ texts: [String: String]?, languages: [String] = Bundle.main.preferredLocalizations) -> String? {
        guard let texts, !texts.isEmpty else { return nil }
        let lowered = Dictionary(texts.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { first, _ in first })
        for language in languages {
            let tag = language.replacingOccurrences(of: "_", with: "-").lowercased()
            if let text = lowered[tag] { return text }
            if let base = tag.split(separator: "-").first, let text = lowered[String(base)] { return text }
        }
        return nil
    }

    /// Reads `GET /v1/apps/:appId/appearance`. Values the SDK doesn't understand are skipped, never fatal.
    init(_ wire: WirePublicAppearance) {
        version = wire.version
        showsTeamNames = wire.team.showNames
        showsTeamPhotos = wire.team.showPhotos
        guard let doc = wire.appearance else { return }

        let colors = doc["colors"]
        accent = Self.modeColor(colors?["accent"])
        onAccent = Self.modeColor(colors?["onAccent"])
        chatBackground = Self.modeColor(colors?["chatBackground"])
        incomingBackground = Self.modeColor(colors?["incomingBackground"])
        incomingForeground = Self.modeColor(colors?["incomingForeground"])
        welcomeIconColor = Self.modeColor(colors?["welcomeIcon"])
        colorScheme = doc["colorScheme"]?.stringValue.flatMap(ColorScheme.init(rawValue:))

        title = Self.texts(doc["title"])
        welcomeTitle = Self.texts(doc["welcomeTitle"])
        welcomeText = Self.texts(doc["welcomeText"])
        hidesTitle = doc["hidesTitle"]?.boolValue
        hidesWelcomeTitle = doc["hidesWelcomeTitle"]?.boolValue
        hidesWelcomeText = doc["hidesWelcomeText"]?.boolValue

        welcomeIcon = Self.image(doc["welcomeIcon"])
        welcomeIconSize = doc["welcomeIconSize"]?.doubleValue
        welcomeIconCornerRadius = doc["welcomeIconCornerRadius"]?.doubleValue
        if let x = doc["welcomeIconOffset"]?["x"]?.doubleValue, let y = doc["welcomeIconOffset"]?["y"]?.doubleValue {
            welcomeIconOffset = Offset(x: x, y: y)
        }

        fontDesign = doc["fontDesign"]?.stringValue.flatMap(FontDesign.init(rawValue:))
        showsCloseButton = doc["showsCloseButton"]?.boolValue
        closeIcon = Self.image(doc["closeIcon"])
        fadesOlderMessages = doc["fadesOlderMessages"]?.boolValue

        let cards = doc["cards"]
        cardButtonIcon = Self.image(cards?["buttonIcon"])
        cardTrailingIcon = Self.image(cards?["trailingIcon"])
        cardIconSize = cards?["iconSize"]?.doubleValue
        cardButtonColor = Self.modeColor(cards?["buttonColor"])
        cardButtonTextColor = Self.modeColor(cards?["buttonTextColor"])
    }

    static func isHex(_ value: String?) -> Bool {
        guard let value else { return false }
        return Limits.matches(value, "^#[0-9A-Fa-f]{6}$")
    }

    private static func modeColor(_ value: JSONValue?) -> ModeColor? {
        let light = value?["light"]?.stringValue
        let dark = value?["dark"]?.stringValue
        let color = ModeColor(light: isHex(light) ? light : nil, dark: isHex(dark) ? dark : nil)
        return color.light == nil && color.dark == nil ? nil : color
    }

    private static func texts(_ value: JSONValue?) -> [String: String]? {
        guard let object = value?.objectValue else { return nil }
        let texts = object.compactMapValues { $0.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.value.isEmpty }
        return texts.isEmpty ? nil : texts
    }

    private static func image(_ value: JSONValue?) -> Image? {
        switch value?["type"]?.stringValue {
        case "symbol": return value?["name"]?.stringValue.map(Image.symbol)
        case "asset": return value?["url"]?.stringValue.flatMap(URL.init(string:)).map(Image.remote)
        case "hidden": return .hidden
        default: return nil
        }
    }
}

/// What the app's own code sets for the chat's look, reported to the server so the dashboard's design editor
/// starts from it (`LocalAppearance`). Colors are `#RRGGBB`.
public struct HireShelbyLocalAppearance: Equatable, Sendable {
    public var accent: HireShelbyAppearance.ModeColor?
    public var onAccent: HireShelbyAppearance.ModeColor?
    public var chatBackground: HireShelbyAppearance.ModeColor?
    public var incomingBackground: HireShelbyAppearance.ModeColor?
    public var incomingForeground: HireShelbyAppearance.ModeColor?
    public var colorScheme: HireShelbyAppearance.ColorScheme?
    public var fontDesign: HireShelbyAppearance.FontDesign?
    /// Text the app sets, keyed by language tag.
    public var title: [String: String]?
    public var welcomeTitle: [String: String]?
    public var welcomeText: [String: String]?
    public var showsCloseButton: Bool?

    public init() {}

    /// The JSON the API's strict schema accepts: invalid values are left out rather than sent.
    var json: JSONValue? {
        var doc: [String: JSONValue] = [:]
        var colors: [String: JSONValue] = [:]
        func add(_ key: String, _ color: HireShelbyAppearance.ModeColor?) {
            guard let color else { return }
            var mode: [String: JSONValue] = [:]
            if HireShelbyAppearance.isHex(color.light) { mode["light"] = .string(color.light!.uppercased()) }
            if HireShelbyAppearance.isHex(color.dark) { mode["dark"] = .string(color.dark!.uppercased()) }
            if !mode.isEmpty { colors[key] = .object(mode) }
        }
        add("accent", accent)
        add("onAccent", onAccent)
        add("chatBackground", chatBackground)
        add("incomingBackground", incomingBackground)
        add("incomingForeground", incomingForeground)
        if !colors.isEmpty { doc["colors"] = .object(colors) }
        if let colorScheme { doc["colorScheme"] = .string(colorScheme.rawValue) }
        if let fontDesign { doc["fontDesign"] = .string(fontDesign.rawValue) }
        func texts(_ key: String, _ value: [String: String]?, max: Int) {
            guard let value else { return }
            let valid = value.compactMapValues { text -> JSONValue? in
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty || trimmed.count > max ? nil : .string(trimmed)
            }.filter { Limits.matches($0.key, "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$") }
            if !valid.isEmpty, valid.count <= 48 { doc[key] = .object(valid) }
        }
        texts("title", title, max: 40)
        texts("welcomeTitle", welcomeTitle, max: 80)
        texts("welcomeText", welcomeText, max: 300)
        if let showsCloseButton { doc["showsCloseButton"] = .bool(showsCloseButton) }
        return doc.isEmpty ? nil : .object(doc)
    }
}
