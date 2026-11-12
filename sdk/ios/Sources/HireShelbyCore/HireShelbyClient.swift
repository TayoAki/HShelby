import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The Hire Shelby engine: the device session, the conversation, the unread count and everything the app reports.
///
/// Most apps use the `HireShelby` facade (`HireShelby.configure(appId:)`, `HireShelby.shared`), which owns one
/// client and adds the chat UI. Use a client directly for a custom UI or headless use. Everything is on the main
/// actor; network work happens off it.
@MainActor
public final class HireShelbyClient {
    /// Where the SDK talks to by default.
    public nonisolated static let defaultAPIBaseURL = URL(string: "https://api.hireshelby.com")!

    /// How a client is set up.
    public struct Configuration: Sendable {
        /// The App ID from the dashboard: `app_` and 22 letters and digits.
        public var appId: String
        public var apiBaseURL: URL
        public var logLevel: HireShelbyLogLevel
        public var logHandler: HireShelbyLogHandler?
        /// Pushes set the app icon's badge to the unread count (reported to the server). Turn off if the app
        /// owns its badge.
        public var updatesAppBadge: Bool
        /// Fetch the chat design the team published in the dashboard.
        public var usesRemoteAppearance: Bool
        /// Seconds between unread-count checks while the app is active and the chat is closed. With a push token
        /// the SDK checks every 5 minutes at most, since pushes carry new replies.
        public var unreadPollInterval: TimeInterval
        /// Where the SDK keeps its files; defaults to Application Support/HireShelby/<App ID>.
        public var storageDirectory: URL?

        public init(
            appId: String,
            apiBaseURL: URL = HireShelbyClient.defaultAPIBaseURL,
            logLevel: HireShelbyLogLevel = .error,
            logHandler: HireShelbyLogHandler? = nil,
            updatesAppBadge: Bool = true,
            usesRemoteAppearance: Bool = true,
            unreadPollInterval: TimeInterval = 30,
            storageDirectory: URL? = nil
        ) {
            self.appId = appId
            self.apiBaseURL = apiBaseURL
            self.logLevel = logLevel
            self.logHandler = logHandler
            self.updatesAppBadge = updatesAppBadge
            self.usesRemoteAppearance = usesRemoteAppearance
            self.unreadPollInterval = unreadPollInterval
            self.storageDirectory = storageDirectory
        }
    }

    /// What the client uses from the outside world; tests swap these.
    struct Dependencies: Sendable {
        var http: any HTTPTransport
        var webSocket: any WebSocketTransport
        var credentials: any CredentialStore
        var sleeper: any Sleeper = TaskSleeper()
        var now: @Sendable () -> Date = { Date() }
        var deviceDetails: WireDeviceDetails = DeviceInfo.current()
        var monitorsNetwork = true
        /// Coalesces a burst of identify/setMetadata/push calls at launch into one request.
        var syncDelay: Double = 0.3
        var requestBackoff: Backoff = .request
        var outboxBackoff: Backoff = .outbox
        var liveBackoff: Backoff = .live
    }

    public let configuration: Configuration
    /// The device's conversation, for the chat UI or a custom one.
    public let conversation: HireShelbyConversation

    /// Unread team messages in the device's conversation. Starts at 0; server syncs change it.
    public private(set) var unreadCount = 0 {
        didSet {
            guard unreadCount != oldValue else { return }
            unreadObservers.notify(unreadCount)
            for continuation in unreadContinuations.values { continuation.yield(unreadCount) }
        }
    }
    /// Who the device is, as the server last said.
    public private(set) var identity = HireShelbyIdentity.anonymous
    /// The paywalls last reported with ``reportPaywalls(_:)`` (after validation).
    public private(set) var paywalls: [HireShelbyPaywall] = []
    /// The chat design the team published, once fetched (cached across launches).
    public private(set) var appearance: HireShelbyAppearance?

    /// Called for ``HireShelbyEvent``s on the main actor.
    public var onEvent: (@MainActor (HireShelbyEvent) -> Void)?

    let services: Services
    private let dependencies: Dependencies
    private var serialTail: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var noticeTask: Task<Void, Never>?
    private var started = false
    private var isAppActive = true
    private var hasPushToken = false
    private var trackedEvents: (names: Set<String>, expiresAt: Date)?
    private var appearanceETag: String?
    private var appearanceFetchedAt: Date?
    private let unreadObservers = ObserverList<Int>()
    private var unreadContinuations: [UUID: AsyncStream<Int>.Continuation] = [:]
    private var networkMonitor: NetworkMonitor?

