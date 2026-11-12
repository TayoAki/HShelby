import Foundation
import XCTest
@testable import HireShelbyCore

/// Registration, tokens, refresh on 401, re-registration, staged state, logout and deletion.
final class SessionTests: XCTestCase {
    private func session(
        _ api: FakeAPI,
        http: StubHTTP? = nil,
        credentials: InMemoryCredentialStore = InMemoryCredentialStore(),
        directory: URL = temporaryDirectory(),
        log: Log = .silent,
        now: @escaping @Sendable () -> Date = { Date() }
    ) -> DeviceSession {
        let transport = http ?? StubHTTP { try await api.handle($0) }
        var client = APIClient(baseURL: URL(string: "https://api.test")!, transport: transport, sleeper: TestSleeper(), userAgent: "test", log: log)
        client.backoff = Backoff(base: 0.1, maximum: 1, jitter: { 1 })
        return DeviceSession(appId: testAppId, api: client, credentialStore: credentials, files: FileStore(directory: directory), log: log, now: now)
    }

    func testRegistersOnceForConcurrentRequestsAndKeepsTheSecret() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let credentials = InMemoryCredentialStore()
        let session = session(api, http: http, credentials: credentials)

        async let a = session.send(.get("/v1/unread"), as: WireUnread.self)
        async let b = session.send(.get("/v1/unread"), as: WireUnread.self)
        async let c = session.send(.get("/v1/conversation"), as: WireSync.self)
        _ = try await (a, b, c)

