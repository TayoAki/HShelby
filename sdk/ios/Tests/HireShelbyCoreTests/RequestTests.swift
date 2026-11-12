import Foundation
import XCTest
@testable import HireShelbyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Request building and the HTTP client's retry rules.
final class RequestTests: XCTestCase {
    private func client(_ http: StubHTTP, sleeper: TestSleeper = TestSleeper(), base: String = "https://api.test") -> APIClient {
        var client = APIClient(baseURL: URL(string: base)!, transport: http, sleeper: sleeper, userAgent: "HireShelby-iOS/test", log: .silent)
        client.backoff = Backoff(base: 0.5, maximum: 8, jitter: { 1 })
        return client
    }

    private func json(_ body: some Encodable) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(body)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: Building

    func testBuildsURLsAndHeaders() throws {
        let api = client(StubHTTP(), base: "https://api.test/")
        let get = try api.httpRequest(
            for: .get("/v1/conversation", query: [URLQueryItem(name: "after", value: "12"), URLQueryItem(name: "limit", value: "100")]),
            accessToken: "tok"
        )
        XCTAssertEqual(get.url.absoluteString, "https://api.test/v1/conversation?after=12&limit=100")
        XCTAssertEqual(get.method, "GET")
        XCTAssertEqual(get.header("Authorization"), "Bearer tok")
        XCTAssertEqual(get.header("Accept"), "application/json")
        XCTAssertNil(get.header("Content-Type"), "no body, no content type")
        XCTAssertNil(get.body)

        let post = try api.httpRequest(for: .post("/v1/read", WireReadInput(seq: 4)), accessToken: nil)
        XCTAssertEqual(post.header("Content-Type"), "application/json")
        XCTAssertNil(post.header("Authorization"))
        XCTAssertEqual(String(decoding: try XCTUnwrap(post.body), as: UTF8.self), #"{"seq":4}"#)

        let prefixed = client(StubHTTP(), base: "https://example.com/hireshelby")
        XCTAssertEqual(try prefixed.url(for: .get("/v1/unread")).absoluteString, "https://example.com/hireshelby/v1/unread")
    }

    func testBuildsTheLiveURL() {
        XCTAssertEqual(LiveConnection.url(forAPIBase: URL(string: "https://api.hireshelby.com")!)?.absoluteString, "wss://api.hireshelby.com/v1/live")
        XCTAssertEqual(LiveConnection.url(forAPIBase: URL(string: "http://localhost:8080/")!)?.absoluteString, "ws://localhost:8080/v1/live")
        XCTAssertEqual(LiveConnection.url(forAPIBase: URL(string: "https://x.test/api")!)?.absoluteString, "wss://x.test/api/v1/live")
    }

    func testRegistrationBodyCarriesEverythingStagedAndNothingElse() throws {
        var state = DeviceStateSnapshot()
        state.device = WireDeviceDetails(model: "iPhone16,1", osVersion: "18.1", appVersion: "1.0 (1)", sdkVersion: "0.1.0", locale: "en-US", timezone: "Europe/Berlin")
        state.identity = WireIdentityLabels(userId: "u_1", name: nil, email: "a@b.co")
        state.metadata = ["plan": "pro"]
        state.paywalls = [HireShelbyPaywall(id: "pro_yearly", title: "Pro yearly", source: .revenueCat, products: [.init(id: "pro.y", price: "$29.99", period: "P1Y")]).wire]
        state.storekit = WireStoreKit(paying: true, originalTransactionIds: ["2000000123456789"])

        let body = try json(state.registrationBody(appId: testAppId, identityToken: "jwt"))
        XCTAssertEqual(body.keys.sorted(), ["appId", "device", "identity", "identityToken", "metadata", "paywalls", "storekit"])
        XCTAssertEqual(body["appId"] as? String, testAppId)
        XCTAssertEqual(body["identity"] as? [String: String], ["userId": "u_1", "email": "a@b.co"], "nil labels are left out, never null")
        XCTAssertEqual((body["device"] as? [String: String])?["timezone"], "Europe/Berlin")
        let paywall = try XCTUnwrap((body["paywalls"] as? [[String: Any]])?.first)
        XCTAssertEqual(paywall["source"] as? String, "revenuecat")
        XCTAssertEqual(paywall["presentable"] as? Bool, true)
        XCTAssertEqual((paywall["products"] as? [[String: String]])?.first, ["id": "pro.y", "price": "$29.99", "period": "P1Y"])
        let storekit = try XCTUnwrap(body["storekit"] as? [String: Any])
        XCTAssertEqual(storekit["paying"] as? Bool, true)
        XCTAssertEqual(storekit["originalTransactionIds"] as? [String], ["2000000123456789"])
        XCTAssertNil(body["push"], "no token: push is left out at registration")
    }

    func testUpdateBodySendsOnlyChangesAndClearsPushWithNull() throws {
        var acknowledged = DeviceStateSnapshot()
        acknowledged.device = WireDeviceDetails(model: "iPhone16,1", osVersion: "18.1")
        acknowledged.metadata = ["plan": "free"]
        acknowledged.push = WirePushRegistration(token: String(repeating: "ab", count: 32), environment: "sandbox", updatesAppBadge: true)

        var desired = acknowledged
        XCTAssertTrue(desired.updateBody(since: acknowledged, identityToken: nil, acknowledgedToken: nil).isEmpty)

        desired.metadata = ["plan": "pro"]
        desired.push = nil
        let body = desired.updateBody(since: acknowledged, identityToken: "jwt", acknowledgedToken: nil)
        let encoded = String(decoding: try APIClient.encoder.encode(body), as: UTF8.self)
        XCTAssertEqual(encoded, #"{"identityToken":"jwt","metadata":{"plan":"pro"},"push":null}"#)

        // the same token isn't sent twice
        XCTAssertNil(desired.updateBody(since: desired, identityToken: "jwt", acknowledgedToken: "jwt").identityToken)
    }

    func testDropsTheFieldsAValidationErrorNames() {
        var state = DeviceStateSnapshot()
        state.metadata = ["a": "b"]
        state.paywalls = []
        state.appearance = .object([:])
        let dropped = state.dropFields(namedIn: "paywalls.0.id: 1–64 letters; appearance.colors.accent: set light, dark or both")
        XCTAssertEqual(dropped, ["paywalls", "appearance"])
        XCTAssertNil(state.paywalls)
        XCTAssertNil(state.appearance)
        XCTAssertEqual(state.metadata, ["a": "b"])
        XCTAssertEqual(state.dropFields(namedIn: "body: something"), [])
    }

    // MARK: Retries

    func testHonoursRetryAfterOn429() async throws {
        let http = StubHTTP()
        let calls = Locked(0)
        http.setHandler { _ in
            let n = calls.withLock { $0 += 1; return $0 }
            return n == 1 ? .error(429, "rate_limited", "slow down", headers: ["Retry-After": "7"]) : .json(200, #"{"unread":1}"#)
        }
        let sleeper = TestSleeper(parkAtOrAbove: 1000)
        let result = try await client(http, sleeper: sleeper).send(.get("/v1/unread"), accessToken: "t", as: WireUnread.self)
        XCTAssertEqual(result.unread, 1)
        XCTAssertEqual(sleeper.waits, [7])
        XCTAssertEqual(http.requests.count, 2)
    }

    func testReturnsALongRetryAfterInsteadOfWaiting() async {
        let http = StubHTTP { _ in .error(429, "rate_limited", "slow down", headers: ["Retry-After": "120"]) }
        let sleeper = TestSleeper()
        do {
            _ = try await client(http, sleeper: sleeper).send(.post("/v1/messages", WireReadInput(seq: 1)), accessToken: "t")
            XCTFail("expected rate_limited")
        } catch let error as HireShelbyError {
            XCTAssertEqual(error.code, .rateLimited)
            XCTAssertEqual(error.retryAfter, 120)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(sleeper.waits, [])
        XCTAssertEqual(http.requests.count, 1)
    }

    func testRetriesServerErrorsWithExponentialBackoff() async throws {
        let http = StubHTTP()
        let calls = Locked(0)
        http.setHandler { _ in
            let n = calls.withLock { $0 += 1; return $0 }
            return n < 4 ? .error(503, "internal_error", "down") : .json(200, #"{"unread":0}"#)
        }
        let sleeper = TestSleeper(parkAtOrAbove: 1000)
        _ = try await client(http, sleeper: sleeper).send(.get("/v1/unread"), accessToken: "t")
        XCTAssertEqual(sleeper.waits, [0.5, 1, 2])
        XCTAssertEqual(http.requests.count, 4)
    }

    func testJitterScalesTheDelay() {
        let backoff = Backoff(base: 1, maximum: 30, jitter: { 0.5 })
        XCTAssertEqual((0..<7).map(backoff.delay(forAttempt:)), [0.5, 1, 2, 4, 8, 15, 15])
        let random = Backoff(base: 1, maximum: 30)
        for attempt in 0..<10 {
            let delay = random.delay(forAttempt: attempt)
            let cap = min(30, pow(2, Double(attempt)))
            XCTAssertGreaterThanOrEqual(delay, cap * 0.5)
            XCTAssertLessThanOrEqual(delay, cap)
        }
    }

    func testDoesNotRetryValidationErrors() async {
        let http = StubHTTP { _ in .error(400, "validation_failed", "text: too long") }
        let sleeper = TestSleeper()
        do {
            _ = try await client(http, sleeper: sleeper).send(.post("/v1/messages", WireReadInput(seq: 1)), accessToken: "t")
            XCTFail("expected an error")
        } catch let error as HireShelbyError {
            XCTAssertEqual(error.code, .validationFailed)
            XCTAssertEqual(error.status, 400)
            XCTAssertEqual(error.message, "text: too long")
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(http.requests.count, 1)
        XCTAssertEqual(sleeper.waits, [])
    }

    func testRetriesNonIdempotentRequestsOnlyWhenTheyNeverLeft() async {
        let sleeper = TestSleeper()
        let timeouts = StubHTTP { _ in throw URLError(.timedOut) }
        do {
            _ = try await client(timeouts, sleeper: sleeper).send(.post("/v1/track", WireTrackInput(event: "x"), retry: .unsentOnly), accessToken: "t")
            XCTFail("expected an error")
        } catch let error as HireShelbyError {
            XCTAssertEqual(error.code, .connectionFailed)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(timeouts.requests.count, 1, "a timeout may have reached the server: not retried")

        let offline = StubHTTP { _ in throw URLError(.notConnectedToInternet) }
        _ = try? await client(offline, sleeper: sleeper).send(.post("/v1/track", WireTrackInput(event: "x"), retry: .unsentOnly), accessToken: "t")
        XCTAssertEqual(offline.requests.count, 4, "never left the device: retried")

        let idempotent = StubHTTP { _ in throw URLError(.networkConnectionLost) }
        _ = try? await client(idempotent, sleeper: sleeper).send(.get("/v1/unread"), accessToken: "t")
        XCTAssertEqual(idempotent.requests.count, 4)
    }

    func testCancellationStopsRetrying() async {
        let http = StubHTTP { _ in .error(503, "internal_error", "down") }
        let api = client(http, sleeper: TestSleeper(parkAtOrAbove: 0.1))
        let task = Task { try await api.send(.get("/v1/unread"), accessToken: "t") }
        try? await Task.sleep(nanoseconds: 50_000_000)
        task.cancel()
        let result = await task.result
        if case .failure(let error) = result {
            XCTAssertEqual((error as? HireShelbyError)?.code, .cancelled)
        } else {
            XCTFail("expected cancellation")
        }
    }
}