    static let installFile = "install.json"
    static let appearanceFile = "appearance.json"

    private struct CachedAppearance: Codable {
        var etag: String?
        var appearance: WirePublicAppearance
    }

    /// Creates a client.
    /// - Throws: ``HireShelbyError`` (``HireShelbyError/Code/notConfigured``) for a malformed App ID.
    public convenience init(configuration: Configuration) throws {
        let session = URLSessionHTTPTransport.makeSession()
        #if canImport(Security)
        let credentials: any CredentialStore = KeychainCredentialStore(appId: configuration.appId, apiHost: configuration.apiBaseURL.host ?? "api")
        #else
        let credentials: any CredentialStore = InMemoryCredentialStore()
        #endif
        try self.init(
            configuration: configuration,
            dependencies: Dependencies(
                http: URLSessionHTTPTransport(session: session),
                webSocket: URLSessionWebSocketTransport(session: session),
                credentials: credentials
            )
        )
    }

    init(configuration: Configuration, dependencies: Dependencies) throws {
        guard Limits.matches(configuration.appId, Limits.appIdPattern) else {
            throw HireShelbyError(code: .notConfigured, message: "\"\(configuration.appId)\" isn't an App ID; copy it from the dashboard (app_…)")
        }
        self.configuration = configuration
        self.dependencies = dependencies
        let log = Log(level: configuration.logLevel, handler: configuration.logHandler)
        let files = FileStore(directory: configuration.storageDirectory ?? FileStore.defaultDirectory(appId: configuration.appId))
        files.ensureDirectory()
        let userAgent = "HireShelby-iOS/\(HireShelbyVersion.current)"
        var api = APIClient(baseURL: configuration.apiBaseURL, transport: dependencies.http, sleeper: dependencies.sleeper, userAgent: userAgent, log: log)
        api.backoff = dependencies.requestBackoff
        let session = DeviceSession(appId: configuration.appId, api: api, credentialStore: dependencies.credentials, files: files, log: log, now: dependencies.now)
        var services = Services(
            appId: configuration.appId, apiBaseURL: configuration.apiBaseURL, api: api, session: session, files: files,
            http: dependencies.http, webSocket: dependencies.webSocket, sleeper: dependencies.sleeper, log: log,
            now: dependencies.now, userAgent: userAgent
        )
        services.outboxBackoff = dependencies.outboxBackoff
        services.liveBackoff = dependencies.liveBackoff
        self.services = services
        conversation = HireShelbyConversation(services: services)
        if let cached = files.read(CachedAppearance.self, from: Self.appearanceFile) {
            appearanceETag = cached.etag
            appearance = HireShelbyAppearance(cached.appearance)
        }
        wireConversation()

        // The Keychain outlives the app: a reinstall starts a new device rather than resuming the old one.
        if !files.exists(Self.installFile) {
            files.write(["installedAt": ISODate.format(dependencies.now())], to: Self.installFile)
            serial { await session.wipe() }
        } else if let saved = files.read(PersistedDeviceState.self, from: DeviceSession.stateFile) {
            // what the app reported in earlier launches, until it reports again
            identity = saved.identity.map(HireShelbyIdentity.init) ?? .anonymous
            paywalls = saved.desired.paywalls?.map(HireShelbyPaywall.init) ?? []
            hasPushToken = saved.desired.push != nil
        }
    }

    private func wireConversation() {
        conversation.onUnreadCount = { [weak self] count in self?.unreadCount = count }
        conversation.onIdentity = { [weak self] wire in self?.identity = HireShelbyIdentity(wire) }
        conversation.isPaywallAvailable = { [weak self] id in
            self?.paywalls.contains { $0.id == id && $0.isPresentable } ?? false
        }
        conversation.onEvent = { [weak self] event in
            guard let self else { return }
            switch event {
            case .chatOpened:
                stopUnreadPolling()
            case .chatClosed:
                startUnreadPolling()
            default:
                break
            }
            onEvent?(event)
        }
    }

    // MARK: Lifecycle

