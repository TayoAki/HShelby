import Foundation
import XCTest
@testable import HireShelbyCore

/// The API's JSON, decoded from fixtures shaped like real responses (apps/api/src/routes/sdk.ts).
final class ModelTests: XCTestCase {
    func testDecodesDeviceSession() throws {
        let session = try JSONDecoder().decode(WireDeviceSession.self, from: fixture("device-session"))
        XCTAssertTrue(session.deviceSecret.hasPrefix("dvs_"))
        XCTAssertEqual(session.expiresIn, 900)
        XCTAssertEqual(session.identity, WireIdentity(userId: nil, name: nil, email: nil, verified: false))
    }

    func testDecodesSyncWithEveryMessageKind() throws {
        let sync = try JSONDecoder().decode(WireSync.self, from: fixture("sync"))
        XCTAssertEqual(sync.identity.userId, "user_42")
        XCTAssertTrue(sync.identity.verified)
        XCTAssertTrue(sync.sending.allowed)
        XCTAssertEqual(sync.conversation?.unread, 3)
        XCTAssertEqual(sync.conversation?.userReadSeq, 8)
        XCTAssertTrue(sync.hasMore)
        XCTAssertEqual(sync.messages.map(\.seq), [7, 8, 9, 10, 11, 12])
        XCTAssertEqual(sync.messages[1].attachments.first?.width, 1536)
        XCTAssertEqual(sync.messages[2].author?.photoUrl?.hasPrefix("https://"), true)
        XCTAssertTrue(sync.messages[3].byAi)
        XCTAssertEqual(sync.messages[4].card, .review(url: "https://apps.apple.com/app/id1234567890?action=write-review", buttonLabel: nil))
        XCTAssertEqual(sync.messages[5].card, .paywall(paywallId: "pro_yearly", buttonLabel: "See the deal"))
        XCTAssertEqual(sync.messages[5].actionClickedAt, "2026-11-12T10:07:42.500Z")
    }

    func testMapsMessagesForTheChat() throws {
        let sync = try JSONDecoder().decode(WireSync.self, from: fixture("sync"))
        let messages = sync.messages.map(HireShelbyConversation.Message.init)

        // the user's own messages are keyed by their (lowercased) clientId, so pending and sent rows match
        XCTAssertEqual(messages[0].id, "c:6f1c2e0a-3b4d-4e5f-8a9b-0c1d2e3f4a5b")
        XCTAssertEqual(messages[0].sender, .user)
        XCTAssertEqual(messages[0].status, .sent)
        XCTAssertNil(messages[0].author)
        XCTAssertEqual(messages[0].text, "Hi! The export button does nothing 😕")

        XCTAssertEqual(messages[1].attachments.count, 1)
        if case .remote(let url) = messages[1].attachments[0].source {
            XCTAssertEqual(url.host, "bucket.example.com")
        } else {
            XCTFail("expected a remote photo")
        }

        XCTAssertEqual(messages[2].id, "m:0192f0c1-7b2a-789c-8d4e-1f2a3b4c5d03")
        XCTAssertEqual(messages[2].sender, .team)
        XCTAssertEqual(messages[2].author?.name, "Sam")
        XCTAssertEqual(messages[2].author?.photoURL?.host, "bucket.example.com")
        XCTAssertFalse(messages[2].isByAI)

        XCTAssertTrue(messages[3].isByAI)
        XCTAssertEqual(messages[3].author?.name, "Shelby")

        XCTAssertEqual(messages[4].card, .review(url: URL(string: "https://apps.apple.com/app/id1234567890?action=write-review"), buttonLabel: nil))
        XCTAssertEqual(messages[5].card, .offer(paywallId: "pro_yearly", buttonLabel: "See the deal"))
        XCTAssertNotNil(messages[5].actionClickedAt)

        let created = try XCTUnwrap(ISODate.parse("2026-11-12T10:01:00.000Z"))
        XCTAssertEqual(messages[2].createdAt, created)
    }

