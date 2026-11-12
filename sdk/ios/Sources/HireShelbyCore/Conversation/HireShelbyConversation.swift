import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Shared plumbing for the client and its conversation.
struct Services: Sendable {
    let appId: String
    let apiBaseURL: URL
    let api: APIClient
    let session: DeviceSession
    let files: FileStore
    let http: any HTTPTransport
    let webSocket: any WebSocketTransport
    let sleeper: any Sleeper
    let log: Log
    let now: @Sendable () -> Date
    let userAgent: String
    var outboxBackoff: Backoff = .outbox
    var liveBackoff: Backoff = .live
    /// How often the chat polls while its live connection is down.
    var fallbackPollSeconds: Double = 5
}

/// The device's conversation: messages with paging, optimistic sends through a persisted outbox, photo uploads,
/// live updates, typing, read receipts and card taps.
///
/// The chat UI is built on this; a custom UI can use it directly (``HireShelbyClient/conversation``). All state
/// lives on the main actor; observe it with ``observe(_:)``.
@MainActor
public final class HireShelbyConversation {
    /// Messages, oldest first: the server's by `seq`, then the user's pending ones in the order they were sent.
    public private(set) var messages: [Message] = []
    /// Older messages exist on the server; ``loadOlder()`` fetches them.
    public private(set) var hasOlderMessages = false
    public private(set) var isLoadingOlder = false
    /// The first load from the server finished (cached messages may show before).
    public private(set) var hasLoaded = false
    public private(set) var sending = SendingState.allowed
    public private(set) var typing: Typing?
    public private(set) var connection = ConnectionState.idle
    /// The team has read the conversation up to this `seq` (from live updates while the chat is open).
    public private(set) var teamReadSeq = 0
    /// The chat is on screen.
    public private(set) var isOpen = false

    private let services: Services
    private let outbox: Outbox
    private var confirmed: [WireMessage] = []
    private var conversation: WireConversation?
    private var isAppActive = true
    private var lastReadPosted = 0
    private var lastTypingSentAt = Date.distantPast
    private var live: LiveConnection?
    private var fallbackPoll: Task<Void, Never>?
    private var typingExpiry: Task<Void, Never>?
    private var outboxRetry: Task<Void, Never>?
    private var flushing = false
    private var flushAgain = false
    private var outboxAttempt = 0
    private var catchingUp = false
    private var catchUpAgain = false
    private var pendingClicks: [PendingClick]
    private let observers = ObserverList<Void>()
    /// Bumped on logout and deletion, so answers to requests made before are dropped.
    private var generation = 0
    private var flushingClicks = false
    private var flushClicksAgain = false

    struct PendingClick: Codable, Equatable, Sendable {
        let messageId: String
        let clickedAt: String
    }

    struct Cache: Codable {
        var conversation: WireConversation?
        var messages: [WireMessage]
        var hasOlderMessages: Bool
    }

    static let cacheFile = "conversation.json"
    static let clicksFile = "clicks.json"
    static let cacheSize = 50

    // Wired by the client.
    var onUnreadCount: ((Int) -> Void)?
    var onIdentity: ((WireIdentity) -> Void)?
    var onEvent: ((HireShelbyEvent) -> Void)?
    var isPaywallAvailable: ((String) -> Bool)?

    init(services: Services) {
        self.services = services
        outbox = Outbox(files: services.files)
        pendingClicks = services.files.read([PendingClick].self, from: Self.clicksFile) ?? []
        if let cache = services.files.read(Cache.self, from: Self.cacheFile) {
            confirmed = cache.messages.sorted { $0.seq < $1.seq }
            conversation = cache.conversation
            hasOlderMessages = cache.hasOlderMessages
        }
        rebuild(notify: false)
    }

    /// Calls `observer` after every change. Keep the returned observation alive for as long as you need it.
    public func observe(_ observer: @escaping @MainActor () -> Void) -> HireShelbyObservation {
        observers.add { _ in observer() }
    }

    // MARK: Lifecycle

    /// The chat came on screen: load, go live, mark read. The chat UI calls this.
    public func open() {
        guard !isOpen else { return }
        isOpen = true
        connection = .connecting
        notify()
        onEvent?(.chatOpened)
        startLive()
        startFallbackPolling()
        Task {
            await refresh()
            flushOutbox()
            await flushClicks()
        }
    }