    /// Starts the client: registers or updates the device, fetches the unread count and the published design,
    /// and replays pending messages and logouts. `HireShelby.configure` calls this.
    public func start() {
        guard !started else { return }
        started = true
        let session = services.session
        noticeTask = Task { [weak self] in
            for await notice in session.notices {
                guard let self else { return }
                self.apply(notice)
            }
        }
        let details = dependencies.deviceDetails
        serial { await session.updateDesired { $0.device = details } }
        scheduleSync()
        serial { await session.flushPendingLogouts() }
        startUnreadPolling()
        conversation.flushOutbox()
        Task { await refreshAppearance() }
        if dependencies.monitorsNetwork {
            networkMonitor = NetworkMonitor { [weak self] in
                Task { @MainActor in self?.networkBecameAvailable() }
            }
        }
    }

    /// Stops background work (polling, live updates, the network monitor). The client can't be restarted.
    public func stop() {
        started = false
        noticeTask?.cancel()
        pollTask?.cancel()
        pollTask = nil
        syncTask?.cancel()
        networkMonitor?.cancel()
        networkMonitor = nil
        conversation.close()
        conversation.setAppActive(false)
        for continuation in unreadContinuations.values { continuation.finish() }
        unreadContinuations = [:]
    }

    /// The app became active (foreground). The facade calls this from `UIApplication` notifications.
    public func applicationDidBecomeActive() {
        guard !isAppActive else { return }
        isAppActive = true
        conversation.setAppActive(true)
        scheduleSync()
        startUnreadPolling()
        let session = services.session
        serial { await session.flushPendingLogouts() }
        Task { await refreshAppearance() }
    }

    /// The app went to the background: live updates and polling stop.
    public func applicationDidEnterBackground() {
        guard isAppActive else { return }
        isAppActive = false
        conversation.setAppActive(false)
        stopUnreadPolling()
    }

    private func networkBecameAvailable() {
        guard started, isAppActive else { return }
        conversation.networkBecameAvailable()
        scheduleSync()
    }

    private func apply(_ notice: SessionNotice) {
        switch notice {
        case .identity(let wire):
            identity = wire.map(HireShelbyIdentity.init) ?? .anonymous
        case .deviceRegistered:
            trackedEvents = nil
            conversation.deviceChanged()
            Task { await refreshUnreadCount() }
        case .identityRejected(let error):
            onEvent?(.identityRejected(error))
        }
    }

    // MARK: Ordering

    /// Runs session changes one after another, in the order the app made them (logout before the next
    /// identify, staging before syncing).
    @discardableResult
    private func serial<T: Sendable>(_ operation: @escaping @MainActor () async throws -> T) -> Task<T, Error> {
        let previous = serialTail
        let task = Task { @MainActor () async throws -> T in
            _ = await previous?.value
            return try await operation()
        }
        serialTail = Task { _ = await task.result }
        return task
    }

    private func stage(_ change: @escaping @Sendable (inout DeviceStateSnapshot) -> Void) {
        let session = services.session
        serial { await session.updateDesired(change) }
        scheduleSync()
    }

    private func scheduleSync() {
        syncTask?.cancel()
        let delay = dependencies.syncDelay
        let sleeper = services.sleeper
        syncTask = Task { [weak self] in
            guard (try? await sleeper.sleep(seconds: delay)) != nil, let self, !Task.isCancelled else { return }
            self.syncNow()
        }
    }

    /// Sends staged device state now (registering first if needed).
    @discardableResult
    func syncNow() -> Task<Void, Error> {
        let session = services.session
        let log = services.log
        return serial {
            let wasRegistered = await session.isRegistered
            do {
                try await session.sync()
            } catch {
                log.info("Device update failed: \(error)")
                throw error
            }
            if !wasRegistered { await self.refreshUnreadCount() }
        }
    }

    /// Waits until the staged changes so far have reached the server (or failed).
    public func flush() async throws {
        syncTask?.cancel()
        try await syncNow().value
    }

    // MARK: Identity

    /// Labels the user for the team: what the app knows about them. Unverified: anyone with the App ID could send
    /// these. A nil field keeps the earlier value; labels are never cleared, only replaced. A different `userId`
    /// than the device's starts a new session for the new user (their own conversation).
    public func identify(userId: String? = nil, name: String? = nil, email: String? = nil) {
        let labels = WireIdentityLabels(
            userId: clean(userId, max: Limits.userId, field: "userId"),
            name: clean(name, max: Limits.name, field: "name"),
            email: clean(email, max: Limits.email, field: "email")
        )
        guard !labels.isEmpty else { return }
        let session = services.session
        serial {
            if let newUser = labels.userId {
                let current = await session.identity?.userId
                if let current, current != newUser {
                    await self.endSession()
                }
            }
            await session.updateDesired { state in
                // a different pending user replaces the labels instead of merging into them
                if let pendingUser = state.identity?.userId, let newUser = labels.userId, pendingUser != newUser {
                    state.identity = labels
                } else {
                    state.identity = (state.identity ?? WireIdentityLabels()).merging(labels)
                }
            }
        }
        scheduleSync()
    }

