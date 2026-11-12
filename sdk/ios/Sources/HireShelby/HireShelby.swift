import Foundation
#if canImport(Combine)
import Combine
#endif

/// Hire Shelby: an in-app support chat. Your users write from the app; your team answers from the dashboard,
/// Telegram or the AI.
///
/// ```swift
/// // At launch (App.init or application(_:didFinishLaunchingWithOptions:)):
/// HireShelby.configure(appId: "app_…")
///
/// // A Support button:
/// Button("Support") { HireShelby.shared.presentChat() }
///
/// // After sign-in, and after restoring a session:
/// HireShelby.shared.identify(userId: user.id, name: user.name, email: user.email)
/// ```
///
/// Everything is on the main actor. Calls made before ``configure(appId:options:)`` are kept and applied once it
/// runs.
@MainActor
public final class HireShelby {
    /// The one instance.
    public static let shared = HireShelby()

    /// How the SDK is set up. Pass to ``configure(appId:options:)``.
    public struct Options: Sendable {
        /// The API to talk to. Defaults to `https://api.hireshelby.com`.
        public var apiBaseURL: URL
        /// How much the SDK logs (to OSLog, subsystem `com.hireshelby.sdk`). Logs never contain secrets, message
        /// text, identity or metadata values.
        public var logLevel: HireShelbyLogLevel
        /// Send logs here instead of OSLog.
        public var logHandler: HireShelbyLogHandler?
        /// Keep the app icon's badge at the unread count (pushes set it; the SDK updates it on every sync and clears
        /// it at zero). Turn off if the app manages its own badge.
        public var updatesAppBadge: Bool
        /// Apply the chat design the team publishes in the dashboard. Remote values win over ``theme``.
        public var usesRemoteAppearance: Bool
        #if canImport(UIKit)
        /// The chat's look: match it to the app.
        public var theme: Theme
        /// What a review card's button does.
        public var reviewPrompt: ReviewPrompt
        #endif

        #if canImport(UIKit)
        public init(
            apiBaseURL: URL = HireShelbyClient.defaultAPIBaseURL,
            theme: Theme = Theme(),
            logLevel: HireShelbyLogLevel = .error,
            logHandler: HireShelbyLogHandler? = nil,
            updatesAppBadge: Bool = true,
            usesRemoteAppearance: Bool = true,
            reviewPrompt: ReviewPrompt = .appStorePage
        ) {
            self.apiBaseURL = apiBaseURL
            self.theme = theme
            self.logLevel = logLevel
            self.logHandler = logHandler
            self.updatesAppBadge = updatesAppBadge
            self.usesRemoteAppearance = usesRemoteAppearance
            self.reviewPrompt = reviewPrompt
        }
        #else
        public init(
            apiBaseURL: URL = HireShelbyClient.defaultAPIBaseURL,
            logLevel: HireShelbyLogLevel = .error,
            logHandler: HireShelbyLogHandler? = nil,
            updatesAppBadge: Bool = true,
            usesRemoteAppearance: Bool = true
        ) {
            self.apiBaseURL = apiBaseURL
            self.logLevel = logLevel
            self.logHandler = logHandler
            self.updatesAppBadge = updatesAppBadge
            self.usesRemoteAppearance = usesRemoteAppearance
        }
        #endif
    }

    /// The engine behind the facade, once configured. Use it for a custom chat UI (``HireShelbyClient/conversation``).
    public private(set) var client: HireShelbyClient?
    /// The options passed to ``configure(appId:options:)``.
    public private(set) var options = Options()

    #if canImport(Combine)
    /// Unread team messages. Show it as a badge on the Support entry; hide the badge at zero.
    @Published public private(set) var unreadCount = 0 {
        didSet { unreadCountDidChange(oldValue) }
    }
    /// The chat is on screen.
    @Published public private(set) var isChatOpen = false
    #else
    /// Unread team messages. Show it as a badge on the Support entry; hide the badge at zero.
    public private(set) var unreadCount = 0 {
        didSet { unreadCountDidChange(oldValue) }
    }
    /// The chat is on screen.
    public private(set) var isChatOpen = false
    #endif

    /// Called for SDK events (chat opened, message sent, card taps, data deleted, identity token rejected).
    public var onEvent: (@MainActor (HireShelbyEvent) -> Void)?