    /// The chat left the screen: stop live updates and polling.
    public func close() {
        guard isOpen else { return }
        isOpen = false
        stopLive()
        stopFallbackPolling()
        typing = nil
        connection = .idle
        saveCache()
        notify()
        onEvent?(.chatClosed)
    }

    func setAppActive(_ active: Bool) {
        guard active != isAppActive else { return }
        isAppActive = active
        if active {
            if isOpen {
                startLive()
                startFallbackPolling()
                Task { await catchUp() }
            }
            retryTransientFailures()
            Task { await flushClicks() }
        } else {
            stopLive()
            stopFallbackPolling()
            outboxRetry?.cancel()
            outboxRetry = nil
            typing = nil
            saveCache()
            notify()
        }
    }

    /// The network came back: replay pending messages now.
    func networkBecameAvailable() {
        retryTransientFailures()
        if isOpen { Task { await catchUp() } }
    }

    /// A new device was registered (the server ended the old one): read state and receipts belonged to the old
    /// device. Its messages clear on the next load, which finds no conversation (or a different one).
    func deviceChanged() {
        // requests in flight already use the new device's token, so their answers stay valid
        teamReadSeq = 0
        lastReadPosted = 0
        pendingClicks = []
        services.files.remove(Self.clicksFile)
        if isOpen {
            // the live socket belongs to the old device
            stopLive()
            startLive()
            Task { await refresh() }
        }
    }

    /// Logout or deletion: forget the conversation. `discardOutbox` drops unsent messages too (a different user).
    func reset(discardOutbox: Bool) {
        generation += 1
        confirmed = []
        conversation = nil
        hasOlderMessages = false
        teamReadSeq = 0
        lastReadPosted = 0
        typing = nil
        sending = .allowed
        pendingClicks = []
        services.files.remove(Self.clicksFile)
        services.files.remove(Self.cacheFile)
        if discardOutbox { outbox.removeAll() }
        if isOpen {
            // the live socket belongs to the old device
            stopLive()
            startLive()
        }
        rebuild()
    }

    // MARK: Loading

    /// Fetches the latest messages (and fresh photo links).
    public func refresh() async {
        let started = generation
        do {
            let sync = try await fetch([URLQueryItem(name: "limit", value: "\(Self.cacheSize)")])
            guard started == generation else { return }
            applyLatest(sync)
            hasLoaded = true
            if connection == .offline { connection = isLive ? .live : .connecting }
            rebuild()
            await markReadIfNeeded()
        } catch {
            handleFetchError(error)
        }
    }

    /// Fetches the page before the oldest loaded message.
    public func loadOlder() async {
        guard hasOlderMessages, !isLoadingOlder, let oldest = confirmed.first?.seq else { return }
        isLoadingOlder = true
        notify()
        defer {
            isLoadingOlder = false
            notify()
        }
        let started = generation
        do {
            let sync = try await fetch([URLQueryItem(name: "before", value: "\(oldest)"), URLQueryItem(name: "limit", value: "50")])
            guard started == generation else { return }
            applyState(sync)
            merge(sync.messages)
            hasOlderMessages = sync.hasMore
            rebuild()
        } catch {
            handleFetchError(error)
        }
    }

    /// Fetches one message again, for a fresh photo link once the old one expired (they last 15 minutes).
    public func reload(_ message: Message) async {
        guard let seq = message.seq else { return }
        let started = generation
        do {
            let sync = try await fetch([URLQueryItem(name: "before", value: "\(seq + 1)"), URLQueryItem(name: "limit", value: "1")])
            guard started == generation else { return }
            merge(sync.messages)
            rebuild()
        } catch {
            handleFetchError(error)
        }
    }

    /// Fetches what's new since the newest message (after a live event or a reconnect).
    func catchUp() async {
        if catchingUp {
            catchUpAgain = true
            return
        }
        catchingUp = true
        defer { catchingUp = false }
        repeat {
            catchUpAgain = false
            guard let newest = confirmed.last?.seq else {
                await refresh()
                continue
            }
            let started = generation
            do {
                var after = newest
                for _ in 0..<20 {
                    let sync = try await fetch([URLQueryItem(name: "after", value: "\(after)"), URLQueryItem(name: "limit", value: "100")])
                    guard started == generation else { return }
                    applyState(sync)
                    merge(sync.messages)
                    after = max(after, sync.messages.last?.seq ?? after)
                    if !sync.hasMore { break }
                }
                hasLoaded = true
                if connection == .offline { connection = isLive ? .live : .connecting }
                rebuild()
                await markReadIfNeeded()
            } catch {
                handleFetchError(error)
            }
        } while catchUpAgain
    }