    /// Verifies the user with an HS256 JWT your server signed with the app's identity secret (claims `user_id`,
    /// `exp`, optional `name` and `email`). Call it after sign-in and on every launch; the token stays in memory.
    /// A token for a different user than the device's starts a new session first. A rejected token is reported
    /// as ``HireShelbyEvent/identityRejected(_:)``.
    public func identify(token: String) {
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let userId: String
        switch IdentityToken.userId(in: token) {
        case .success(let value):
            userId = value
        case .failure(.looksLikeSecret):
            services.log.error("identify(token:) got the identity secret itself. Sign tokens on your server; never ship the secret in the app.")
            return
        case .failure(.tooLong):
            services.log.error("identify(token:): tokens are at most 4,096 characters")
            return
        case .failure(.malformed):
            services.log.error("identify(token:) needs a JWT with a user_id claim")
            return
        }
        let session = services.session
        serial {
            if let current = await session.identity?.userId, current != userId {
                await self.endSession()
            }
            await session.setIdentityToken(token)
        }
        scheduleSync()
    }

    /// Ends the device's session: a real sign-out or account switch, never for guests. The next activity
    /// registers a new device, which starts a new conversation; the old one stays in the team's inbox.
    public func logout() {
        let session = services.session
        conversation.reset(discardOutbox: true)
        unreadCount = 0
        identity = .anonymous
        trackedEvents = nil
        serial { await session.logout() }
    }

    private func endSession() async {
        conversation.reset(discardOutbox: true)
        unreadCount = 0
        trackedEvents = nil
        await services.session.logout()
    }

    /// Deletes the device's data on the server (identity, metadata, conversations, messages, photos) and here.
    /// Call it on account deletion, and await it before discarding the session.
    /// - Throws: ``HireShelbyError``: ``HireShelbyError/Code/connectionFailed`` offline,
    ///   ``HireShelbyError/Code/deleteFailed`` when the server couldn't finish (retry).
    public func deleteData() async throws {
        let session = services.session
        try await serial {
            try await session.deleteDevice()
            self.conversation.reset(discardOutbox: true)
            self.unreadCount = 0
            self.identity = .anonymous
            self.trackedEvents = nil
            self.onEvent?(.dataDeleted)
        }.value
    }

    // MARK: Metadata, push, paywalls, StoreKit

    /// Replaces the details the team sees next to the chat: at most 20 entries, keys 1–64 characters, values
    /// up to 512. `[:]` clears them. Names and emails belong in ``identify(userId:name:email:)``.
    public func setMetadata(_ metadata: [String: String]) {
        guard metadata.count <= Limits.metadataEntries else {
            services.log.error("setMetadata takes at most 20 entries (got \(metadata.count)); nothing was changed")
            return
        }
        var valid: [String: String] = [:]
        for (key, value) in metadata {
            guard !key.isEmpty, key.utf16.count <= Limits.metadataKey else {
                services.log.error("setMetadata: keys are 1–64 characters; skipped one")
                continue
            }
            guard value.utf16.count <= Limits.metadataValue else {
                services.log.error("setMetadata: \"\(key)\" is over 512 characters; skipped")
                continue
            }
            valid[key] = value
        }
        let replacement = valid
        stage { $0.metadata = replacement }
    }

    /// Forwards the APNs device token from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    /// The SDK never asks for notification permission.
    public func setPushToken(_ token: Data, environment: HireShelbyPushEnvironment = .automatic) {
        let hex = token.map { byte in
            let digits = String(byte, radix: 16)
            return digits.count == 1 ? "0" + digits : digits
        }.joined()
        guard (32...200).contains(hex.count) else {
            services.log.error("setPushToken: that isn't an APNs device token")
            return
        }
        let registration = WirePushRegistration(token: hex, environment: environment.resolved, updatesAppBadge: configuration.updatesAppBadge)
        hasPushToken = true
        stage { $0.push = registration }
        Task { await refreshUnreadCount() }
    }

    /// Stops pushes to this device (for example, the user turned notifications off in the app).
    public func clearPushToken() {
        hasPushToken = false
        stage { $0.push = nil }
    }

