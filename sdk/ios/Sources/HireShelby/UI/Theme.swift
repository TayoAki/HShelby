#if canImport(UIKit)
import SwiftUI
import UIKit

extension HireShelby {
    /// The chat's look. Match it to the app: its accent color, backgrounds and font; never invented colors.
    ///
    /// The design the team publishes in the dashboard wins over these values property by property (unless
    /// ``HireShelby/Options/usesRemoteAppearance`` is off); the SDK's defaults follow the system's.
    public struct Theme: Sendable {
        /// Buttons, links and the user's own bubbles. Defaults to the app's accent color.
        public var accentColor: Color?
        /// Text and icons on the accent color. Defaults to white.
        public var onAccentColor: Color?
        /// The chat's background. Defaults to the system background.
        public var backgroundColor: Color?
        /// The team's bubbles. Defaults to the secondary system background.
        public var incomingBubbleColor: Color?
        /// Text in the team's bubbles. Defaults to the label color.
        public var incomingTextColor: Color?
        /// The PostScript name of a font the app registers (for example "Avenir-Book"); it scales with Dynamic Type.
        public var fontName: String?
        /// The system font's design when there's no ``fontName``.
        public var fontDesign: Font.Design?
        /// Force light or dark; nil follows the app.
        public var colorScheme: ColorScheme?
        /// The navigation title. Defaults to "Support".
        public var title: String?
        /// Shown above an empty conversation. Defaults to "How can we help?".
        public var welcomeTitle: String?
        /// Shown under the welcome title.
        public var welcomeText: String?
        /// The icon above the welcome title.
        public var welcomeIcon: Icon
        /// The close button of the presented chat.
        public var showsCloseButton: Bool

        /// An image for the welcome screen.
        public enum Icon: Sendable, Equatable {
            /// An SF Symbol.
            case systemImage(String)
            /// An image from the app's asset catalog.
            case asset(String)
            case hidden
        }

        public init(
            accentColor: Color? = nil,
            onAccentColor: Color? = nil,
            backgroundColor: Color? = nil,
            incomingBubbleColor: Color? = nil,
            incomingTextColor: Color? = nil,
            fontName: String? = nil,
            fontDesign: Font.Design? = nil,
            colorScheme: ColorScheme? = nil,
            title: String? = nil,
            welcomeTitle: String? = nil,
            welcomeText: String? = nil,
            welcomeIcon: Icon = .systemImage("bubble.left.and.bubble.right.fill"),
            showsCloseButton: Bool = true
        ) {
            self.accentColor = accentColor
            self.onAccentColor = onAccentColor
            self.backgroundColor = backgroundColor
            self.incomingBubbleColor = incomingBubbleColor
            self.incomingTextColor = incomingTextColor
            self.fontName = fontName
            self.fontDesign = fontDesign
            self.colorScheme = colorScheme
            self.title = title
            self.welcomeTitle = welcomeTitle
            self.welcomeText = welcomeText
            self.welcomeIcon = welcomeIcon
            self.showsCloseButton = showsCloseButton
        }

        /// What the app's own code sets, reported so the dashboard's design editor starts from it.
        var localAppearance: HireShelbyLocalAppearance {
            var local = HireShelbyLocalAppearance()
            local.accent = accentColor.map(RGBA.modeHex)
            local.onAccent = onAccentColor.map(RGBA.modeHex)
            local.chatBackground = backgroundColor.map(RGBA.modeHex)
            local.incomingBackground = incomingBubbleColor.map(RGBA.modeHex)
            local.incomingForeground = incomingTextColor.map(RGBA.modeHex)
            if let colorScheme {
                local.colorScheme = colorScheme == .dark ? .dark : .light
            }
            if let fontDesign {
                switch fontDesign {
                case .rounded: local.fontDesign = .rounded
                case .serif: local.fontDesign = .serif
                case .monospaced: local.fontDesign = .monospaced
                default: local.fontDesign = .default
                }
            }
            let language = Self.appLanguageTag
            local.title = title.map { [language: $0] }
            local.welcomeTitle = welcomeTitle.map { [language: $0] }
            local.welcomeText = welcomeText.map { [language: $0] }
            local.showsCloseButton = showsCloseButton
            return local
        }

        /// The app's language as a BCP 47 tag (`en`, `pt-BR`).
        static var appLanguageTag: String {
            let raw = (Bundle.main.preferredLocalizations.first ?? "en").replacingOccurrences(of: "_", with: "-")
            var parts = raw.split(separator: "-").map(String.init)
            guard !parts.isEmpty else { return "en" }
            parts[0] = parts[0].lowercased()
            return parts.joined(separator: "-")
        }
    }
}

