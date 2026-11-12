import Foundation

extension HireShelbyConversation {
    /// A message in the chat: one the server has, or one of the user's still on its way (``Status/sending``).
    public struct Message: Identifiable, Equatable, Sendable {
        public enum Sender: Equatable, Sendable {
            /// The app's user (this device).
            case user
            /// The team: a teammate, an automation or the AI (``isByAI``).
            case team
        }

        /// Delivery of the user's own messages; team messages are always ``sent``.
        public enum Status: Equatable, Sendable {
            /// Not accepted by the server yet; the SDK keeps retrying while the app is active.
            case sending
            /// The server has it. (Not "read": that's ``HireShelbyConversation/teamReadSeq``.)
            case sent
            /// Not delivered: ``HireShelbyConversation/retry(_:)`` or ``HireShelbyConversation/discard(_:)``.
            /// The SDK keeps retrying transient failures (``HireShelbyError/isTransient``) on its own.
            case failed(HireShelbyError.Code)
        }

        /// Stable across sending and delivery: derived from the `clientId` for the user's messages.
        public let id: String
        /// The server's message ID; nil while sending.
        public let serverId: String?
        /// The ID the SDK generated when the user sent it.
        public let clientId: String?
        /// Position in the conversation; nil while sending.
        public let seq: Int?
        public let sender: Sender
        public let text: String
        /// A review request or an offer, shown as a button.
        public let card: Card?
        /// Who wrote a team reply, as far as the app shows it (team names and photos are dashboard switches).
        public let author: Author?
        /// Written by the AI, so the chat can label it.
        public let isByAI: Bool
        public let attachments: [Attachment]
        public let createdAt: Date
        public let status: Status
        /// The first tap on the card's button.
        public let actionClickedAt: Date?

        init(_ wire: WireMessage) {
            let clientId = wire.clientId?.lowercased()
            id = clientId.map { "c:\($0)" } ?? "m:\(wire.id)"
            serverId = wire.id
            self.clientId = clientId
            seq = wire.seq
            sender = wire.sender == "user" ? .user : .team
            text = wire.text
            card = Card(wire.card)
            author = wire.sender == "user" ? nil : wire.author.flatMap(Author.init)
            isByAI = wire.byAi
            attachments = wire.attachments.compactMap(Attachment.init)
            createdAt = ISODate.parse(wire.createdAt) ?? Date(timeIntervalSince1970: 0)
            status = .sent
            actionClickedAt = ISODate.parse(wire.actionClickedAt)
        }

        init(pending item: OutboxItem, photoURL: (OutboxPhoto) -> URL) {
            id = "c:\(item.clientId)"
            serverId = nil
            clientId = item.clientId
            seq = nil
            sender = .user
            text = item.text
            card = nil
            author = nil
            isByAI = false
            attachments = item.photos.map {
                Attachment(id: $0.file, source: .local(photoURL($0)), contentType: $0.contentType, width: $0.width, height: $0.height)
            }
            createdAt = item.createdAt
            status = item.failure.map { .failed(HireShelbyError.Code(rawValue: $0)) } ?? .sending
            actionClickedAt = nil
        }
    }

    /// A card: an agent message with a button.
    public enum Card: Equatable, Sendable {
        /// Asks for an App Store rating. With no `url` (the app has no App Store ID set), show the text only.
        /// A nil `buttonLabel` means the SDK's default ("Rate on the App Store").
        case review(url: URL?, buttonLabel: String?)
        /// Opens one of the app's paywalls. A nil `buttonLabel` means "View offer".
        case offer(paywallId: String, buttonLabel: String?)

        init?(_ wire: WireCard?) {
            switch wire {
            case .review(let url, let label)?: self = .review(url: url.flatMap(URL.init(string:)), buttonLabel: label)
            case .paywall(let id, let label)?: self = .offer(paywallId: id, buttonLabel: label)
            default: return nil
            }
        }
    }

    /// The teammate behind a reply.
    public struct Author: Equatable, Sendable {
        /// First name, with "Show team names" on.
        public let name: String?
        /// Fallback for a missing photo, with "Show team photos" on.
        public let initial: String?
        /// A temporary photo link, with "Show team photos" on.
        public let photoURL: URL?

