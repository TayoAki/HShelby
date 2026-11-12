import Foundation
import XCTest
@testable import HireShelbyCore

/// The conversation: optimistic sends through the outbox (order, dedupe, persistence, failures), photos, paging,
/// read state and cards.
@MainActor
final class ConversationTests: XCTestCase {
    private func sentTexts(_ http: StubHTTP) -> [String] {
        http.requests.filter { $0.summary == "POST /v1/messages" }.compactMap { $0.jsonBody?["text"] as? String }
    }

    func testSendsInOrderOnceBackOnline() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()
        try await client.flush()

        // offline: every attempt fails before leaving the device
        api.fail("POST /v1/messages", with: .connectionError(.notConnectedToInternet), times: 1000)
        let conversation = client.conversation
        conversation.send(text: "one")
        conversation.send(text: "two")
        conversation.send(text: "three")
        XCTAssertEqual(conversation.messages.map(\.text), ["one", "two", "three"])
        XCTAssertTrue(conversation.messages.allSatisfy { $0.sender == .user && $0.serverId == nil })

        await eventually("a failed state after retries") { conversation.messages.first?.status == .failed(.connectionFailed) }
        XCTAssertTrue(sentTexts(http).allSatisfy { $0 == "one" }, "later messages never overtake the first")

        api.clearFaults()
        conversation.networkBecameAvailable()
        await eventually("delivery") { conversation.messages.allSatisfy { $0.status == .sent } }

