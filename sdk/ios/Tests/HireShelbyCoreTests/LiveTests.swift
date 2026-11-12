import Foundation
import XCTest
@testable import HireShelbyCore

/// The /v1/live socket: reconnecting with backoff, refreshing credentials, resyncing, typing and heartbeats.
final class LiveTests: XCTestCase {
    private actor Signals {
        var all: [LiveSignal] = []
        func append(_ signal: LiveSignal) { all.append(signal) }
        func count(_ signal: LiveSignal) -> Int { all.filter { $0 == signal }.count }
    }

    private actor Tokens {
        var issued = 0
        var invalidated: [String] = []
        func next() -> String {
            issued += 1
            return "tok_\(issued)"
        }
        func invalidate(_ token: String) { invalidated.append(token) }
    }

    private func connection(_ transport: StubWebSocketTransport, sleeper: TestSleeper, tokens: Tokens) -> LiveConnection {
        LiveConnection(
            url: URL(string: "wss://api.test/v1/live")!,
            transport: transport,
            tokenProvider: { await tokens.next() },
            invalidateToken: { await tokens.invalidate($0) },
            sleeper: sleeper,
            backoff: Backoff(base: 1, maximum: 30, jitter: { 1 }),
            log: .silent,
            userAgent: "test"
        )
    }

    private func waitFor(_ condition: @escaping () async -> Bool) async {
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if await condition() { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("timed out")
    }

    func testReconnectsWithBackoffAndResyncsAfterEachConnect() async {
        let transport = StubWebSocketTransport([
            .connectFails(.failed),
            .connectFails(.failed),
            .session(messages: [#"{"type":"ready"}"#, #"{"type":"message","seq":3}"#], then: .closed(code: 1006)),
            .connectFails(.failed),
            .session(messages: [#"{"type":"ready"}"#], then: nil),
        ])
        let sleeper = TestSleeper(parkAtOrAbove: 15)
        let signals = Signals()
        let live = connection(transport, sleeper: sleeper, tokens: Tokens())
        await live.start { await signals.append($0) }
        await waitFor { await signals.count(.connected) == 2 }

        // exponential backoff (jitter pinned to 1), reset after a successful `ready`
        let reconnectWaits = sleeper.waits.filter { $0 != LiveConnection.heartbeatSeconds }
        XCTAssertEqual(reconnectWaits, [1, 2, 1, 2])
        let all = await signals.all
        XCTAssertTrue(all.contains(.event(.message(seq: 3))))
        let disconnects = await signals.count(.disconnected)
        XCTAssertEqual(disconnects, 1)
        XCTAssertEqual(transport.connections.count, 5)
        XCTAssertEqual(transport.connections.first?.url.absoluteString, "wss://api.test/v1/live")
        await live.stop()
    }

    func testRefreshesTheTokenWhenTheServerAsks() async {
        let transport = StubWebSocketTransport([
            .connectFails(.unauthorized), // 401 at the handshake
            .session(messages: [#"{"type":"ready"}"#], then: .unauthorized), // 4001 later
            .session(messages: [#"{"type":"ready"}"#], then: nil),
        ])
        let sleeper = TestSleeper(parkAtOrAbove: 15)
        let tokens = Tokens()
        let signals = Signals()
        let live = connection(transport, sleeper: sleeper, tokens: tokens)
        await live.start { await signals.append($0) }
        await waitFor { await signals.count(.connected) == 2 }

        XCTAssertEqual(transport.connections.map { $0.headers["Authorization"] }, ["Bearer tok_1", "Bearer tok_2", "Bearer tok_3"])
        let invalidated = await tokens.invalidated
        XCTAssertEqual(invalidated, ["tok_1", "tok_2"])
        XCTAssertTrue(sleeper.waits.filter { $0 != LiveConnection.heartbeatSeconds }.isEmpty, "reconnects at once with a fresh token")
        await live.stop()
    }

    func testSendsHeartbeatsAndTypingOnlyWhileConnected() async {
        let transport = StubWebSocketTransport([.session(messages: [#"{"type":"ready"}"#], then: nil)])
        let sleeper = TestSleeper(parkAtOrAbove: 100) // heartbeats (15 s) run at once here
        let signals = Signals()
        let live = connection(transport, sleeper: sleeper, tokens: Tokens())
        await live.send(.typing)
        XCTAssertTrue(transport.sent.isEmpty)
        await live.start { await signals.append($0) }
        await waitFor { await signals.count(.connected) == 1 }
        await live.send(.typing)
        await waitFor { transport.sent.contains(#"{"type":"heartbeat"}"#) && transport.sent.contains(#"{"type":"typing"}"#) }
        await live.stop()
        let running = await live.isRunning
        XCTAssertFalse(running)
    }

    func testStopEndsReconnecting() async {
        let transport = StubWebSocketTransport(Array(repeating: .connectFails(.failed), count: 100))
        let sleeper = TestSleeper(parkAtOrAbove: 3)
        let live = connection(transport, sleeper: sleeper, tokens: Tokens())
        await live.start { _ in }
        await waitFor { sleeper.waits.contains(4) } // parked on the third backoff
        await live.stop()
        let attempts = transport.connections.count
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(transport.connections.count, attempts)
    }

    @MainActor
    func testTheChatGoesLiveCatchesUpAndShowsTyping() async throws {
        let api = FakeAPI()
        let http = StubHTTP { try await api.handle($0) }
        let transport = StubWebSocketTransport([
            .session(messages: [#"{"type":"ready"}"#], then: nil),
            .session(messages: [#"{"type":"ready"}"#, #"{"type":"typing","name":"Sam"}"#], then: nil),
        ])
        let client = try makeClient(api: api, http: http, webSocket: transport)
        client.start()
        try await client.flush()
        let deviceId = try XCTUnwrap(api.allDevices.first?.id)
        api.reply(to: deviceId, text: "first")

        client.conversation.open()
        await eventually("history") { client.conversation.messages.map(\.text) == ["first"] }

        await eventually("live") { client.conversation.connection == .live }

        // a reply lands while the socket is down; the reconnect's resync picks it up
        transport.dropAll()
        api.reply(to: deviceId, text: "while you were away")
        await eventually("resync after reconnect") { client.conversation.messages.count == 2 }
        await eventually("typing") { client.conversation.typing?.name == "Sam" }
        XCTAssertEqual(client.conversation.connection, .live)
        let token = transport.connections.last?.headers["Authorization"]
        XCTAssertNotNil(token)
        XCTAssertTrue(http.requests.contains { $0.summary == "GET /v1/conversation" && $0.query["after"] == "1" })

        client.conversation.close()
        XCTAssertEqual(client.conversation.connection, .idle)
        XCTAssertNil(client.conversation.typing)
        client.stop()
    }
}
