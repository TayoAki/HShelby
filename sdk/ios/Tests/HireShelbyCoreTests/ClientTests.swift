import Foundation
import XCTest
@testable import HireShelbyCore
@testable import HireShelby

/// The client's public API: what it reports, when it registers, identity changes, unread, tracking.
@MainActor
final class ClientTests: XCTestCase {
    func testRejectsAMalformedAppId() {
        XCTAssertThrowsError(try HireShelbyClient(configuration: .init(appId: "app_short"))) { error in
            XCTAssertEqual((error as? HireShelbyError)?.code, .notConfigured)
        }
    }

    func testRegistersAtLaunchWithEverythingStagedInOneRequest() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.identify(userId: "u_1", name: "  Alex  ", email: nil)
        client.setMetadata(["plan": "pro", "signed_up": "2026-01-02"])
        client.setPushToken(Data(repeating: 0xAB, count: 32), environment: .sandbox)
        client.reportPaywalls([HireShelbyPaywall(id: "pro_yearly", title: "Pro yearly", source: .revenueCat)])
        client.reportStoreKit(paying: true, originalTransactionIds: ["2000000123456789", "not-a-number"])
        client.start()
        try await client.flush()

        let registrations = http.requests.filter { $0.summary == "POST /v1/devices" }
        XCTAssertEqual(registrations.count, 1)
        XCTAssertFalse(http.requests.contains { $0.summary == "PATCH /v1/device" }, "staged before registering: one request")
        let body = try XCTUnwrap(registrations.first?.jsonBody)
        XCTAssertEqual(body["appId"] as? String, testAppId)
        XCTAssertEqual(body["identity"] as? [String: String], ["userId": "u_1", "name": "Alex"])
        XCTAssertEqual(body["metadata"] as? [String: String], ["plan": "pro", "signed_up": "2026-01-02"])
        let push = try XCTUnwrap(body["push"] as? [String: Any])
        XCTAssertEqual(push["token"] as? String, String(repeating: "ab", count: 32))
        XCTAssertEqual(push["environment"] as? String, "sandbox")
        XCTAssertEqual(push["updatesAppBadge"] as? Bool, true)
        XCTAssertEqual((body["paywalls"] as? [[String: Any]])?.first?["id"] as? String, "pro_yearly")
        let storekit = try XCTUnwrap(body["storekit"] as? [String: Any])
        XCTAssertEqual(storekit["paying"] as? Bool, true)
        XCTAssertEqual(storekit["originalTransactionIds"] as? [String], ["2000000123456789"])
        XCTAssertEqual((body["device"] as? [String: String])?["sdkVersion"], HireShelbyVersion.current)
        XCTAssertEqual(client.identity.userId, "u_1")
        client.stop()
    }

    func testLaterChangesArePatched() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()
        try await client.flush()
        client.setMetadata(["plan": "free"])
        client.clearPushToken()
        try await client.flush()
        let patch = try XCTUnwrap(http.requests.last { $0.summary == "PATCH /v1/device" }?.jsonBody)
        XCTAssertEqual(patch.keys.sorted(), ["metadata"], "no push token was ever sent, so there's nothing to clear")

        client.setPushToken(Data(repeating: 1, count: 32))
        try await client.flush()
        client.clearPushToken()
        try await client.flush()
        let cleared = try XCTUnwrap(http.requests.last { $0.summary == "PATCH /v1/device" }?.body)
        XCTAssertEqual(String(decoding: cleared, as: UTF8.self), #"{"push":null}"#)
        client.stop()
    }

    func testValidatesMetadataAndPaywallsBeforeSending() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()
        try await client.flush()

        var tooMany: [String: String] = [:]
        for n in 0..<21 { tooMany["k\(n)"] = "v" }
        client.setMetadata(tooMany)
        client.setMetadata(["ok": "yes", String(repeating: "k", count: 65): "key too long", "long": String(repeating: "v", count: 513)])
        client.reportPaywalls([
            HireShelbyPaywall(id: "good", title: "Good"),
            HireShelbyPaywall(id: "good", title: "Repeated"),
            HireShelbyPaywall(id: "bad id!", title: "Bad"),
            HireShelbyPaywall(id: "untitled", title: "   "),
            HireShelbyPaywall(id: "many", title: "Many", products: (0..<15).map { .init(id: "p\($0)") }),
        ])
        try await client.flush()
        let patch = try XCTUnwrap(http.requests.last { $0.summary == "PATCH /v1/device" }?.jsonBody)
        XCTAssertEqual(patch["metadata"] as? [String: String], ["ok": "yes"])
        let paywalls = try XCTUnwrap(patch["paywalls"] as? [[String: Any]])
        XCTAssertEqual(paywalls.map { $0["id"] as? String }, ["good", "many"])
        XCTAssertEqual((paywalls[1]["products"] as? [Any])?.count, 10)
        XCTAssertEqual(client.paywalls.map(\.id), ["good", "many"])
        client.stop()
    }

    func testIdentifyingAnotherUserStartsANewConversation() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        client.identify(userId: "alice", name: "Alice")
        try await client.flush()
        let alice = try XCTUnwrap(api.allDevices.first?.id)

        // no logout in between: the SDK ends Alice's session itself rather than mixing histories
        client.identify(userId: "bob", name: "Bob")
        try await client.flush()
        await eventually("logout") { api.logouts == [alice] }
        let bob = try XCTUnwrap(api.allDevices.first { !$0.ended })
        XCTAssertEqual(bob.identity.userId, "bob")
        XCTAssertEqual(bob.identity.name, "Bob")
        XCTAssertEqual(client.identity.userId, "bob")

        // the same user again, with more detail, is just an update
        client.identify(userId: "bob", email: "bob@example.com")
        try await client.flush()
        XCTAssertEqual(api.allDevices.first { !$0.ended }?.id, bob.id)
        XCTAssertEqual(api.allDevices.first { !$0.ended }?.identity.email, "bob@example.com")
        client.stop()
    }

    func testIdentityTokens() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        var events: [HireShelbyEvent] = []
        client.onEvent = { events.append($0) }
        client.start()
        client.identify(token: "ids_thesecretitself")
        client.identify(token: "not-a-jwt")
        try await client.flush()
        XCTAssertNil(http.requests.first?.jsonBody?["identityToken"], "never sends what isn't a token")

        func jwt(_ userId: String, signature: String = "sig") -> String {
            let payload = Data(#"{"user_id":"\#(userId)","exp":9999999999}"#.utf8).base64EncodedString()
                .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            return "eyJhbGciOiJIUzI1NiJ9.\(payload).\(signature)"
        }
        client.identify(token: jwt("u_1"))
        try await client.flush()
        XCTAssertEqual(http.requests.last { $0.summary == "PATCH /v1/device" }?.jsonBody?["identityToken"] as? String, jwt("u_1"))
        XCTAssertTrue(api.allDevices.first?.identity.verified ?? false)

        client.identify(token: jwt("u_1", signature: "bad"))
        try await client.flush()
        await eventually("the rejection event") { events.contains { if case .identityRejected = $0 { true } else { false } } }
        client.stop()
    }

    func testDeleteDataRemovesEverything() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        var events: [HireShelbyEvent] = []
        client.onEvent = { events.append($0) }
        client.start()
        client.identify(userId: "u_1")
        client.setMetadata(["plan": "pro"])
        try await client.flush()
        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        api.reply(to: deviceId, text: "hi")
        await client.refreshUnreadCount()
        XCTAssertEqual(client.unreadCount, 1)

        try await client.deleteData()
        XCTAssertTrue(api.allDevices.isEmpty)
        XCTAssertEqual(client.unreadCount, 0)
        XCTAssertEqual(client.identity, .anonymous)
        XCTAssertTrue(events.contains(.dataDeleted))

        // a later registration doesn't bring the deleted details back
        try await client.flush()
        let next = try XCTUnwrap(api.allDevices.first)
        XCTAssertNil(next.identity.userId)
        XCTAssertNil(next.metadata)
        client.stop()
    }

    func testDeleteDataOfflineThrows() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        try await client.flush()
        api.fail("DELETE /v1/device", with: .connectionError(.notConnectedToInternet), times: 10)
        do {
            try await client.deleteData()
            XCTFail("expected an error")
        } catch let error as HireShelbyError {
            XCTAssertEqual(error.code, .connectionFailed)
        }
        XCTAssertEqual(api.allDevices.count, 1)
        client.stop()
    }

    func testUnreadCountIsObservable() async throws {
        let api = FakeAPI()
        let client = try makeClient(api: api)
        client.start()
        try await client.flush()
        var observed: [Int] = []
        let observation = client.observeUnreadCount { observed.append($0) }
        var iterator = client.unreadCountUpdates.makeAsyncIterator()
        let initial = await iterator.next()
        XCTAssertEqual(initial, 0)

        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        api.reply(to: deviceId, text: "a")
        api.reply(to: deviceId, text: "b")
        await client.refreshUnreadCount()
        let next = await iterator.next()
        XCTAssertEqual(next, 2)
        XCTAssertEqual(observed, [0, 2])

        observation.cancel()
        await eventually("observer removed") { true }
        XCTAssertTrue(client.handleNotification(userInfo: ["aps": ["alert": "x"], "hireshelby": ["conversationId": "c1", "messageId": "m1"]]))
        XCTAssertFalse(client.handleNotification(userInfo: ["aps": ["alert": "x"]]))
        client.stop()
    }

    func testTracksOnlyEventsAnAutomationListensFor() async throws {
        let api = FakeAPI()
        api.trackedEventNames = ["paywall_declined"]
        let http = StubHTTP { try await api.handle($0) }
        let client = try makeClient(api: api, http: http)
        client.start()

        let skipped = await client.track("onboarding_completed")
        XCTAssertEqual(skipped, .skipped)
        let invalid = await client.track("Not Valid")
        XCTAssertEqual(invalid, .skipped)
        let delivered = await client.track("paywall_declined")
        XCTAssertTrue(delivered.delivered)
        _ = await client.track("paywall_declined")

        XCTAssertEqual(api.tracked, ["paywall_declined", "paywall_declined"])
        XCTAssertEqual(http.requests.filter { $0.summary == "GET /v1/track/events" }.count, 1, "the list is cached for its TTL")
        client.stop()
    }

    func testAReinstallStartsANewDevice() async throws {
        let api = FakeAPI()
        let credentials = InMemoryCredentialStore()
        let first = try makeClient(api: api, credentials: credentials)
        first.start()
        try await first.flush()
        first.stop()
        XCTAssertNotNil(try credentials.load())

        // the app was deleted (its files are gone) but the Keychain item survived
        let reinstalled = try makeClient(api: api, credentials: credentials, directory: temporaryDirectory())
        reinstalled.start()
        try await reinstalled.flush()
        XCTAssertEqual(api.allDevices.count, 2)
        reinstalled.stop()
    }

    func testTheFacadeQueuesCallsUntilConfigured() {
        XCTAssertEqual(HireShelby.version, HireShelbyVersion.current)
        XCTAssertFalse(HireShelby.isConfigured)
        XCTAssertEqual(HireShelby.shared.unreadCount, 0)
        XCTAssertFalse(HireShelby.shared.handleNotification(userInfo: ["aps": [:]]))
    }
}