    /// `real-*.json` were captured from the API (apps/api, run locally) after a device registered, sent a message,
    /// and a teammate replied, sent a review card (from a scenario, so with no text) and an offer it tapped.
    func testDecodesResponsesCapturedFromTheAPI() throws {
        let decoder = JSONDecoder()
        let session = try decoder.decode(WireDeviceSession.self, from: fixture("real-device-session"))
        XCTAssertEqual(session.identity.userId, "user_42")
        XCTAssertEqual(session.expiresIn, 900)

        let sent = try decoder.decode(WireSendResult.self, from: fixture("real-send-result"))
        XCTAssertEqual(sent.message.sender, "user")
        XCTAssertNotNil(sent.message.clientId)

        let sync = try decoder.decode(WireSync.self, from: fixture("real-sync"))
        let messages = sync.messages.map(HireShelbyConversation.Message.init)
        XCTAssertEqual(messages.map(\.sender), [.user, .team, .team, .team])
        XCTAssertEqual(messages[1].author?.name, "SDK", "first names only")
        XCTAssertEqual(messages[1].author?.initial, "S")
        XCTAssertEqual(messages[2].text, "", "a review card from a scenario carries no text")
        XCTAssertEqual(messages[2].card, .review(url: URL(string: "https://apps.apple.com/app/id1234567890?action=write-review"), buttonLabel: nil))
        XCTAssertEqual(messages[3].card, .offer(paywallId: "pro_yearly", buttonLabel: "See the deal"))
        XCTAssertNotNil(messages[3].actionClickedAt)
        XCTAssertEqual(sync.conversation?.unread, 3)
        XCTAssertFalse(sync.hasMore)

        let empty = try decoder.decode(WireSync.self, from: fixture("real-sync-empty"))
        XCTAssertNil(empty.conversation)
        XCTAssertTrue(try decoder.decode(WireClickResult.self, from: fixture("real-click-result")).first)
        XCTAssertEqual(try decoder.decode(WireUnread.self, from: fixture("real-unread")).unread, 3)
        XCTAssertEqual(try decoder.decode(WireTrackedEvents.self, from: fixture("real-tracked-events")).ttlSeconds, 300)
        XCTAssertEqual(try decoder.decode(WireDeviceUpdateResult.self, from: fixture("real-device-update")).identity.email, "alex@example.com")
        let appearance = HireShelbyAppearance(try decoder.decode(WirePublicAppearance.self, from: fixture("real-appearance-unpublished")))
        XCTAssertTrue(appearance.showsTeamNames && appearance.showsTeamPhotos)

        let validation = APIClient.error(from: HTTPResponse(status: 400, body: try fixture("real-error-validation")))
        XCTAssertEqual(validation.code, .validationFailed)
        XCTAssertTrue(validation.message.hasPrefix("clientId: "))
        let unauthorized = APIClient.error(from: HTTPResponse(status: 401, body: try fixture("real-error-unauthorized")))
        XCTAssertEqual(unauthorized.code, .unauthorized)
    }

    func testDecodesEmptySyncWithSendingRestriction() throws {
        let sync = try JSONDecoder().decode(WireSync.self, from: fixture("sync-empty"))
        XCTAssertNil(sync.conversation)
        XCTAssertTrue(sync.messages.isEmpty)
        let sending = HireShelbyConversation.SendingState(sync.sending)
        XCTAssertFalse(sending.isAllowed)
        XCTAssertEqual(sending.restriction, .verificationRequired)
    }