    /// Whether the person opted in, in the app, to promotional notifications (App Review guideline 4.5.4).
    /// Offers and automations' messages are pushed only when they did; they always appear in the chat, and the
    /// team's replies always push. Report it whenever the person's choice changes, and at launch.
    public func setPromotionalPushAllowed(_ allowed: Bool) {
        stage { $0.promotionalPush = allowed }
    }

    /// Reports the paywalls the app can show right now, replacing the earlier list; the team can send offers only
    /// for these. Invalid entries are skipped with a log: IDs of 1–64 `A–Z a–z 0–9 _ . -`, titles 1–60
    /// characters, at most 20 paywalls, 10 products each and 40 in total.
    public func reportPaywalls(_ paywalls: [HireShelbyPaywall]) {
        var valid: [HireShelbyPaywall] = []
        var ids = Set<String>()
        var productCount = 0
        for var paywall in paywalls {
            guard valid.count < Limits.paywalls else {
                services.log.error("reportPaywalls: at most 20 paywalls; the rest were skipped")
                break
            }
            paywall.title = paywall.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard Limits.matches(paywall.id, Limits.paywallIdPattern), !ids.contains(paywall.id) else {
                services.log.error("reportPaywalls: skipped an invalid or repeated paywall ID")
                continue
            }
            guard (1...Limits.paywallTitle).contains(paywall.title.utf16.count) else {
                services.log.error("reportPaywalls: \(paywall.id)'s title must be 1–60 characters")
                continue
            }
            paywall.products = Array(
                paywall.products
                    .filter { !$0.id.trimmingCharacters(in: .whitespaces).isEmpty && $0.id.utf16.count <= 200 }
                    .prefix(Limits.productsPerPaywall)
            )
            if productCount + paywall.products.count > Limits.productsTotal {
                paywall.products = Array(paywall.products.prefix(max(0, Limits.productsTotal - productCount)))
            }
            productCount += paywall.products.count
            ids.insert(paywall.id)
            valid.append(paywall)
        }
        self.paywalls = valid
        let wire = valid.map(\.wire)
        stage { $0.paywalls = wire }
    }

    /// Reports what StoreKit says on the device: whether the person pays, and the original transaction IDs of
    /// their subscriptions (which match App Store Server Notifications to them; the server keeps them across
    /// reports). See also `reportStoreKitEntitlements()`.
    public func reportStoreKit(paying: Bool?, originalTransactionIds: [String] = []) {
        var ids: [String] = []
        for id in originalTransactionIds where Limits.matches(id, Limits.transactionIdPattern) && !ids.contains(id) {
            ids.append(id)
        }
        let report = WireStoreKit(paying: paying, originalTransactionIds: ids.isEmpty ? nil : Array(ids.suffix(Limits.transactionIds)))
        guard report.paying != nil || report.originalTransactionIds != nil else { return }
        stage { $0.storekit = report }
    }

    /// Reports the app's own chat design, so the dashboard's design editor starts from it. The facade does this
    /// from its theme.
    public func reportLocalAppearance(_ appearance: HireShelbyLocalAppearance) {
        let json = appearance.json
        stage { $0.appearance = json }
    }

    // MARK: Unread

    /// Fetches the unread count now (it also updates on launch, foreground, chat close and pushes).
    public func refreshUnreadCount() async {
        // never register a device just to learn it has nothing unread
        guard await services.session.isRegistered else { return }
        do {
            let result = try await services.session.send(.get("/v1/unread"), as: WireUnread.self)
            unreadCount = result.unread
        } catch {
            services.log.debug("Unread check failed: \(error)")
        }
    }

