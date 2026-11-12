import Foundation
import XCTest
@testable import HireShelbyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Runs the SDK against a real API, only when both are set:
///
///     HIRESHELBY_TEST_API_URL=https://api-staging-….up.railway.app \
///     HIRESHELBY_TEST_APP_ID=app_… swift test --filter IntegrationTests
///
/// register → identify → send → fetch the conversation → read → unread → logout. Each run makes a new device
/// (and a conversation) in that app's inbox.
@MainActor
final class IntegrationTests: XCTestCase {
    private var apiURL: URL!
    private var appId: String!

    override func setUp() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let url = environment["HIRESHELBY_TEST_API_URL"].flatMap(URL.init(string:)), let appId = environment["HIRESHELBY_TEST_APP_ID"] else {
            throw XCTSkip("Set HIRESHELBY_TEST_API_URL and HIRESHELBY_TEST_APP_ID to run against a real API")
        }
        self.apiURL = url
        self.appId = appId
    }

    private func makeLiveClient(credentials: InMemoryCredentialStore) throws -> HireShelbyClient {
        let session = URLSessionHTTPTransport.makeSession()
        let lines = Locked<[String]>([])
        return try HireShelbyClient(
            configuration: .init(
                appId: appId,
                apiBaseURL: apiURL,
                logLevel: .debug,
                logHandler: { _, line in lines.withLock { $0.append(line) }; print("[HireShelby] \(line)") },
                storageDirectory: temporaryDirectory()
            ),
            dependencies: .init(
                http: URLSessionHTTPTransport(session: session),
                webSocket: URLSessionWebSocketTransport(session: session),
                credentials: credentials,
                deviceDetails: WireDeviceDetails(
                    model: "IntegrationTest", osVersion: DeviceInfo.osVersion(), appVersion: "test",
                    sdkVersion: HireShelbyVersion.current, locale: "en-US", timezone: TimeZone.current.identifier
                ),
                monitorsNetwork: false
            )
        )
    }

    func testRegisterIdentifySendFetchReadUnreadLogout() async throws {
        let credentials = InMemoryCredentialStore()
        let client = try makeLiveClient(credentials: credentials)
        client.start()

        // register (with the staged identity in the same request)
        let runId = UUID().uuidString.prefix(8).lowercased()
        client.identify(userId: "sdk-integration-\(runId)", name: "SDK Integration \(runId)", email: "sdk-\(runId)@example.com")
        client.setMetadata(["source": "ios-sdk-integration-test", "run": String(runId)])
        try await client.flush()
        let session = try XCTUnwrap(try credentials.load()?.session)
        XCTAssertTrue(session.deviceSecret.hasPrefix("dvs_"))
        XCTAssertEqual(client.identity.userId, "sdk-integration-\(runId)")
        XCTAssertFalse(client.identity.isVerified)

        // identify again: an update, same device
        client.identify(email: "sdk-\(runId)+2@example.com")
        try await client.flush()
        XCTAssertEqual(client.identity.email, "sdk-\(runId)+2@example.com")
        XCTAssertEqual(try credentials.load()?.session?.deviceSecret, session.deviceSecret)

        // send
        let conversation = client.conversation
        conversation.open()
        await eventually(timeout: 15, "the first load") { conversation.hasLoaded }
        if !conversation.sending.isAllowed {
            throw XCTSkip("This app only lets verified users send (\(String(describing: conversation.sending.restriction)))")
        }
        let clientId = try XCTUnwrap(conversation.send(text: "Hello from the iOS SDK integration test (\(runId))"))
        await eventually(timeout: 20, "delivery") { conversation.messages.contains { $0.clientId == clientId && $0.status == .sent } }

        // a photo: upload ticket, PUT to storage with the signed checksum, then the message (where the API has a bucket)
        let png = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
        let photoClientId = try XCTUnwrap(conversation.send(text: "A photo (\(runId))", photos: [try HireShelbyPhoto(data: png)]))
        await eventually(timeout: 20, "the photo message to settle") {
            conversation.messages.first { $0.clientId == photoClientId }.map { $0.status != .sending } ?? false
        }
        let photoMessage = try XCTUnwrap(conversation.messages.first { $0.clientId == photoClientId })
        if photoMessage.status == .failed(.uploadsNotConfigured) {
            print("[HireShelby] photos not checked: this API has no bucket")
            conversation.discard(photoMessage)
        } else {
            XCTAssertEqual(photoMessage.status, .sent)
            XCTAssertEqual(photoMessage.attachments.count, 1)
            if case .remote(let url)? = photoMessage.attachments.first?.source {
                let download = try await URLSessionHTTPTransport(session: URLSessionHTTPTransport.makeSession())
                    .send(HTTPRequest(method: "GET", url: url, headers: [:], body: nil, timeout: 20))
                XCTAssertEqual(download.status, 200)
                XCTAssertEqual(download.body, png, "the signed link serves the exact bytes")
            } else {
                XCTFail("expected the photo's signed link")
            }
        }

        // fetch: the server has it, keyed by the clientId
        let sync = try await client.services.session.send(.get("/v1/conversation", query: [URLQueryItem(name: "limit", value: "5")]), as: WireSync.self)
        XCTAssertNotNil(sync.conversation)
        XCTAssertTrue(sync.messages.contains { $0.clientId == clientId && $0.sender == "user" })
        let newest = try XCTUnwrap(sync.messages.last?.seq)

        // the same clientId again is the same message
        let again = try await client.services.session.send(
            .post("/v1/messages", WireSendMessage(clientId: clientId, text: "Hello from the iOS SDK integration test (\(runId))", attachmentIds: [])),
            as: WireSendResult.self
        )
        XCTAssertEqual(again.message.clientId, clientId)
        XCTAssertEqual(again.message.seq, sync.messages.first { $0.clientId == clientId }?.seq)

        // read, then unread
        let read = try await client.services.session.send(.post("/v1/read", WireReadInput(seq: newest)), as: WireUnread.self)
        XCTAssertEqual(read.unread, 0)
        await client.refreshUnreadCount()
        XCTAssertEqual(client.unreadCount, 0)

        // live: the socket authenticates and says ready
        #if canImport(FoundationNetworking)
        // Linux's FoundationNetworking has no WebSocket support ("WebSockets not supported by libcurl"); the chat
        // falls back to polling there, which the steps above went through.
        print("[HireShelby] live updates not checked: no URLSessionWebSocketTask on this platform")
        #else
        await eventually(timeout: 15, "live updates") { conversation.connection == .live }
        #endif
        conversation.close()

        // logout: the device ends; its credential stops working
        let secret = session.deviceSecret
        client.logout()
        try await client.flush() // waits for the logout queued before it (and registers the next, anonymous device)
        XCTAssertEqual(try credentials.load()?.pendingLogouts, [], "the logout reached the server")
        XCTAssertNotEqual(try credentials.load()?.session?.deviceSecret, secret)
        let refresh = try? await client.services.api.send(.post("/v1/session/refresh", WireDeviceSecretInput(deviceSecret: secret)), accessToken: nil)
        XCTAssertNil(refresh, "a logged-out device can't refresh")
        XCTAssertEqual(client.identity, .anonymous)
        XCTAssertEqual(client.unreadCount, 0)
        client.stop()
    }

    func testPublishedAppearanceIsPublic() async throws {
        let response = try await APIClient(
            baseURL: apiURL, transport: URLSessionHTTPTransport(session: URLSessionHTTPTransport.makeSession()),
            sleeper: TaskSleeper(), userAgent: "test", log: .silent
        ).send(.get("/v1/apps/\(appId!)/appearance"), accessToken: nil)
        let appearance = try APIClient.decode(WirePublicAppearance.self, from: response)
        XCTAssertGreaterThanOrEqual(appearance.version, 0)
        XCTAssertNotNil(response.header("ETag"))
    }
}
