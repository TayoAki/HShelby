#if canImport(UIKit)
import Foundation

/// The chat's strings, from `Localizable.strings` in this package (English; add `<lang>.lproj` folders to
/// translate). Team texts (messages, card labels) are never translated.
enum L10n {
    private static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: nil, bundle: .module, value: fallback, comment: "")
    }

    private static func format(_ key: String, _ fallback: String, _ arguments: CVarArg...) -> String {
        String(format: string(key, fallback), locale: Locale.current, arguments: arguments)
    }

    static var title: String { string("chat.title", "Support") }
    static var welcomeTitle: String { string("welcome.title", "How can we help?") }
    static var welcomeText: String { string("welcome.text", "Send us a message and we'll answer here.") }
    static var notConfigured: String { string("chat.notConfigured", "Support isn't available right now.") }
    static var close: String { string("action.close", "Close") }
    static var retry: String { string("action.retry", "Retry") }
    static var delete: String { string("action.delete", "Delete") }
    static var copy: String { string("action.copy", "Copy") }
    static var loadEarlier: String { string("history.loadEarlier", "Load earlier messages") }

    static var messagePlaceholder: String { string("composer.placeholder", "Message") }
    static var send: String { string("composer.send", "Send") }
    static var addPhoto: String { string("composer.addPhoto", "Add photo") }
    static var removePhoto: String { string("composer.removePhoto", "Remove photo") }
    static func tooLong(_ count: Int) -> String { format("composer.tooLong", "%d characters too long", count) }
    static var photoFailed: String { string("composer.photoFailed", "That photo couldn't be added.") }

    static var sending: String { string("status.sending", "Sending…") }
    static var sent: String { string("status.sent", "Sent") }
    static var seen: String { string("status.seen", "Seen") }
    static var notDelivered: String { string("status.notDelivered", "Not delivered") }
    static var tapToRetry: String { string("status.tapToRetry", "Not delivered. Tap to retry.") }

    static func typing(_ name: String?) -> String {
        guard let name, !name.isEmpty else { return string("typing.someone", "Typing…") }
        return format("typing.named", "%@ is typing…", name)
    }

    static var aiLabel: String { string("label.ai", "AI") }
    static var aiAccessibility: String { string("label.aiAccessibility", "Written by AI") }

    static var rateOnAppStore: String { string("card.review", "Rate on the App Store") }
    static var viewOffer: String { string("card.offer", "View offer") }
    static var noLongerAvailable: String { string("card.unavailable", "No longer available") }

    static var signInToSend: String { string("sending.verificationRequired", "Sign in to send messages.") }
    static var deviceBlocked: String { string("sending.deviceBlocked", "You can't send messages from this device.") }
    static var offline: String { string("connection.offline", "No connection. Messages will be sent when you're back online.") }

    static var you: String { string("a11y.you", "You") }
    static var team: String { string("a11y.team", "Support") }
    static var photo: String { string("a11y.photo", "Photo") }
    static func photoCount(_ count: Int) -> String { format("a11y.photoCount", "%d photos", count) }
    static var photoUnavailable: String { string("a11y.photoUnavailable", "Photo couldn't load. Double-tap to try again.") }
    static var today: String { string("date.today", "Today") }
    static var yesterday: String { string("date.yesterday", "Yesterday") }
}
#endif