    func testToleratesUnknownCardsAndMissingOptionalFields() throws {
        let json = """
        {"id":"m1","seq":1,"sender":"agent","kind":"poll","text":"Pick one","card":{"type":"poll","options":["a"]},
         "actionClickedAt":null,"author":null,"clientId":null,"createdAt":"2026-11-12T10:00:00.000Z"}
        """
        let message = try JSONDecoder().decode(WireMessage.self, from: Data(json.utf8))
        XCTAssertEqual(message.card, .unknown(type: "poll"))
        XCTAssertFalse(message.byAi)
        XCTAssertEqual(message.attachments, [])
        XCTAssertNil(HireShelbyConversation.Message(message).card)
        XCTAssertEqual(HireShelbyConversation.Message(message).text, "Pick one")
    }

    func testDecodesSendResultTicketAndSmallResponses() throws {
        let sent = try JSONDecoder().decode(WireSendResult.self, from: fixture("send-result"))
        XCTAssertEqual(sent.message.clientId, "2d7c9e1f-5a4b-4c3d-8e2f-1a0b9c8d7e6f")
        XCTAssertEqual(sent.conversation.lastSeq, 13)

        let ticket = try JSONDecoder().decode(WireUploadTicket.self, from: fixture("upload-ticket"))
        XCTAssertEqual(ticket.method, "PUT")
        XCTAssertEqual(ticket.headers["x-amz-checksum-sha256"], "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=")
        XCTAssertEqual(ticket.expiresIn, 900)

        XCTAssertEqual(try JSONDecoder().decode(WireUnread.self, from: fixture("unread")).unread, 2)
        XCTAssertEqual(try JSONDecoder().decode(WireDeviceUpdateResult.self, from: fixture("device-update")).identity.userId, "user_42")
        let track = try JSONDecoder().decode(WireTrackResult.self, from: fixture("track-result"))
        XCTAssertTrue(track.sent && track.openChat)
        XCTAssertEqual(try JSONDecoder().decode(WireTrackedEvents.self, from: fixture("tracked-events")).events, ["checkout_cancelled", "paywall_declined"])
        XCTAssertFalse(try JSONDecoder().decode(WireClickResult.self, from: fixture("click-result")).first)
    }

    func testReadsErrorBodies() throws {
        let response = HTTPResponse(status: 429, headers: ["Retry-After": "7"], body: try fixture("error-rate-limited"))
        let error = APIClient.error(from: response)
        XCTAssertEqual(error.code, .rateLimited)
        XCTAssertEqual(error.status, 429)
        XCTAssertEqual(error.retryAfter, 7)
        XCTAssertTrue(error.isTransient)

        let html = APIClient.error(from: HTTPResponse(status: 502, body: Data("<html>Bad gateway</html>".utf8)))
        XCTAssertEqual(html.code, .internalError)
        XCTAssertTrue(html.isTransient)

        let validation = APIClient.error(from: .error(400, "validation_failed", "text: Too big"))
        XCTAssertEqual(validation.code, .validationFailed)
        XCTAssertFalse(validation.isTransient)
    }