    /// Presents one of the app's paywalls when the user taps an offer card. Receives the paywall ID the app
    /// reported with ``reportPaywalls(_:)``. Present it above the chat, for example from ``topViewController()``.
    public var onPaywall: (@MainActor (_ paywallId: String) -> Void)?

    private var pending: [@MainActor (HireShelbyClient) -> Void] = []
    private var unreadObservation: HireShelbyObservation?
    private var unreadContinuations: [UUID: AsyncStream<Int>.Continuation] = [:]
    var isAppActive = true
    #if canImport(UIKit)
    var platform = PlatformState()
    #endif

    private init() {}

    // MARK: Setup

    /// Sets the SDK up. Call once at launch, before anything else, with the App ID from the dashboard.
    ///
    /// Calling it again with the same App ID and API updates the theme and review prompt; a different App ID starts
    /// over with a new session.
    public static func configure(appId: String, options: Options = Options()) {
        shared.configure(appId: appId, options: options)
    }

    /// Whether ``configure(appId:options:)`` accepted an App ID.
    public static var isConfigured: Bool { shared.client != nil }

    /// The SDK version.
    public static var version: String { HireShelbyVersion.current }

    private func configure(appId: String, options: Options) {
        let appId = appId.trimmingCharacters(in: .whitespacesAndNewlines)
        if let client, client.configuration.appId == appId, client.configuration.apiBaseURL == options.apiBaseURL {
            self.options = options
            optionsDidChange()
            return
        }
        client?.stop()
        client = nil
        unreadObservation = nil
        let configuration = HireShelbyClient.Configuration(
            appId: appId,
            apiBaseURL: options.apiBaseURL,
            logLevel: options.logLevel,
            logHandler: options.logHandler,
            updatesAppBadge: options.updatesAppBadge,
            usesRemoteAppearance: options.usesRemoteAppearance
        )
        let client: HireShelbyClient
        do {
            client = try HireShelbyClient(configuration: configuration)
        } catch {
            // never crash the host app over a typo; say so loudly instead
            print("[HireShelby] configure failed: \(error)")
            return
        }
        self.options = options
        self.client = client
        unreadObservation = client.observeUnreadCount { [weak self] count in self?.unreadCount = count }
        client.onEvent = { [weak self] event in self?.handle(event) }
        let queued = pending
        pending = []
        for apply in queued { apply(client) }
        client.start()
        platformDidConfigure()
        optionsDidChange()
    }

    /// Runs `body` now if configured, else when ``configure(appId:options:)`` runs.
    private func withClient(_ body: @escaping @MainActor (HireShelbyClient) -> Void) {
        if let client {
            body(client)
        } else {
            pending.append(body)
        }
    }

    private func handle(_ event: HireShelbyEvent) {
        switch event {
        case .chatOpened: isChatOpen = true
        case .chatClosed: isChatOpen = false
        default: break
        }
        onEvent?(event)
    }

    // MARK: Identity

    /// Tells the team who the user is. Call it after restoring a session and after sign-in, with what the app
    /// knows. Apps without accounts can pass just the name the user entered. A nil field keeps the earlier value.
    ///
    /// These labels are unverified; ``identify(token:)`` verifies them.
    public func identify(userId: String? = nil, name: String? = nil, email: String? = nil) {
        withClient { $0.identify(userId: userId, name: name, email: email) }
    }

    /// Verifies the user with an HS256 JWT from the app's backend, signed with the app's identity secret (claims
    /// `user_id` and `exp`; `name` and `email` optional). Call it after sign-in and on every launch. The token
    /// stays in memory. A rejected token is reported through ``onEvent`` as `.identityRejected`.
    public func identify(token: String) {
        withClient { $0.identify(token: token) }
    }

    /// Ends the session where a signed-in session really ends (sign-out, account switch), before the next user's
    /// ``identify(userId:name:email:)``. Never for guests. The next user gets their own conversation.
    public func logout() {
        withClient { $0.logout() }
    }

