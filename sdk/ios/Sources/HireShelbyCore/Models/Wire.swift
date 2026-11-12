import Foundation

/*
 * The /v1 API's JSON, field for field (packages/contracts/src: messaging.ts, identity.ts, cards.ts, photos.ts,
 * push.ts, automations.ts, appearance.ts, realtime.ts). Responses decode leniently where the API might grow
 * (unknown enum values, fields added later); requests encode exactly what the API's strict schemas accept.
 */

// MARK: - Responses

/// `SdkIdentity`: who the device is, as the server sees it.
struct WireIdentity: Codable, Equatable, Sendable {
    var userId: String?
    var name: String?
    var email: String?
    var verified: Bool
}

/// `AccessToken`: `POST /v1/session/refresh`.
struct WireAccessToken: Decodable, Sendable {
    let accessToken: String
    let expiresIn: Int
}

/// `DeviceSession`: `POST /v1/devices` (201).
struct WireDeviceSession: Decodable, Sendable {
    let accessToken: String
    let expiresIn: Int
    let deviceSecret: String
    let identity: WireIdentity
}

/// `DeviceUpdateResult`: `PATCH /v1/device`.
struct WireDeviceUpdateResult: Decodable, Sendable {
    let identity: WireIdentity
}

/// `SdkCard`: a review request or an offer.
enum WireCard: Codable, Equatable, Sendable {
    case review(url: String?, buttonLabel: String?)
    case paywall(paywallId: String, buttonLabel: String?)
    /// A card type this SDK version doesn't know; shown as its text only.
    case unknown(type: String)

    private enum Keys: String, CodingKey { case type, url, buttonLabel, paywallId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "review":
            self = .review(url: try c.decodeIfPresent(String.self, forKey: .url), buttonLabel: try c.decodeIfPresent(String.self, forKey: .buttonLabel))
        case "paywall":
            self = .paywall(paywallId: try c.decode(String.self, forKey: .paywallId), buttonLabel: try c.decodeIfPresent(String.self, forKey: .buttonLabel))
        default:
            self = .unknown(type: type)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .review(let url, let label):
            try c.encode("review", forKey: .type)
            try c.encode(url, forKey: .url)
            try c.encode(label, forKey: .buttonLabel)
        case .paywall(let id, let label):
            try c.encode("paywall", forKey: .type)
            try c.encode(id, forKey: .paywallId)
            try c.encode(label, forKey: .buttonLabel)
        case .unknown(let type):
            try c.encode(type, forKey: .type)
        }
    }
}

/// The teammate behind a reply, as the app shows it (names and photos are per-app switches).
struct WireAuthor: Codable, Equatable, Sendable {
    var name: String?
    var initial: String?
    var photoUrl: String?
}

/// `Attachment`: a photo; `url` is a signed link that works for 15 minutes.
struct WireAttachment: Codable, Equatable, Sendable {
    let id: String
    let url: String
    let contentType: String
    let width: Int
    let height: Int
}

/// `SdkMessage`.
struct WireMessage: Codable, Equatable, Sendable {
    let id: String
    let seq: Int
    /// "user" or "agent".
    let sender: String
    /// "text", "review" or "paywall".
    let kind: String
    let text: String
    let card: WireCard?
    let actionClickedAt: String?
    let author: WireAuthor?
    let byAi: Bool
    /// Set on the device's own messages.
    let clientId: String?
    let attachments: [WireAttachment]
    let createdAt: String

    private enum Keys: String, CodingKey {
        case id, seq, sender, kind, text, card, actionClickedAt, author, byAi, clientId, attachments, createdAt
    }