    func testReadsPublishedAppearance() throws {
        let wire = try JSONDecoder().decode(WirePublicAppearance.self, from: fixture("appearance"))
        let appearance = HireShelbyAppearance(wire)
        XCTAssertEqual(appearance.version, 3)
        XCTAssertTrue(appearance.showsTeamNames)
        XCTAssertTrue(appearance.showsTeamPhotos)
        XCTAssertEqual(appearance.accent, .init(light: "#FF4B2B", dark: "#FF8A70"))
        XCTAssertEqual(appearance.chatBackground, .init(light: nil, dark: "#101010"))
        XCTAssertNil(appearance.incomingBackground, "an invalid color is skipped, not fatal")
        XCTAssertEqual(appearance.colorScheme, .app)
        XCTAssertEqual(appearance.hidesWelcomeText, true)
        XCTAssertEqual(appearance.welcomeIcon, .remote(URL(string: "https://api.hireshelby.com/v1/assets/7d1e9a52-3c4b-4f6a-9e1d-2b3c4d5e6f70.png")!))
        XCTAssertEqual(appearance.welcomeIconSize, 64)
        XCTAssertEqual(appearance.welcomeIconOffset, .init(x: 0, y: -8))
        XCTAssertEqual(appearance.fontDesign, .rounded)
        XCTAssertEqual(appearance.closeIcon, .symbol("chevron.down"))
        XCTAssertEqual(appearance.cardButtonIcon, .symbol("star.fill"))
        XCTAssertEqual(appearance.cardTrailingIcon, .hidden)
        XCTAssertEqual(appearance.cardButtonTextColor, .init(light: "#FFFFFF", dark: "#000000"))

        // texts: exact tag, then the base language, else the app's own
        XCTAssertEqual(HireShelbyAppearance.localized(appearance.title, languages: ["pt-BR"]), "Ajuda")
        XCTAssertEqual(HireShelbyAppearance.localized(appearance.title, languages: ["de-AT"]), "Hilfe")
        XCTAssertEqual(HireShelbyAppearance.localized(appearance.title, languages: ["pt_PT", "en"]), "Help")
        XCTAssertNil(HireShelbyAppearance.localized(appearance.title, languages: ["fr"]))

        let unpublished = HireShelbyAppearance(try JSONDecoder().decode(WirePublicAppearance.self, from: fixture("appearance-unpublished")))
        XCTAssertNil(unpublished.accent)
        XCTAssertTrue(unpublished.showsTeamNames)
        XCTAssertFalse(unpublished.showsTeamPhotos)
    }

    func testLocalAppearanceOnlySendsWhatTheAPIAccepts() throws {
        var local = HireShelbyLocalAppearance()
        local.accent = .init(light: "#ff4b2b", dark: "nope")
        local.chatBackground = .init(light: "#FFFFFF")
        local.fontDesign = .rounded
        local.title = ["en": "Support", "EN_us": "bad tag", "de": String(repeating: "x", count: 41)]
        let json = try XCTUnwrap(local.json)
        let data = try JSONEncoder().encode(json)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual((object["colors"] as? [String: Any])?.keys.sorted(), ["accent", "chatBackground"])
        XCTAssertEqual(((object["colors"] as? [String: Any])?["accent"] as? [String: String]), ["light": "#FF4B2B"])
        XCTAssertEqual(object["fontDesign"] as? String, "rounded")
        XCTAssertEqual(object["title"] as? [String: String], ["en": "Support"])
        XCTAssertNil(HireShelbyLocalAppearance().json)
    }