    private func fetch(_ query: [URLQueryItem]) async throws -> WireSync {
        try await services.session.send(.get("/v1/conversation", query: query), as: WireSync.self)
    }

    private func handleFetchError(_ error: Error) {
        guard let error = error as? HireShelbyError, error.code != .cancelled else { return }
        services.log.info("Couldn't load the conversation: \(error.code.rawValue)")
        if error.code == .connectionFailed, isOpen {
            connection = .offline
            notify()
        }
    }

    /// The newest page: replaces what it covers; a gap to the cached messages drops the stale ones.
    private func applyLatest(_ sync: WireSync) {
        applyState(sync)
        if let first = sync.messages.first {
            let newestCached = confirmed.last?.seq ?? 0
            if newestCached < first.seq - 1 || newestCached > (sync.messages.last?.seq ?? 0) {
                confirmed = []
                hasOlderMessages = sync.hasMore
            } else if (confirmed.first?.seq ?? .max) >= first.seq {
                hasOlderMessages = sync.hasMore
            }
        } else {
            confirmed = []
            hasOlderMessages = false
        }
        merge(sync.messages)
    }

    private func applyState(_ sync: WireSync) {
        onIdentity?(sync.identity)
        sending = SendingState(sync.sending)
        if let latest = sync.conversation {
            if let current = conversation, current.id != latest.id {
                // the team started over (a reset): the old messages belong to another conversation
                confirmed = []
                lastReadPosted = 0
            }
            conversation = latest
            if latest.unread == 0 || !isOpen { onUnreadCount?(latest.unread) }
        } else {
            conversation = nil
            confirmed = []
        }
    }

    private func merge(_ incoming: [WireMessage]) {
        guard !incoming.isEmpty else { return }
        var byId = Dictionary(confirmed.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for message in incoming { byId[message.id] = message }
        confirmed = byId.values.sorted { $0.seq < $1.seq }
        // a pending message the server already has (its answer got lost) is done: dedupe by clientId
        let delivered = Set(incoming.compactMap { $0.clientId?.lowercased() })
        for item in outbox.items where delivered.contains(item.clientId) {
            outbox.remove(item.clientId)
        }
        if incoming.contains(where: { $0.sender == "agent" }) { typing = nil }
    }

    private func rebuild(notify shouldNotify: Bool = true) {
        let confirmedClientIds = Set(confirmed.compactMap { $0.clientId?.lowercased() })
        let pending = outbox.items
            .filter { !confirmedClientIds.contains($0.clientId) }
            .map { Message(pending: $0, photoURL: outbox.photoURL) }
        messages = confirmed.map(Message.init) + pending
        if shouldNotify {
            saveCache()
            notify()
        }
    }

    private func notify() {
        observers.notify(())
    }

    private func saveCache() {
        guard !confirmed.isEmpty || conversation != nil else {
            services.files.remove(Self.cacheFile)
            return
        }
        let recent = Array(confirmed.suffix(Self.cacheSize))
        services.files.write(
            Cache(conversation: conversation, messages: recent, hasOlderMessages: hasOlderMessages || recent.count < confirmed.count),
            to: Self.cacheFile
        )
    }

    // MARK: Reading

    private func markReadIfNeeded() async {
        guard isOpen, isAppActive, let conversation, let newest = confirmed.last?.seq else { return }
        guard conversation.unread > 0 || newest > conversation.userReadSeq, newest > lastReadPosted else { return }
        lastReadPosted = newest
        do {
            let result = try await services.session.send(.post("/v1/read", WireReadInput(seq: newest)), as: WireUnread.self)
            onUnreadCount?(result.unread)
        } catch {
            lastReadPosted = 0
        }
    }

    // MARK: Sending

    /// Sends a message: it shows at once as ``Message/Status/sending`` and goes out through the outbox, in
    /// order, retried until the server has it. Text is trimmed; at most 4,000 characters and 4 photos.
    /// - Returns: The message's `clientId`, or nil when there was nothing to send.
    @discardableResult
    public func send(text: String, photos: [HireShelbyPhoto] = []) -> String? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !photos.isEmpty else { return nil }
        guard text.utf16.count <= Limits.messageLength else {
            services.log.error("A message over 4,000 characters wasn't sent")
            return nil
        }
        let clientId = UUID().uuidString.lowercased()
        outbox.append(clientId: clientId, text: text, photos: Array(photos.prefix(Limits.photosPerMessage)), createdAt: services.now())
        rebuild()
        flushOutbox()
        return clientId
    }