    /// Deletes the user's support data (identity, details, conversations, photos) on the server and the device.
    /// Await it on account deletion before discarding the app's session.
    /// - Throws: ``HireShelbyError``, e.g. ``HireShelbyError/Code/connectionFailed`` offline (try again).
    public func deleteData() async throws {
        guard let client else { throw HireShelbyError(code: .notConfigured, message: "Call HireShelby.configure(appId:) first") }
        try await client.deleteData()
    }

    /// Details the team sees next to the chat (plan, sign-up date…): up to 20 string values, keys up to 64 and
    /// values up to 512 characters. Each call replaces all of them, so set them in one place. Never health data,
    /// passwords, precise location or payment details; names and emails go through ``identify(userId:name:email:)``.
    public func setMetadata(_ metadata: [String: String]) {
        withClient { $0.setMetadata(metadata) }
    }

    // MARK: Push

    /// Forwards the APNs device token from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`, so
    /// replies reach the user as notifications. The SDK never asks for permission.
    public func setPushToken(_ token: Data, environment: HireShelbyPushEnvironment = .automatic) {
        withClient { $0.setPushToken(token, environment: environment) }
    }

    /// Stops notifications to this device.
    public func clearPushToken() {
        withClient { $0.clearPushToken() }
    }

    /// Handles a notification the user tapped (`userNotificationCenter(_:didReceive:)`): for Hire Shelby
    /// notifications, refreshes the chat and (by default) opens it. Returns false for other notifications.
    @discardableResult
    public func handleNotification(userInfo: [AnyHashable: Any], openChat: Bool = true) -> Bool {
        guard HireShelbyClient.isHireShelbyNotification(userInfo) else { return false }
        client?.handleNotification(userInfo: userInfo)
        // a tap can arrive just before the app becomes active; presenting waits for a window if needed
        if openChat, !isChatOpen { presentChatIfPossible() }
        return true
    }

    // MARK: Paywalls, StoreKit, automations

    /// Reports the paywalls the app can show right now (replacing the earlier list), so the team can send offers
    /// for them. Report again whenever the list changes; set ``onPaywall`` to present them.
    public func reportPaywalls(_ paywalls: [HireShelbyPaywall]) {
        withClient { $0.reportPaywalls(paywalls) }
    }

    /// Reports what StoreKit says: whether the person pays, and their subscriptions' original transaction IDs.
    public func reportStoreKit(paying: Bool?, originalTransactionIds: [String] = []) {
        withClient { $0.reportStoreKit(paying: paying, originalTransactionIds: originalTransactionIds) }
    }

    #if canImport(StoreKit)
    /// Reads StoreKit 2's current entitlements and reports them (see ``reportStoreKit(paying:originalTransactionIds:)``).
    public func reportStoreKitEntitlements() async {
        await client?.reportStoreKitEntitlements()
    }
    #endif

    /// Tracks an app event for automations (`paywall_declined`, `onboarding_completed`…). Only events an enabled
    /// automation listens for leave the device. With `opensChat`, the chat opens when an automation answers with
    /// a message within 5 seconds and asks for it.
    public func track(_ event: String, opensChat: Bool = false) {
        let startedAt = Date()
        withClient { [weak self] client in
            Task { @MainActor in
                let result = await client.track(event)
                // only within 5 seconds, while the app is in front, and not over an open chat
                guard opensChat, result.openChat, Date().timeIntervalSince(startedAt) <= 5 else { return }
                guard let self, self.isAppActive, !self.isChatOpen else { return }
                self.presentChatIfPossible()
            }
        }
    }

    // MARK: Unread

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

    /// Fetches the unread count now.
    public func refreshUnreadCount() async {
        await client?.refreshUnreadCount()
    }

    private func unreadCountDidChange(_ oldValue: Int) {
        guard unreadCount != oldValue else { return }
        for continuation in unreadContinuations.values { continuation.yield(unreadCount) }
        platformUnreadCountDidChange()
    }
}

#if canImport(Combine)
/// SwiftUI views can observe ``HireShelby/shared`` (`@ObservedObject`) for ``HireShelby/unreadCount`` and
/// ``HireShelby/isChatOpen``.
extension HireShelby: ObservableObject {}
#endif

#if !canImport(UIKit)
extension HireShelby {
    func platformDidConfigure() {}
    func optionsDidChange() {}
    func platformUnreadCountDidChange() {}
    func presentChatIfPossible() {}
}
#endif