        init?(_ wire: WireAuthor) {
            name = wire.name
            initial = wire.initial
            photoURL = wire.photoUrl.flatMap(URL.init(string:))
            if name == nil && initial == nil && photoURL == nil { return nil }
        }
    }

    /// A photo on a message.
    public struct Attachment: Identifiable, Equatable, Sendable {
        public enum Source: Equatable, Sendable {
            /// A signed link that works for 15 minutes; see ``HireShelbyConversation/reload(_:)``.
            case remote(URL)
            /// A file on the device, while the message is sending.
            case local(URL)
        }

        public let id: String
        public let source: Source
        public let contentType: String
        public let width: Int
        public let height: Int

        init(id: String, source: Source, contentType: String, width: Int, height: Int) {
            self.id = id
            self.source = source
            self.contentType = contentType
            self.width = width
            self.height = height
        }

        init?(_ wire: WireAttachment) {
            guard let url = URL(string: wire.url) else { return nil }
            self.init(id: wire.id, source: .remote(url), contentType: wire.contentType, width: wire.width, height: wire.height)
        }
    }

    /// Whether the user can send, and why not.
    public struct SendingState: Equatable, Sendable {
        public enum Restriction: Equatable, Sendable {
            /// The team blocked this device; it can still read.
            case deviceBlocked
            /// Only verified users can chat in this app: show "Sign in to send messages."
            case verificationRequired
        }

        public var isAllowed: Bool
        public var restriction: Restriction?

        public static let allowed = SendingState(isAllowed: true, restriction: nil)

        init(isAllowed: Bool, restriction: Restriction?) {
            self.isAllowed = isAllowed
            self.restriction = restriction
        }

        init(_ wire: WireSending) {
            isAllowed = wire.allowed
            switch wire.reason {
            case "device_blocked": restriction = .deviceBlocked
            case "verification_required": restriction = .verificationRequired
            default: restriction = nil
            }
        }
    }

    /// AI replies in this chat. When the app's team turns them on, the chat asks the person first and the AI
    /// answers only those who allow it (App Review guideline 5.1.2(i)); the team answers everyone.
    public struct AIReplies: Equatable, Sendable {
        public enum Consent: String, Equatable, Sendable {
            case granted
            case declined
        }

        /// The app's AI may answer in this chat (once the person allows it).
        public var isEnabled: Bool
        /// The person's choice; nil until they make one.
        public var consent: Consent?
        /// Who receives the person's messages to write AI replies ("OpenRouter", "Anthropic"), to name when asking.
        public var processors: [String]

        /// Ask now: AI replies are on and the person hasn't chosen.
        public var needsConsent: Bool { isEnabled && consent == nil }
        /// The AI answers this person.
        public var isAllowed: Bool { isEnabled && consent == .granted }

        public static let off = AIReplies(isEnabled: false, consent: nil, processors: [])

        public init(isEnabled: Bool, consent: Consent?, processors: [String]) {
            self.isEnabled = isEnabled
            self.consent = consent
            self.processors = processors
        }

        init(_ wire: WireAI) {
            self.init(isEnabled: wire.enabled, consent: wire.consent.flatMap(Consent.init(rawValue:)), processors: wire.processors)
        }
    }

    /// The chat's connection to the API while it's on screen.
    public enum ConnectionState: Equatable, Sendable {
        /// The chat isn't on screen.
        case idle
        case connecting
        /// Live updates are on.
        case live
        /// The API can't be reached; pending messages wait.
        case offline
    }

    /// A teammate is typing.
    public struct Typing: Equatable, Sendable {
        /// Their first name, when the app shows team names.
        public let name: String?
        public let expiresAt: Date
    }

    /// What a tap on a card's button should do. The SDK records the tap; the UI performs the action.
    public enum CardAction: Equatable, Sendable {
        /// Open the App Store's write-review page.
        case openReview(URL)
        /// Call the app's paywall handler with this paywall ID.
        case presentPaywall(id: String)
        /// The offer's paywall isn't available in the app any more ("No longer available").
        case unavailable
    }
}