    /// Tries a message that wasn't delivered again.
    public func retry(_ message: Message) {
        guard let clientId = message.clientId, outbox.contains(clientId) else { return }
        outbox.update(clientId) {
            $0.failure = nil
            $0.attempts = 0
        }
        outboxAttempt = 0
        rebuild()
        flushOutbox()
    }

    /// Removes a message that wasn't delivered.
    public func discard(_ message: Message) {
        guard let clientId = message.clientId, outbox.contains(clientId) else { return }
        outbox.remove(clientId)
        rebuild()
    }

    /// Whether messages are waiting to be sent.
    public var hasPendingMessages: Bool { !outbox.items.isEmpty }

    private func retryTransientFailures() {
        for item in outbox.items where item.failure.map(OutboxItem.isTransient) == true {
            outbox.update(item.clientId) { $0.failure = nil }
        }
        outboxAttempt = 0
        outboxRetry?.cancel()
        outboxRetry = nil
        rebuild()
        flushOutbox()
    }

    /// Sends pending messages one at a time, oldest first. A transient failure stops the run (so later messages
    /// never overtake earlier ones) and schedules a retry with backoff; a failure only the user can fix marks
    /// that message and moves on.
    func flushOutbox() {
        guard isAppActive else { return }
        if flushing {
            flushAgain = true
            return
        }
        guard outbox.items.contains(where: { !$0.isStuck }) else { return }
        flushing = true
        Task {
            await runFlush()
            flushing = false
            if flushAgain {
                flushAgain = false
                flushOutbox()
            }
        }
    }

    private func runFlush() async {
        for clientId in outbox.items.map(\.clientId) {
            guard isAppActive else { return }
            guard let item = outbox.item(clientId), !item.isStuck else { continue }
            let started = generation
            do {
                let result = try await deliver(clientId)
                guard started == generation else { return } // logged out meanwhile
                outboxAttempt = 0
                outbox.remove(clientId)
                if let current = conversation, current.id != result.conversation.id { confirmed = [] }
                conversation = result.conversation
                merge([result.message])
                rebuild()
                onEvent?(.messageSent)
            } catch {
                let error = (error as? HireShelbyError) ?? .connectionFailed(String(describing: error))
                if error.code == .cancelled { return }
                guard outbox.contains(clientId) else { continue } // discarded meanwhile
                if error.isTransient {
                    outbox.update(clientId) {
                        $0.attempts += 1
                        // after a few tries, show "Not delivered" while still retrying
                        if $0.attempts >= 3 { $0.failure = OutboxItem.isTransient(error.code.rawValue) ? error.code.rawValue : HireShelbyError.Code.connectionFailed.rawValue }
                    }
                    if error.code == .connectionFailed, isOpen { connection = .offline }
                    rebuild()
                    scheduleOutboxRetry(after: error.retryAfter)
                    return
                }
                services.log.error("A message wasn't delivered: \(error.code.rawValue)")
                outbox.update(clientId) { $0.failure = error.code.rawValue }
                if error.code == .verificationRequired {
                    sending = SendingState(isAllowed: false, restriction: .verificationRequired)
                } else if error.code == .deviceBlocked {
                    sending = SendingState(isAllowed: false, restriction: .deviceBlocked)
                }
                rebuild()
            }
        }
    }

    private func scheduleOutboxRetry(after retryAfter: Double?) {
        let delay = max(retryAfter ?? 0, services.outboxBackoff.delay(forAttempt: outboxAttempt))
        outboxAttempt += 1
        outboxRetry?.cancel()
        let sleeper = services.sleeper
        outboxRetry = Task { [weak self] in
            do {
                try await sleeper.sleep(seconds: delay)
            } catch {
                return
            }
            self?.outboxRetry = nil
            self?.flushOutbox()
        }
    }