        XCTAssertEqual(http.requests.filter { $0.summary == "POST /v1/devices" }.count, 1)
        let stored = try XCTUnwrap(try credentials.load()?.session)
        XCTAssertTrue(stored.deviceSecret.hasPrefix("dvs_"))
        XCTAssertNotNil(stored.accessToken)
        XCTAssertGreaterThan(try XCTUnwrap(stored.accessTokenExpiresAt).timeIntervalSinceNow, 800)
    }

    func testRefreshesOnceOn401AndRetries() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let session = session(api, http: http)
        _ = try await session.accessToken()

        api.expireTokens()
        let unread = try await session.send(.get("/v1/unread"), as: WireUnread.self)
        XCTAssertEqual(unread.unread, 0)
        XCTAssertEqual(http.requests.map(\.summary), [
            "POST /v1/devices", "GET /v1/unread", "POST /v1/session/refresh", "GET /v1/unread",
        ])
        XCTAssertNotEqual(http.requests[1].bearer, http.requests[3].bearer)
        XCTAssertEqual(api.allDevices.count, 1)
    }

    func testRefreshesBeforeTheTokenExpires() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let clock = Locked(Date())
        let session = session(api, http: http, now: { clock.current })
        _ = try await session.accessToken()
        clock.withLock { $0 = $0.addingTimeInterval(890) } // 10 s left: within the margin
        _ = try await session.accessToken()
        XCTAssertEqual(http.requests.map(\.summary), ["POST /v1/devices", "POST /v1/session/refresh"])
    }

    func testRegistersAgainWhenTheDeviceIsGone() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let session = session(api, http: http)
        await session.updateDesired { $0.identity = WireIdentityLabels(userId: "u_1", name: "Alex", email: nil) }
        _ = try await session.accessToken()
        let first = try XCTUnwrap(api.allDevices.first?.id)

        api.deleteDevice(first) // "Delete user data" in the dashboard
        _ = try await session.send(.get("/v1/unread"), as: WireUnread.self)

        XCTAssertEqual(http.requests.map(\.summary), [
            "POST /v1/devices", "GET /v1/unread", "POST /v1/session/refresh", "POST /v1/devices", "GET /v1/unread",
        ])
        let second = try XCTUnwrap(api.allDevices.first)
        XCTAssertNotEqual(second.id, first)
        XCTAssertEqual(second.identity.userId, "u_1", "the new device gets what was staged")
    }

    func testDeleteNeverRegistersAGoneDevice() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let credentials = InMemoryCredentialStore()
        let session = session(api, http: http, credentials: credentials)
        _ = try await session.accessToken()
        api.deleteDevice(try XCTUnwrap(api.allDevices.first?.id))
        api.expireTokens()

        try await session.deleteDevice()
        XCTAssertFalse(http.requests.dropFirst().contains { $0.summary == "POST /v1/devices" })
        XCTAssertNil(try credentials.load())
        let isRegistered = await session.isRegistered
        XCTAssertFalse(isRegistered)
    }

    func testDeleteRemovesTheDevice() async throws {
        let api = FakeAPI()
        let session = session(api)
        await session.updateDesired { $0.metadata = ["plan": "pro"] }
        _ = try await session.accessToken()
        try await session.deleteDevice()
        XCTAssertTrue(api.allDevices.isEmpty)
        let desired = await session.desired
        XCTAssertNil(desired.metadata)
        XCTAssertNil(desired.identity)
    }

    func testSendsOnlyWhatChanged() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let session = session(api, http: http)
        await session.updateDesired { $0.metadata = ["plan": "free"] }
        try await session.sync()
        XCTAssertEqual(http.requests.last?.jsonBody?["metadata"] as? [String: String], ["plan": "free"])

        try await session.sync()
        XCTAssertEqual(http.requests.count, 1, "nothing changed: no request")

        await session.updateDesired { $0.metadata = ["plan": "pro"] }
        try await session.sync()
        XCTAssertEqual(http.requests.last?.summary, "PATCH /v1/device")
        XCTAssertEqual(http.requests.last?.jsonBody?.keys.sorted(), ["metadata"])
    }

    func testARejectedIdentityTokenDoesNotBlockTheRest() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let session = session(api, http: http)
        let notices = Task { () -> [SessionNotice] in
            var seen: [SessionNotice] = []
            for await notice in session.notices {
                seen.append(notice)
                if case .identity = notice { break }
            }
            return seen
        }
        await session.updateDesired { $0.identity = WireIdentityLabels(userId: "u_1", name: nil, email: nil) }
        await session.setIdentityToken("bad.token.here")
        try await session.sync()

        let registrations = http.requests.filter { $0.summary == "POST /v1/devices" }
        XCTAssertEqual(registrations.count, 2)
        XCTAssertNotNil(registrations[0].jsonBody?["identityToken"])
        XCTAssertNil(registrations[1].jsonBody?["identityToken"])
        XCTAssertEqual(registrations[1].jsonBody?["identity"] as? [String: String], ["userId": "u_1"])
        let seen = await notices.value
        XCTAssertTrue(seen.contains { if case .identityRejected(let e) = $0 { e.code == .identityTokenInvalid } else { false } })
    }

    func testAnotherUsersIdentityStartsANewDevice() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let session = session(api, http: http)
        await session.updateDesired { $0.identity = WireIdentityLabels(userId: "alice", name: nil, email: nil) }
        try await session.sync()
        let alice = try XCTUnwrap(api.allDevices.first?.id)

        // labels staged without logout (the client normally logs out first): the server says identity_mismatch
        await session.updateDesired { $0.identity = WireIdentityLabels(userId: "bob", name: nil, email: nil) }
        try await session.sync()

        XCTAssertEqual(api.logouts, [alice])
        let bob = try XCTUnwrap(api.allDevices.first { !$0.ended })
        XCTAssertEqual(bob.identity.userId, "bob")
        XCTAssertNotEqual(bob.id, alice)
    }

    func testLogoutIsRetriedUntilItGetsThrough() async throws {
        let api = FakeAPI()
        let credentials = InMemoryCredentialStore()
        let directory = temporaryDirectory()
        let session = session(api, credentials: credentials, directory: directory)
        await session.updateDesired { $0.identity = WireIdentityLabels(userId: "u_1", name: "Alex", email: nil) }
        _ = try await session.accessToken()

        api.fail("POST /v1/session/logout", with: .connectionError(.notConnectedToInternet), times: 4)
        await session.logout()
        XCTAssertEqual(api.logouts, [])
        XCTAssertEqual(try credentials.load()?.pendingLogouts.count, 1)
        XCTAssertNil(try credentials.load()?.session)
        let desired = await session.desired
        XCTAssertNil(desired.identity, "the user is forgotten at once")

        // next launch: a new session object over the same Keychain item
        let relaunched = self.session(api, credentials: credentials, directory: directory)
        await relaunched.flushPendingLogouts()
        XCTAssertEqual(api.logouts.count, 1)
        XCTAssertNil(try credentials.load())
    }

    func testDropsAFieldTheAPIRefuses() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let session = session(api, http: http)
        _ = try await session.accessToken()
        await session.updateDesired {
            $0.metadata = ["plan": "pro"]
            $0.appearance = .object(["colors": .object(["accent": .object([:])])])
        }
        api.fail("PATCH /v1/device", with: .status(.error(400, "validation_failed", "appearance.colors.accent: set light, dark or both")))
        try await session.sync()
        let patches = http.requests.filter { $0.summary == "PATCH /v1/device" }
        XCTAssertEqual(patches.count, 2)
        XCTAssertEqual(patches[1].jsonBody?.keys.sorted(), ["metadata"])
        XCTAssertEqual(api.allDevices.first?.metadata, ["plan": "pro"])
    }

    func testNeverLogsSecretsOrTokens() async throws {
        let api = FakeAPI()
        let lines = Locked<[String]>([])
        let log = Log(level: .debug) { _, line in lines.withLock { $0.append(line) } }
        let credentials = InMemoryCredentialStore()
        let session = session(api, credentials: credentials, log: log)
        await session.updateDesired {
            $0.identity = WireIdentityLabels(userId: "secret-user", name: "Secret Name", email: "secret@example.com")
            $0.metadata = ["plan": "secret-plan"]
        }
        try await session.sync()
        api.expireTokens()
        _ = try await session.send(.get("/v1/unread"))

        let stored = try XCTUnwrap(try credentials.load()?.session)
        let all = lines.current.joined(separator: "\n")
        XCTAssertFalse(lines.current.isEmpty)
        for secret in [stored.deviceSecret, stored.accessToken ?? "-", "secret-user", "Secret Name", "secret@example.com", "secret-plan"] {
            XCTAssertFalse(all.contains(secret), "logged \(secret)")
        }
    }
}