    init(
        id: String, seq: Int, sender: String, kind: String = "text", text: String, card: WireCard? = nil,
        actionClickedAt: String? = nil, author: WireAuthor? = nil, byAi: Bool = false, clientId: String? = nil,
        attachments: [WireAttachment] = [], createdAt: String
    ) {
        self.id = id
        self.seq = seq
        self.sender = sender
        self.kind = kind
        self.text = text
        self.card = card
        self.actionClickedAt = actionClickedAt
        self.author = author
        self.byAi = byAi
        self.clientId = clientId
        self.attachments = attachments
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = try c.decode(String.self, forKey: .id)
        seq = try c.decode(Int.self, forKey: .seq)
        sender = try c.decode(String.self, forKey: .sender)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "text"
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        // a card this SDK can't read must not hide the message
        card = (try? c.decodeIfPresent(WireCard.self, forKey: .card)) ?? nil
        actionClickedAt = try c.decodeIfPresent(String.self, forKey: .actionClickedAt)
        author = (try? c.decodeIfPresent(WireAuthor.self, forKey: .author)) ?? nil
        byAi = try c.decodeIfPresent(Bool.self, forKey: .byAi) ?? false
        clientId = try c.decodeIfPresent(String.self, forKey: .clientId)
        attachments = (try? c.decodeIfPresent([WireAttachment].self, forKey: .attachments)) ?? []
        createdAt = try c.decode(String.self, forKey: .createdAt)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(id, forKey: .id)
        try c.encode(seq, forKey: .seq)
        try c.encode(sender, forKey: .sender)
        try c.encode(kind, forKey: .kind)
        try c.encode(text, forKey: .text)
        try c.encode(card, forKey: .card)
        try c.encode(actionClickedAt, forKey: .actionClickedAt)
        try c.encode(author, forKey: .author)
        try c.encode(byAi, forKey: .byAi)
        try c.encode(clientId, forKey: .clientId)
        try c.encode(attachments, forKey: .attachments)
        try c.encode(createdAt, forKey: .createdAt)
    }

    /// Copy with a newer server view of the same message (fresh photo links, a recorded tap).
    func withActionClickedAt(_ value: String?) -> WireMessage {
        WireMessage(
            id: id, seq: seq, sender: sender, kind: kind, text: text, card: card, actionClickedAt: value,
            author: author, byAi: byAi, clientId: clientId, attachments: attachments, createdAt: createdAt
        )
    }
}

/// `SdkConversation`.
struct WireConversation: Codable, Equatable, Sendable {
    let id: String
    /// "open" or "closed".
    let status: String
    let lastSeq: Int
    let userReadSeq: Int
    let unread: Int
}

/// `SdkSending`: whether the device may send, and why not.
struct WireSending: Codable, Equatable, Sendable {
    let allowed: Bool
    /// "device_blocked", "verification_required" or null.
    let reason: String?
}

/// `SdkSync`: `GET /v1/conversation`. `conversation` is null until the device's first message.
struct WireSync: Decodable, Sendable {
    let identity: WireIdentity
    let sending: WireSending
    let conversation: WireConversation?
    let messages: [WireMessage]
    let hasMore: Bool
}

/// `SdkSendResult`: `POST /v1/messages` (201 new, 200 when the clientId was already sent).
struct WireSendResult: Decodable, Sendable {
    let message: WireMessage
    let conversation: WireConversation
}

/// `UploadTicket`: `POST /v1/uploads`.
struct WireUploadTicket: Decodable, Sendable {
    let attachmentId: String
    let uploadUrl: String
    let method: String
    let headers: [String: String]
    let expiresIn: Int
}

/// `Unread`: `GET /v1/unread` and `POST /v1/read`.
struct WireUnread: Decodable, Sendable {
    let unread: Int
}

/// `ActionClickResult`: `POST /v1/actions/:messageId/click`.
struct WireClickResult: Decodable, Sendable {
    let actionClickedAt: String
    let first: Bool
}

/// `TrackResult`: `POST /v1/track`.
struct WireTrackResult: Decodable, Sendable {
    let sent: Bool
    let openChat: Bool
}

/// `TrackedEvents`: `GET /v1/track/events`.
struct WireTrackedEvents: Decodable, Sendable {
    let events: [String]
    let ttlSeconds: Int
}