    /// The unread count now and after every change.
    public var unreadCountUpdates: AsyncStream<Int> {
        let (stream, continuation) = AsyncStream.makeStream(of: Int.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        unreadContinuations[id] = continuation
        continuation.yield(unreadCount)
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor in self?.unreadContinuations[id] = nil }
        }
        return stream
    }

    /// Calls `observer` with the unread count now and after every change, until the observation is cancelled
    /// or released. Handy for UIKit badges.
    public func observeUnreadCount(_ observer: @escaping @MainActor (Int) -> Void) -> HireShelbyObservation {
        observer(unreadCount)
        return unreadObservers.add(observer)
    }

    private var pollInterval: TimeInterval {
        let base = max(5, configuration.unreadPollInterval)
        return hasPushToken ? max(base, 300) : base
    }

    private func startUnreadPolling() {
        guard started, isAppActive, !conversation.isOpen, pollTask == nil else { return }
        let sleeper = services.sleeper
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refreshUnreadCount()
                let interval = self.pollInterval
                guard (try? await sleeper.sleep(seconds: interval)) != nil else { return }
            }
        }
    }

    private func stopUnreadPolling() {
        pollTask?.cancel()
        pollTask = nil
        if conversation.isOpen == false, isAppActive {
            // the chat just closed or the app paused: one fresh count
            Task { await refreshUnreadCount() }
        }
    }

    // MARK: Push

    /// The custom key in Hire Shelby notifications: `userInfo["hireshelby"] = {conversationId, messageId}`.
    public nonisolated static let notificationKey = "hireshelby"

    /// Whether a notification came from Hire Shelby.
    public nonisolated static func isHireShelbyNotification(_ userInfo: [AnyHashable: Any]) -> Bool {
        userInfo[AnyHashable(notificationKey)] is [AnyHashable: Any]
    }

    /// Handles a notification's payload: refreshes the unread count and the open chat. Returns false for
    /// notifications that aren't Hire Shelby's.
    @discardableResult
    public func handleNotification(userInfo: [AnyHashable: Any]) -> Bool {
        guard Self.isHireShelbyNotification(userInfo) else { return false }
        Task {
            await refreshUnreadCount()
            if conversation.isOpen { await conversation.catchUp() }
        }
        return true
    }

    // MARK: Automations

    /// Tracks an app event (`paywall_declined`, `onboarding_completed`…) for automations. Only events an enabled
    /// automation listens for leave the device (the list is refreshed every few minutes). Never throws.
    @discardableResult
    public func track(_ event: String) async -> HireShelbyTrackResult {
        guard Limits.matches(event, Limits.eventPattern) else {
            services.log.error("track: event names are 1–64 lowercase letters, digits, _ . or -")
            return .skipped
        }
        do {
            guard try await trackedEventNames().contains(event) else {
                services.log.debug("track: no enabled automation listens for this event")
                return .skipped
            }
            let result = try await services.session.send(
                .post("/v1/track", WireTrackInput(event: event), retry: .unsentOnly),
                as: WireTrackResult.self
            )
            if result.sent {
                Task {
                    await refreshUnreadCount()
                    if conversation.isOpen { await conversation.catchUp() }
                }
            }
            return HireShelbyTrackResult(delivered: true, sent: result.sent, openChat: result.openChat)
        } catch {
            services.log.info("track failed: \(error)")
            return .skipped
        }
    }

    private func trackedEventNames() async throws -> Set<String> {
        if let cached = trackedEvents, cached.expiresAt > services.now() { return cached.names }
        let result = try await services.session.send(.get("/v1/track/events"), as: WireTrackedEvents.self)
        let names = Set(result.events)
        trackedEvents = (names, services.now().addingTimeInterval(Double(max(30, result.ttlSeconds))))
        return names
    }

    // MARK: Appearance

    /// Fetches the published chat design (no registration needed; cached with its ETag, at most once a minute).
    public func refreshAppearance() async {
        guard configuration.usesRemoteAppearance else { return }
        if let fetchedAt = appearanceFetchedAt, services.now().timeIntervalSince(fetchedAt) < 60 { return }
        appearanceFetchedAt = services.now()
        var request = APIRequest.get("/v1/apps/\(configuration.appId)/appearance")
        if let appearanceETag { request.headers["If-None-Match"] = appearanceETag }
        do {
            let response = try await services.api.send(request, accessToken: nil)
            guard response.status != 304 else { return }
            let wire = try APIClient.decode(WirePublicAppearance.self, from: response)
            appearanceETag = response.header("ETag")
            appearance = HireShelbyAppearance(wire)
            services.files.write(CachedAppearance(etag: appearanceETag, appearance: wire), to: Self.appearanceFile)
        } catch {
            services.log.debug("Appearance fetch failed: \(error)")
        }
    }

    // MARK: Helpers

    private func clean(_ value: String?, max: Int, field: String) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        guard value.utf16.count <= max else {
            services.log.error("identify: \(field) is over \(max) characters; left out")
            return nil
        }
        return value
    }
}

extension HireShelbyPaywall {
    init(_ wire: WirePaywall) {
        self.init(
            id: wire.id,
            title: wire.title,
            source: Source(rawValue: wire.source) ?? .app,
            isPresentable: wire.presentable,
            products: wire.products.map { Product(id: $0.id, price: $0.price, period: $0.period, trial: $0.trial) }
        )
    }
}