/// A color as sRGB components, so dynamic colors can be built without capturing UIKit objects.
struct RGBA: Equatable, Sendable {
    var red: Double
    var green: Double
    var blue: Double
    var alpha: Double

    init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// `#RRGGBB`.
    init?(hex: String?) {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    /// The color as it looks in light or dark mode.
    init(_ color: UIColor, style: UIUserInterfaceStyle) {
        let resolved = color.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        if !resolved.getRed(&r, green: &g, blue: &b, alpha: &a) {
            var white: CGFloat = 0
            resolved.getWhite(&white, alpha: &a)
            r = white
            g = white
            b = white
        }
        self.init(red: Double(r), green: Double(g), blue: Double(b), alpha: Double(a))
    }

    var hex: String {
        func byte(_ value: Double) -> Int { Int((min(max(value, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
    }

    var uiColor: UIColor {
        UIColor(red: CGFloat(red), green: CGFloat(green), blue: CGFloat(blue), alpha: CGFloat(alpha))
    }

    /// A UIColor that switches with the interface style.
    static func dynamic(light: RGBA, dark: RGBA) -> UIColor {
        UIColor { traits in traits.userInterfaceStyle == .dark ? dark.uiColor : light.uiColor }
    }

    /// The color's light and dark hex values, for the local appearance report.
    static func modeHex(_ color: Color) -> HireShelbyAppearance.ModeColor {
        let uiColor = UIColor(color)
        return HireShelbyAppearance.ModeColor(light: RGBA(uiColor, style: .light).hex, dark: RGBA(uiColor, style: .dark).hex)
    }
}

/// The chat's look after resolving the published design, the app's theme and the defaults.
struct ChatStyle {
    enum Icon: Equatable {
        case systemImage(String)
        case asset(String)
        case remote(URL)
    }

    var accent: Color
    var onAccent: Color
    var background: Color
    var incomingBackground: Color
    var incomingForeground: Color
    var welcomeIconColor: Color
    var colorScheme: ColorScheme?
    var title: String
    var hidesTitle: Bool
    var welcomeTitle: String?
    var welcomeText: String?
    var welcomeIcon: Icon?
    var welcomeIconSize: CGFloat
    var welcomeIconCornerRadius: CGFloat
    var welcomeIconOffset: CGSize
    var fontName: String?
    var fontDesign: Font.Design
    var showsCloseButton: Bool
    var closeIcon: Icon
    var fadesOlderMessages: Bool
    var cardButtonIcon: Icon?
    /// Nil hides the chevron.
    var cardTrailingIcon: Icon?
    var cardIconSize: CGFloat
    var cardButtonColor: Color
    var cardButtonTextColor: Color

    init(theme: HireShelby.Theme, remote: HireShelbyAppearance?, languages: [String] = Bundle.main.preferredLocalizations) {
        let accent = Self.color(remote?.accent, local: theme.accentColor, fallback: UIColor(Color.accentColor))
        self.accent = accent
        onAccent = Self.color(remote?.onAccent, local: theme.onAccentColor, fallback: .white)
        background = Self.color(remote?.chatBackground, local: theme.backgroundColor, fallback: .systemBackground)
        incomingBackground = Self.color(remote?.incomingBackground, local: theme.incomingBubbleColor, fallback: .secondarySystemBackground)
        incomingForeground = Self.color(remote?.incomingForeground, local: theme.incomingTextColor, fallback: .label)
        welcomeIconColor = Self.color(remote?.welcomeIconColor, local: theme.accentColor, fallback: UIColor(Color.accentColor))

        switch remote?.colorScheme {
        case .light?: colorScheme = .light
        case .dark?: colorScheme = .dark
        case .app?: colorScheme = nil
        case nil: colorScheme = theme.colorScheme
        }

        let localized = { (texts: [String: String]?) in HireShelbyAppearance.localized(texts, languages: languages) }
        title = localized(remote?.title) ?? theme.title ?? L10n.title
        hidesTitle = remote?.hidesTitle ?? false
        welcomeTitle = (remote?.hidesWelcomeTitle ?? false) ? nil : (localized(remote?.welcomeTitle) ?? theme.welcomeTitle ?? L10n.welcomeTitle)
        welcomeText = (remote?.hidesWelcomeText ?? false) ? nil : (localized(remote?.welcomeText) ?? theme.welcomeText ?? L10n.welcomeText)

        switch remote?.welcomeIcon {
        case .symbol(let name)?: welcomeIcon = .systemImage(name)
        case .remote(let url)?: welcomeIcon = .remote(url)
        case .hidden?: welcomeIcon = nil
        case nil:
            switch theme.welcomeIcon {
            case .systemImage(let name): welcomeIcon = .systemImage(name)
            case .asset(let name): welcomeIcon = .asset(name)
            case .hidden: welcomeIcon = nil
            }
        }
        welcomeIconSize = CGFloat(remote?.welcomeIconSize ?? 44)
        welcomeIconCornerRadius = CGFloat(remote?.welcomeIconCornerRadius ?? 0)
        welcomeIconOffset = CGSize(width: remote?.welcomeIconOffset?.x ?? 0, height: remote?.welcomeIconOffset?.y ?? 0)

        fontName = theme.fontName
        switch remote?.fontDesign {
        case .rounded?: fontDesign = .rounded
        case .serif?: fontDesign = .serif
        case .monospaced?: fontDesign = .monospaced
        case .default?: fontDesign = .default
        case nil: fontDesign = theme.fontDesign ?? .default
        }
        showsCloseButton = remote?.showsCloseButton ?? theme.showsCloseButton
        switch remote?.closeIcon {
        case .symbol(let name)?: closeIcon = .systemImage(name)
        case .remote(let url)?: closeIcon = .remote(url)
        default: closeIcon = .systemImage("xmark")
        }
        fadesOlderMessages = remote?.fadesOlderMessages ?? false

        switch remote?.cardButtonIcon {
        case .symbol(let name)?: cardButtonIcon = .systemImage(name)
        case .remote(let url)?: cardButtonIcon = .remote(url)
        default: cardButtonIcon = nil
        }
        switch remote?.cardTrailingIcon {
        case .symbol(let name)?: cardTrailingIcon = .systemImage(name)
        case .remote(let url)?: cardTrailingIcon = .remote(url)
        case .hidden?: cardTrailingIcon = nil
        case nil: cardTrailingIcon = .systemImage("chevron.right")
        }
        cardIconSize = CGFloat(remote?.cardIconSize ?? 15)
        cardButtonColor = remote?.cardButtonColor == nil ? accent : Self.color(remote?.cardButtonColor, local: theme.accentColor, fallback: UIColor(Color.accentColor))
        cardButtonTextColor = remote?.cardButtonTextColor == nil
            ? Self.color(remote?.onAccent, local: theme.onAccentColor, fallback: .white)
            : Self.color(remote?.cardButtonTextColor, local: theme.onAccentColor, fallback: .white)
    }

    /// The published color per mode, else the app's color in that mode, else the default.
    static func color(_ remote: HireShelbyAppearance.ModeColor?, local: Color?, fallback: UIColor) -> Color {
        guard let remote else { return local ?? Color(uiColor: fallback) }
        let base = local.map { UIColor($0) } ?? fallback
        let light = RGBA(hex: remote.light) ?? RGBA(base, style: .light)
        let dark = RGBA(hex: remote.dark) ?? RGBA(base, style: .dark)
        return Color(uiColor: RGBA.dynamic(light: light, dark: dark))
    }

    /// The body font at a text style, scaling with Dynamic Type.
    func font(_ style: Font.TextStyle, size: CGFloat) -> Font {
        if let fontName { return .custom(fontName, size: size, relativeTo: style) }
        return .system(style, design: fontDesign)
    }

    var body: Font { font(.body, size: 17) }
    var caption: Font { font(.caption, size: 12) }
    var footnote: Font { font(.footnote, size: 13) }
    var headline: Font { font(.title3, size: 20).weight(.semibold) }
}

/// An SF Symbol, an app image or a remote PNG.
struct StyleIcon: View {
    let icon: ChatStyle.Icon
    var size: CGFloat

    var body: some View {
        switch icon {
        case .systemImage(let name):
            Image(systemName: name).font(.system(size: size, weight: .semibold))
        case .asset(let name):
            Image(name).resizable().scaledToFit().frame(width: size, height: size)
        case .remote(let url):
            AsyncImage(url: url) { image in
                image.resizable().renderingMode(.template).scaledToFit()
            } placeholder: {
                Color.clear
            }
            .frame(width: size, height: size)
        }
    }
}
#endif