/// `PublicAppearance`: `GET /v1/apps/:appId/appearance`.
struct WirePublicAppearance: Codable, Equatable, Sendable {
    struct Team: Codable, Equatable, Sendable {
        let showPhotos: Bool
        let showNames: Bool
    }
    let version: Int
    let appearance: JSONValue?
    let team: Team
}

// MARK: - Requests

/// `DeviceDetails`: every field optional; empty strings mean "unknown".
struct WireDeviceDetails: Codable, Equatable, Sendable {
    var model: String?
    var osVersion: String?
    var appVersion: String?
    var sdkVersion: String?
    var locale: String?
    var timezone: String?
}

/// `IdentityLabels`: omitted fields keep the server's value.
struct WireIdentityLabels: Codable, Equatable, Sendable {
    var userId: String?
    var name: String?
    var email: String?

    var isEmpty: Bool { userId == nil && name == nil && email == nil }

    /// identify() semantics: a nil field keeps the earlier value.
    func merging(_ newer: WireIdentityLabels) -> WireIdentityLabels {
        WireIdentityLabels(userId: newer.userId ?? userId, name: newer.name ?? name, email: newer.email ?? email)
    }
}

/// `PushRegistration`: the raw APNs token in lowercase hex.
struct WirePushRegistration: Codable, Equatable, Sendable {
    var token: String
    /// "sandbox" or "production".
    var environment: String
    var updatesAppBadge: Bool
}

/// `PaywallProduct`.
struct WirePaywallProduct: Codable, Equatable, Sendable {
    var id: String
    var price: String?
    var period: String?
    var trial: String?
}

/// `ReportedPaywall`.
struct WirePaywall: Codable, Equatable, Sendable {
    var id: String
    var title: String
    /// "revenuecat", "superwall", "adapty" or "app".
    var source: String
    var presentable: Bool
    var products: [WirePaywallProduct]
}

/// The `storekit` part of a device update: whether the person pays, and their original transaction IDs.
struct WireStoreKit: Codable, Equatable, Sendable {
    var paying: Bool?
    var originalTransactionIds: [String]?
}

/// `POST /v1/messages`.
struct WireSendMessage: Encodable, Sendable {
    let clientId: String
    let text: String
    let attachmentIds: [String]
}

/// `POST /v1/uploads`.
struct WireUploadRequest: Encodable, Sendable {
    let contentType: String
    let bytes: Int
    let width: Int
    let height: Int
    let checksum: String
}

/// `POST /v1/read`.
struct WireReadInput: Encodable, Sendable {
    let seq: Int
}

/// `POST /v1/actions/:messageId/click`.
struct WireClickInput: Encodable, Sendable {
    let clickedAt: String?
}

/// `POST /v1/track`.
struct WireTrackInput: Encodable, Sendable {
    let event: String
}

/// `POST /v1/session/refresh` and `POST /v1/session/logout`.
struct WireDeviceSecretInput: Encodable, Sendable {
    let deviceSecret: String
}

// MARK: - Live (`/v1/live`)

/// `SdkLiveEvent`: what changed, never the data.
enum WireLiveEvent: Equatable, Sendable {
    case ready
    case message(seq: Int)
    case read(seq: Int)
    case typing(name: String?)
    case resync

    init?(json text: String) {
        guard
            let data = text.data(using: .utf8),
            let value = try? JSONDecoder().decode(JSONValue.self, from: data),
            let type = value["type"]?.stringValue
        else { return nil }
        switch type {
        case "ready": self = .ready
        case "resync": self = .resync
        case "message":
            guard let seq = value["seq"]?.doubleValue else { return nil }
            self = .message(seq: Int(seq))
        case "read":
            guard let seq = value["seq"]?.doubleValue else { return nil }
            self = .read(seq: Int(seq))
        case "typing": self = .typing(name: value["name"]?.stringValue)
        default: return nil
        }
    }
}

/// `SdkLiveCommand`.
enum WireLiveCommand: String, Sendable {
    case typing
    case heartbeat

    var json: String { #"{"type":"\#(rawValue)"}"# }
}