    private func deliver(_ clientId: String) async throws -> WireSendResult {
        while true {
            guard let item = outbox.item(clientId) else { throw HireShelbyError.cancelled }
            do {
                for photo in item.photos where !photo.uploaded {
                    try await upload(photo, of: clientId)
                }
                let ids = outbox.item(clientId)?.photos.compactMap(\.attachmentId) ?? []
                return try await services.session.send(
                    .post("/v1/messages", WireSendMessage(clientId: clientId, text: item.text, attachmentIds: ids)),
                    as: WireSendResult.self
                )
            } catch let error as HireShelbyError
                where (error.code == .uploadIncomplete || error.code == .invalidAttachment) && !item.photos.isEmpty && item.photoResets < 2 {
                // the upload expired or didn't arrive: upload again with fresh tickets
                outbox.update(clientId) {
                    $0.photoResets += 1
                    for index in $0.photos.indices {
                        $0.photos[index].uploaded = false
                        $0.photos[index].attachmentId = nil
                    }
                }
            }
        }
    }

    /// `POST /v1/uploads` for a ticket, then the bytes straight to storage with the signed headers.
    private func upload(_ photo: OutboxPhoto, of clientId: String) async throws {
        guard let data = outbox.photoData(photo) else {
            throw HireShelbyError(code: .invalidAttachment, message: "The photo is no longer on the device")
        }
        let ticket = try await services.session.send(
            .post(
                "/v1/uploads",
                WireUploadRequest(contentType: photo.contentType, bytes: photo.bytes, width: photo.width, height: photo.height, checksum: photo.checksum),
                retry: .unsentOnly
            ),
            as: WireUploadTicket.self
        )
        guard let url = URL(string: ticket.uploadUrl) else { throw HireShelbyError.invalidResponse("Bad upload URL") }
        outbox.update(clientId) { item in
            if let index = item.photos.firstIndex(where: { $0.file == photo.file }) { item.photos[index].attachmentId = ticket.attachmentId }
        }
        let put = HTTPRequest(method: ticket.method, url: url, headers: ticket.headers, body: data, timeout: 60)
        var attempt = 0
        while true {
            do {
                let response = try await services.http.send(put)
                if (200..<300).contains(response.status) { break }
                if response.status >= 500, attempt < 2 {
                    attempt += 1
                    try await services.sleeper.sleep(seconds: Backoff.request.delay(forAttempt: attempt))
                    continue
                }
                if response.status >= 500 { throw HireShelbyError(code: .internalError, status: response.status, message: "Storage error") }
                throw HireShelbyError(code: .uploadIncomplete, status: response.status, message: "Storage refused the upload")
            } catch let error as HireShelbyError {
                throw error
            } catch {
                if APIClient.isCancellation(error) { throw HireShelbyError.cancelled }
                if attempt < 2 {
                    attempt += 1
                    try? await services.sleeper.sleep(seconds: Backoff.request.delay(forAttempt: attempt))
                    continue
                }
                throw HireShelbyError.connectionFailed("Photo upload: \(APIClient.describe(error))")
            }
        }
        outbox.update(clientId) { item in
            if let index = item.photos.firstIndex(where: { $0.file == photo.file }) { item.photos[index].uploaded = true }
        }
    }

    // MARK: Typing

    /// The user is typing: tells the team (at most every 2 seconds, only while live).
    public func userIsTyping() {
        let now = services.now()
        guard isOpen, let live, now.timeIntervalSince(lastTypingSentAt) >= 2 else { return }
        lastTypingSentAt = now
        Task { await live.send(.typing) }
    }

    private func showTyping(name: String?) {
        let seconds = 5.0
        typing = Typing(name: name, expiresAt: services.now().addingTimeInterval(seconds))
        typingExpiry?.cancel()
        let sleeper = services.sleeper
        typingExpiry = Task { [weak self] in
            guard (try? await sleeper.sleep(seconds: seconds)) != nil, let self else { return }
            if let typing = self.typing, typing.expiresAt <= self.services.now() {
                self.typing = nil
                self.notify()
            }
        }
    }

    // MARK: Cards

    /// What tapping the card's button would do, for rendering (an offer for a paywall the app no longer reports
    /// shows "No longer available"). Nil when the message has no button.
    public func cardAction(for message: Message) -> CardAction? {
        switch message.card {
        case .review(let url?, _)?: return .openReview(url)
        case .offer(let id, _)?: return isPaywallAvailable?(id) == true ? .presentPaywall(id: id) : .unavailable
        default: return nil
        }
    }