    func testParsesLiveEvents() {
        XCTAssertEqual(WireLiveEvent(json: #"{"type":"ready"}"#), .ready)
        XCTAssertEqual(WireLiveEvent(json: #"{"type":"message","seq":14}"#), .message(seq: 14))
        XCTAssertEqual(WireLiveEvent(json: #"{"type":"read","seq":13}"#), .read(seq: 13))
        XCTAssertEqual(WireLiveEvent(json: #"{"type":"typing","name":"Sam"}"#), .typing(name: "Sam"))
        XCTAssertEqual(WireLiveEvent(json: #"{"type":"typing","name":null}"#), .typing(name: nil))
        XCTAssertEqual(WireLiveEvent(json: #"{"type":"resync"}"#), .resync)
        XCTAssertNil(WireLiveEvent(json: #"{"type":"presence"}"#))
        XCTAssertNil(WireLiveEvent(json: "not json"))
        XCTAssertEqual(WireLiveCommand.heartbeat.json, #"{"type":"heartbeat"}"#)
        XCTAssertEqual(WireLiveCommand.typing.json, #"{"type":"typing"}"#)
    }

    func testReadsTheUserIdOfAnIdentityToken() {
        func token(_ claims: String) -> String {
            let payload = Data(claims.utf8).base64EncodedString()
                .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            return "eyJhbGciOiJIUzI1NiJ9.\(payload).c2ln"
        }
        XCTAssertEqual(IdentityToken.userId(in: token(#"{"user_id":"u_1","exp":1}"#)), .success("u_1"))
        XCTAssertEqual(IdentityToken.userId(in: token(#"{"user_id":12345,"exp":1}"#)), .success("12345"))
        XCTAssertEqual(IdentityToken.userId(in: token(#"{"sub":"u_1","exp":1}"#)), .failure(.malformed))
        XCTAssertEqual(IdentityToken.userId(in: "ids_secret"), .failure(.looksLikeSecret))
        XCTAssertEqual(IdentityToken.userId(in: "a.b"), .failure(.malformed))
        XCTAssertEqual(IdentityToken.userId(in: String(repeating: "a", count: 5000)), .failure(.tooLong))
    }

    func testSHA256MatchesKnownVectors() {
        let vectors: [(Data, String)] = [
            (Data(), "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="),
            (Data("abc".utf8), "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="),
            (Data("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8), "JI1qYdIGOLjlwCaTDD5gOaM85Flk/yFn9uzt1BnbBsE="),
            (Data(repeating: UInt8(ascii: "a"), count: 1_000_000), "zcduXJkU+5KBocfihNc+Z/GAmkiklyAOBG05zMcRLNA="),
        ]
        for (data, expected) in vectors {
            XCTAssertEqual(Data(SHA256Digest.portableHash(data)).base64EncodedString(), expected)
            XCTAssertEqual(SHA256Digest.base64(of: data), expected)
        }
    }

    func testReadsImageHeaders() throws {
        var png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13])
        png.append(contentsOf: Array("IHDR".utf8))
        png.append(contentsOf: [0, 0, 0x03, 0x20, 0, 0, 0x02, 0x58, 8, 6, 0, 0, 0])
        XCTAssertEqual(ImageHeader.inspect(png), .init(contentType: .png, width: 800, height: 600))

        // SOI, an APP0 segment, then SOF0 with 2048 × 1536
        var jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
        jpeg.append(contentsOf: [UInt8](repeating: 0, count: 14))
        jpeg.append(contentsOf: [0xFF, 0xC0, 0x00, 0x11, 0x08, 0x06, 0x00, 0x08, 0x00, 0x03, 0x01, 0x22, 0x00])
        jpeg.append(contentsOf: [UInt8](repeating: 0, count: 8))
        XCTAssertEqual(ImageHeader.inspect(jpeg), .init(contentType: .jpeg, width: 2048, height: 1536))

        XCTAssertNil(ImageHeader.inspect(Data("GIF89a".utf8)))
        let photo = try HireShelbyPhoto(data: jpeg)
        XCTAssertEqual(photo.contentType, .jpeg)
        XCTAssertEqual(photo.checksum, SHA256Digest.base64(of: jpeg))
        XCTAssertThrowsError(try HireShelbyPhoto(data: Data("GIF89a".utf8)))

        var huge = jpeg
        huge.replaceSubrange(25..<29, with: [0x10, 0x00, 0x10, 0x00]) // 4096 × 4096
        XCTAssertThrowsError(try HireShelbyPhoto(data: huge)) { error in
            XCTAssertEqual((error as? HireShelbyError)?.code, .invalidInput)
        }
    }

    func testReadsTheAPSEnvironmentOfAProvisioningProfile() {
        let profile = """
        garbage-before<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict><key>Entitlements</key><dict><key>aps-environment</key><string>development</string></dict></dict></plist>garbage-after
        """
        XCTAssertEqual(HireShelbyPushEnvironment.apsEnvironment(inProvisioningProfile: Data(profile.utf8)), "sandbox")
        XCTAssertEqual(
            HireShelbyPushEnvironment.apsEnvironment(inProvisioningProfile: Data(profile.replacingOccurrences(of: "development", with: "production").utf8)),
            "production"
        )
        XCTAssertNil(HireShelbyPushEnvironment.apsEnvironment(inProvisioningProfile: Data("nothing".utf8)))
        XCTAssertEqual(HireShelbyPushEnvironment.sandbox.resolved, "sandbox")
    }
}