        let delivered = try XCTUnwrap(api.allDevices.first).messages
        XCTAssertEqual(delivered.map(\.text), ["one", "two", "three"])
        XCTAssertEqual(delivered.map(\.seq), [1, 2, 3])
        XCTAssertEqual(conversation.messages.map(\.seq), [1, 2, 3])
        XCTAssertFalse(conversation.hasPendingMessages)
    }

    func testDeduplicatesByClientIdWhenTheAnswerWasLost() async throws {
        let api = FakeAPI()
        let http = StubHTTP()
        let lost = Locked(true)
        http.setHandler { request in
            let response = try await api.handle(request)
            // the server stores the message but the answer never arrives
            if request.summary == "POST /v1/messages", lost.withLock({ value in defer { value = false }; return value }) {
                throw URLError(.networkConnectionLost)
            }
            return response
        }
        let client = try makeClient(api: api, http: http)
        client.start()
        client.conversation.send(text: "hello")
        await eventually("delivery") { client.conversation.messages.first?.status == .sent }

        let posts = http.requests.filter { $0.summary == "POST /v1/messages" }
        XCTAssertEqual(posts.count, 2, "retried")
        XCTAssertEqual(posts[0].jsonBody?["clientId"] as? String, posts[1].jsonBody?["clientId"] as? String)
        XCTAssertEqual(api.allDevices.first?.messages.count, 1, "the server kept one copy")
        XCTAssertEqual(client.conversation.messages.count, 1, "and so does the chat")
    }

    func testAPendingMessageTheServerAlreadyHasIsDroppedOnSync() async throws {
        let api = FakeAPI()
        let directory = temporaryDirectory()
        let credentials = InMemoryCredentialStore()
        let client = try makeClient(api: api, credentials: credentials, directory: directory)
        client.start()
        try await client.flush()
        // pretend the app was killed after the server stored the message but before the answer: the outbox has it,
        // and so does the server
        api.fail("POST /v1/messages", with: .connectionError(.notConnectedToInternet), times: 1000)
        let clientId = try XCTUnwrap(client.conversation.send(text: "hello"))
        client.stop()

        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        api.clearFaults()
        // deliver it directly with the same clientId, as the lost request would have
        let token = try await DeviceSession(
            appId: testAppId,
            api: APIClient(baseURL: URL(string: "https://api.test")!, transport: StubHTTP { try await api.handle($0) }, sleeper: TestSleeper(), userAgent: "t", log: .silent),
            credentialStore: credentials,
            files: FileStore(directory: directory),
            log: .silent,
            now: { Date() }
        ).accessToken()
        _ = try await api.handle(HTTPRequest(
            method: "POST", url: URL(string: "https://api.test/v1/messages")!, headers: ["Authorization": "Bearer \(token)"],
            body: Data(#"{"clientId":"\#(clientId)","text":"hello","attachmentIds":[]}"#.utf8), timeout: 5
        ))
        XCTAssertEqual(api.allDevices.first { $0.id == deviceId }?.messages.count, 1)

        // relaunch: the outbox still has it; the first sync shows the server has it, so it isn't sent again
        let http = StubHTTP { try await api.handle($0) }
        let relaunched = try makeClient(api: api, http: http, credentials: credentials, directory: directory)
        XCTAssertEqual(relaunched.conversation.messages.first?.status, .sending)
        relaunched.conversation.open()
        await eventually("the outbox to empty") { !relaunched.conversation.hasPendingMessages }
        XCTAssertEqual(relaunched.conversation.messages.count, 1)
        XCTAssertEqual(api.allDevices.first { $0.id == deviceId }?.messages.count, 1)
        relaunched.stop()
    }

    func testTheOutboxSurvivesARelaunch() async throws {
        let api = FakeAPI()
        let directory = temporaryDirectory()
        let credentials = InMemoryCredentialStore()
        let first = try makeClient(api: api, credentials: credentials, directory: directory)
        first.start()
        try await first.flush()
        api.fail("POST /v1/messages", with: .connectionError(.notConnectedToInternet), times: 1000)
        first.conversation.send(text: "written offline")
        first.stop()

        api.clearFaults()
        let second = try makeClient(api: api, credentials: credentials, directory: directory)
        XCTAssertEqual(second.conversation.messages.map(\.text), ["written offline"])
        second.start()
        await eventually("replay") { api.allDevices.first?.messages.count == 1 }
        XCTAssertEqual(api.allDevices.count, 1, "same device after relaunch")
        second.stop()
    }

    func testAFailureOnlyTheUserCanFixIsMarkedAndTheRestContinue() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()
        try await client.flush()
        api.fail("POST /v1/messages", with: .status(.error(403, "verification_required", "Sign in to send messages")))

        client.conversation.send(text: "first")
        await eventually("failure") { client.conversation.messages.first?.status == .failed(.verificationRequired) }
        XCTAssertEqual(client.conversation.sending.restriction, .verificationRequired)

        client.conversation.send(text: "second")
        await eventually("the second goes out") { client.conversation.messages.contains { $0.text == "second" && $0.status == .sent } }

        // Retry sends it; discard removes it
        let failed = try XCTUnwrap(client.conversation.messages.first { $0.text == "first" })
        client.conversation.retry(failed)
        await eventually("retried") { client.conversation.messages.first { $0.text == "first" }?.status == .sent }
        XCTAssertEqual(sentTexts(http), ["first", "second", "first"])
    }

    func testDiscardRemovesAFailedMessage() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        api.fail("POST /v1/messages", with: .status(.error(400, "validation_failed", "text: too long")))
        client.conversation.send(text: "nope")
        await eventually("failure") { client.conversation.messages.first?.status == .failed(.validationFailed) }
        client.conversation.discard(try XCTUnwrap(client.conversation.messages.first))
        XCTAssertTrue(client.conversation.messages.isEmpty)
        XCTAssertFalse(client.conversation.hasPendingMessages)
    }

    func testRejectsEmptyAndOverlongMessages() throws {
        let client = try makeClient(api: FakeAPI())
        XCTAssertNil(client.conversation.send(text: "   \n "))
        XCTAssertNil(client.conversation.send(text: String(repeating: "😀", count: 2001)), "4,000 UTF-16 units, as the API counts")
        XCTAssertNotNil(client.conversation.send(text: String(repeating: "😀", count: 2000)))
    }

    func testUploadsPhotosThenSendsTheMessage() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()

        var jpeg = Data([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03])
        jpeg.append(contentsOf: [UInt8](repeating: 7, count: 64))
        let photo = try HireShelbyPhoto(data: jpeg)
        XCTAssertEqual(photo.width, 48)
        XCTAssertEqual(photo.height, 32)

        client.conversation.send(text: "", photos: [photo])
        if case .local(let url) = client.conversation.messages.first?.attachments.first?.source {
            XCTAssertEqual(try Data(contentsOf: url), jpeg, "the pending message shows the local file")
        } else {
            XCTFail("expected a local attachment while sending")
        }
        await eventually("delivery") { client.conversation.messages.first?.status == .sent }

        let ticket = try XCTUnwrap(http.requests.first { $0.summary == "POST /v1/uploads" }?.jsonBody)
        XCTAssertEqual(ticket["contentType"] as? String, "image/jpeg")
        XCTAssertEqual(ticket["bytes"] as? Int, jpeg.count)
        XCTAssertEqual(ticket["width"] as? Int, 48)
        XCTAssertEqual(ticket["height"] as? Int, 32)
        XCTAssertEqual(ticket["checksum"] as? String, SHA256Digest.base64(of: jpeg))

        let put = try XCTUnwrap(http.requests.first { $0.method == "PUT" })
        XCTAssertEqual(put.url.host, "storage.test")
        XCTAssertEqual(put.body, jpeg)
        XCTAssertEqual(put.header("x-amz-checksum-sha256"), SHA256Digest.base64(of: jpeg))
        XCTAssertNil(put.header("Authorization"), "storage gets the signed URL, never the API token")

        let send = try XCTUnwrap(http.requests.first { $0.summary == "POST /v1/messages" }?.jsonBody)
        let attachmentId = String(put.path.dropFirst("/put/".count))
        XCTAssertEqual(send["attachmentIds"] as? [String], [attachmentId])
        if case .remote = client.conversation.messages.first?.attachments.first?.source {} else {
            XCTFail("expected the server's photo link once sent")
        }
    }

    func testUploadsAgainWhenTheServerMissesTheFile() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()
        var png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13])
        png.append(contentsOf: Array("IHDR".utf8))
        png.append(contentsOf: [0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0])
        api.fail("POST /v1/messages", with: .status(.error(409, "upload_incomplete", "Upload the photo before sending it")))
        client.conversation.send(text: "look", photos: [try HireShelbyPhoto(data: png)])
        await eventually("delivery") { client.conversation.messages.first?.status == .sent }
        XCTAssertEqual(http.requests.filter { $0.summary == "POST /v1/uploads" }.count, 2)
        XCTAssertEqual(http.requests.filter { $0.method == "PUT" }.count, 2)
    }

    func testPagesBackThroughHistory() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        try await client.flush()
        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        for n in 1...120 { api.reply(to: deviceId, text: "m\(n)") }

        let conversation = client.conversation
        conversation.open()
        await eventually("first page") { conversation.messages.count == 50 }
        XCTAssertEqual(conversation.messages.first?.text, "m71")
        XCTAssertEqual(conversation.messages.last?.text, "m120")
        XCTAssertTrue(conversation.hasOlderMessages)

        await conversation.loadOlder()
        XCTAssertEqual(conversation.messages.count, 100)
        XCTAssertEqual(conversation.messages.first?.text, "m21")
        await conversation.loadOlder()
        XCTAssertEqual(conversation.messages.count, 120)
        XCTAssertFalse(conversation.hasOlderMessages)
        XCTAssertEqual(conversation.messages.map(\.seq), Array(1...120).map(Optional.some))
        conversation.close()
    }

    func testOpeningMarksReadAndClearsTheUnreadCount() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()
        try await client.flush()
        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        api.reply(to: deviceId, text: "Hi!")
        api.reply(to: deviceId, text: "Anything else?")
        await client.refreshUnreadCount()
        XCTAssertEqual(client.unreadCount, 2)

        client.conversation.open()
        await eventually("read") { client.unreadCount == 0 }
        XCTAssertEqual(http.requests.last { $0.summary == "POST /v1/read" }?.jsonBody?["seq"] as? Int, 2)
        client.conversation.close()
    }

    func testCardTapsAreRecordedOnceAndOfflineTapsAreSentLater() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        client.reportPaywalls([HireShelbyPaywall(id: "pro_yearly", title: "Pro yearly")])
        try await client.flush()
        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        let offer = api.reply(to: deviceId, text: "50% off", card: .paywall(paywallId: "pro_yearly", buttonLabel: nil))
        api.reply(to: deviceId, text: "Old offer", card: .paywall(paywallId: "gone", buttonLabel: nil))
        api.reply(to: deviceId, text: "Rate us?", card: .review(url: nil, buttonLabel: nil))

        var events: [HireShelbyEvent] = []
        client.onEvent = { events.append($0) }
        client.conversation.open()
        await eventually("messages") { client.conversation.messages.count == 3 }
        let messages = client.conversation.messages
        XCTAssertEqual(client.conversation.cardAction(for: messages[0]), .presentPaywall(id: "pro_yearly"))
        XCTAssertEqual(client.conversation.cardAction(for: messages[1]), .unavailable)
        XCTAssertNil(client.conversation.cardAction(for: messages[2]), "a review card without a URL has no button")

        api.fail("POST /v1/actions/:id/click", with: .connectionError(.notConnectedToInternet), times: 4)
        XCTAssertEqual(client.conversation.tapCard(messages[0]), .presentPaywall(id: "pro_yearly"))
        XCTAssertNotNil(client.conversation.messages[0].actionClickedAt, "shown as tapped right away")
        XCTAssertEqual(client.conversation.tapCard(messages[1]), .unavailable)
        XCTAssertTrue(events.contains(.paywallOpened(paywallId: "pro_yearly")))

        client.conversation.setAppActive(false)
        client.conversation.setAppActive(true)
        await eventually("the receipt") { api.clicks == [offer.id] }
        client.conversation.close()
    }

    func testAsksBeforeAIRepliesAndRecordsTheAnswer() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        try await client.flush()
        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        var events: [HireShelbyEvent] = []
        client.onEvent = { events.append($0) }

        // AI off: nothing to ask
        client.conversation.open()
        await eventually("loaded") { client.conversation.hasLoaded }
        XCTAssertEqual(client.conversation.aiReplies, .off)
        client.conversation.close()

        api.aiEnabled = true
        client.conversation.open()
        await eventually("AI on") { client.conversation.aiReplies.isEnabled }
        XCTAssertTrue(client.conversation.aiReplies.needsConsent)
        XCTAssertEqual(client.conversation.aiReplies.processors, ["OpenRouter", "Anthropic"])

        // offline: the answer is put back and the error says why
        api.fail("POST /v1/ai-consent", with: .connectionError(.notConnectedToInternet), times: 4)
        do {
            try await client.conversation.setAIReplies(allowed: true)
            XCTFail("expected an error")
        } catch let error as HireShelbyError {
            XCTAssertEqual(error.code, .connectionFailed)
        }
        XCTAssertTrue(client.conversation.aiReplies.needsConsent)
        XCTAssertNil(api.aiConsent(of: deviceId))

        try await client.conversation.setAIReplies(allowed: true)
        XCTAssertTrue(client.conversation.aiReplies.isAllowed)
        XCTAssertEqual(api.aiConsent(of: deviceId), "granted")
        try await client.conversation.setAIReplies(allowed: false)
        XCTAssertEqual(client.conversation.aiReplies.consent, .declined)
        XCTAssertFalse(client.conversation.aiReplies.needsConsent)
        XCTAssertEqual(api.aiConsent(of: deviceId), "declined")
        XCTAssertEqual(events.filter { if case .aiRepliesChanged = $0 { true } else { false } }, [
            .aiRepliesChanged(allowed: true), .aiRepliesChanged(allowed: false),
        ])
        client.conversation.close()
    }

    func testLogoutForgetsTheConversationAndUnsentMessages() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        client.identify(userId: "alice")
        try await client.flush()
        let alice = try XCTUnwrap(api.allDevices.first?.id)
        api.reply(to: alice, text: "Hi Alice")
        client.conversation.open()
        await eventually("history") { client.conversation.messages.count == 1 }
        client.conversation.close()

        api.fail("POST /v1/messages", with: .connectionError(.notConnectedToInternet), times: 1000)
        client.conversation.send(text: "unsent")
        client.logout()
        XCTAssertTrue(client.conversation.messages.isEmpty)
        XCTAssertFalse(client.conversation.hasPendingMessages)
        XCTAssertEqual(client.identity, .anonymous)
        api.clearFaults()

        client.identify(userId: "bob")
        try await client.flush()
        await eventually("logout delivered") { api.logouts == [alice] }
        let bob = try XCTUnwrap(api.allDevices.first { !$0.ended })
        XCTAssertEqual(bob.identity.userId, "bob")
        XCTAssertTrue(bob.messages.isEmpty, "alice's unsent message never reaches bob's conversation")
        client.conversation.open()
        await eventually("bob's empty chat") { client.conversation.hasLoaded }
        XCTAssertTrue(client.conversation.messages.isEmpty)
        client.stop()
    }
}