    /// Records a tap on a card's button (the first one counts; sent later if offline) and returns what to do.
    @discardableResult
    public func tapCard(_ message: Message) -> CardAction? {
        guard let action = cardAction(for: message), action != .unavailable, let serverId = message.serverId else {
            return cardAction(for: message)
        }
        let clickedAt = ISODate.format(services.now())
        if let index = confirmed.firstIndex(where: { $0.id == serverId }), confirmed[index].actionClickedAt == nil {
            confirmed[index] = confirmed[index].withActionClickedAt(clickedAt)
            rebuild()
        }
        if !pendingClicks.contains(where: { $0.messageId == serverId }) {
            pendingClicks.append(PendingClick(messageId: serverId, clickedAt: clickedAt))
            services.files.write(pendingClicks, to: Self.clicksFile)
        }
        switch action {
        case .openReview: onEvent?(.reviewOpened)
        case .presentPaywall(let id): onEvent?(.paywallOpened(paywallId: id))
        case .unavailable: break
        }
        Task { await flushClicks() }
        return action
    }

    /// Sends cached tap receipts, one run at a time; a request made during a run makes it go round again.
    private func flushClicks() async {
        if flushingClicks {
            flushClicksAgain = true
            return
        }
        flushingClicks = true
        defer { flushingClicks = false }
        repeat {
            flushClicksAgain = false
            while let click = pendingClicks.first {
                do {
                    _ = try await services.session.send(
                        .post("/v1/actions/\(click.messageId)/click", WireClickInput(clickedAt: click.clickedAt)),
                        as: WireClickResult.self
                    )
                } catch let error as HireShelbyError where !error.isTransient && error.code != .cancelled {
                    services.log.info("A card tap receipt was refused (\(error.code.rawValue))")
                } catch {
                    break
                }
                pendingClicks.removeAll { $0.messageId == click.messageId }
                if pendingClicks.isEmpty {
                    services.files.remove(Self.clicksFile)
                } else {
                    services.files.write(pendingClicks, to: Self.clicksFile)
                }
            }
        } while flushClicksAgain && !pendingClicks.isEmpty
    }

    // MARK: Live

    private var isLive: Bool { connection == .live }

    private func startLive() {
        guard isOpen, isAppActive, live == nil, let url = LiveConnection.url(forAPIBase: services.apiBaseURL) else { return }
        let session = services.session
        let connection = LiveConnection(
            url: url,
            transport: services.webSocket,
            tokenProvider: { try await session.accessToken() },
            invalidateToken: { token in await session.invalidate(accessToken: token) },
            sleeper: services.sleeper,
            backoff: services.liveBackoff,
            log: services.log,
            userAgent: services.userAgent
        )
        live = connection
        let handler: @Sendable (LiveSignal) async -> Void = { [weak self] signal in
            await self?.handle(signal, from: connection)
        }
        Task { await connection.start(handler) }
    }

    private func stopLive() {
        guard let live else { return }
        self.live = nil
        Task { await live.stop() }
    }

    func handle(_ signal: LiveSignal, from source: LiveConnection) async {
        guard source === live else { return }
        switch signal {
        case .connecting:
            if connection != .offline { connection = .connecting }
        case .connected:
            connection = .live
            stopFallbackPolling()
            notify()
            await catchUp()
            flushOutbox()
        case .disconnected:
            connection = .connecting
            startFallbackPolling()
        case .event(.message(let seq)):
            if seq > (confirmed.last?.seq ?? 0) { await catchUp() }
        case .event(.read(let seq)):
            teamReadSeq = max(teamReadSeq, seq)
        case .event(.typing(let name)):
            showTyping(name: name)
        case .event(.resync):
            await catchUp()
        case .event(.ready):
            break
        }
        notify()
    }

    /// While the chat is open and live updates are down, poll for new messages.
    private func startFallbackPolling() {
        guard isOpen, isAppActive, fallbackPoll == nil else { return }
        let sleeper = services.sleeper
        let interval = services.fallbackPollSeconds
        fallbackPoll = Task { [weak self] in
            while !Task.isCancelled {
                guard (try? await sleeper.sleep(seconds: interval)) != nil else { return }
                guard let self, self.isOpen, !self.isLive else { return }
                await self.catchUp()
                self.flushOutbox()
            }
        }
    }

    private func stopFallbackPolling() {
        fallbackPoll?.cancel()
        fallbackPoll = nil
    }
}
