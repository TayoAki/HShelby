#if canImport(UIKit)
import os
import StoreKit
import SwiftUI
import UIKit
import UserNotifications

/// UIKit state the facade keeps on iOS.
struct PlatformState {
    var lifecycleObservers: [NSObjectProtocol] = []
    weak var presentedChat: UIViewController?
    /// presentChat() ran before a window existed (a cold start from a notification): present once active.
    var presentWhenActive = false
}

extension HireShelby {
    /// What a review card's button does.
    public enum ReviewPrompt: Sendable, Equatable {
        /// Shows Apple's in-app rating prompt (`AppStore.requestReview(in:)`), the API App Review guideline 5.6.1
        /// asks apps to use. The default. Apple decides whether it appears (at most three times a year per user),
        /// so a tap may show nothing.
        case inAppPrompt
        /// Opens the App Store's write-review page. Always works, and the user leaves the app for a moment. Apple
        /// allows a write-review link behind a button the user taps, but the card itself asks for a review, so
        /// choose this only if you're comfortable defending it in App Review.
        case appStorePage
    }

    // MARK: Presenting the chat

    /// Presents the chat as a sheet over the app's top view controller (with its own navigation bar and close
    /// button). Does nothing while the chat is already open. During a cold start it waits until the app is active.
    public func presentChat() {
        guard client != nil else {
            logError("presentChat() before HireShelby.configure(appId:)")
            return
        }
        guard !isChatOpen, platform.presentedChat?.presentingViewController == nil else { return }
        guard let top = topViewController(), top.view.window != nil else {
            platform.presentWhenActive = true
            return
        }
        presentChat(from: top)
    }

    /// Presents the chat from a specific view controller (UIKit apps).
    public func presentChat(from viewController: UIViewController, animated: Bool = true) {
        guard platform.presentedChat?.presentingViewController == nil else { return }
        let host = UIHostingController(rootView: HireShelbyChatView())
        host.modalPresentationStyle = .pageSheet
        platform.presentedChat = host
        viewController.present(host, animated: animated)
    }

    /// Dismisses a chat presented with ``presentChat()``.
    public func dismissChat(animated: Bool = true) {
        platform.presentedChat?.dismiss(animated: animated)
        platform.presentedChat = nil
    }

    /// The view controller at the top of the app's key window: present paywalls from here so they show above
    /// the chat.
    public func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.filter { $0.activationState == .foregroundActive }
        let windows = (active.isEmpty ? scenes : active).flatMap(\.windows)
        let window = windows.first(where: \.isKeyWindow) ?? windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }

    func presentChatIfPossible() {
        presentChat()
    }

    // MARK: Push

    /// For `userNotificationCenter(_:willPresent:withCompletionHandler:)`: nil for notifications that aren't Hire
    /// Shelby's; otherwise how to show it (nothing while the chat is open, since the message appears there).
    /// Keep your notification delegate on the main actor.
    public func notificationPresentationOptions(userInfo: [AnyHashable: Any]) -> UNNotificationPresentationOptions? {
        guard handleNotification(userInfo: userInfo, openChat: false) else { return nil }
        return isChatOpen ? [] : [.banner, .list, .sound, .badge]
    }

    /// For `userNotificationCenter(_:didReceive:withCompletionHandler:)`: opens the chat for Hire Shelby
    /// notifications. Returns false for others.
    @discardableResult
    public func handleNotificationResponse(_ response: UNNotificationResponse) -> Bool {
        handleNotification(userInfo: response.notification.request.content.userInfo)
    }

    /// Registers for remote notifications if the user already allowed them (authorized or provisional). Never asks
    /// for permission. Call at launch and after the app's own permission flow; forward the token with
    /// ``setPushToken(_:environment:)``.
    public func registerForPushIfAuthorized() async {
        let status = await withCheckedContinuation { (continuation: CheckedContinuation<UNAuthorizationStatus, Never>) in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
        var allowed = status == .authorized || status == .provisional
        #if os(iOS) && !targetEnvironment(macCatalyst)
        allowed = allowed || status == .ephemeral
        #endif
        if allowed { UIApplication.shared.registerForRemoteNotifications() }
    }

    // MARK: Cards

    /// Runs a card tap's action: the App Store review page or prompt, or the app's paywall.
    func perform(_ action: HireShelbyConversation.CardAction) {
        switch action {
        case .openReview(let url):
            if options.reviewPrompt == .inAppPrompt, let scene = topViewController()?.view.window?.windowScene {
                AppStore.requestReview(in: scene)
            } else {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
        case .presentPaywall(let id):
            if let onPaywall {
                onPaywall(id)
            } else {
                logError("An offer card was tapped but HireShelby.shared.onPaywall isn't set")
            }
        case .unavailable:
            break
        }
    }

    // MARK: Lifecycle and badge

    func platformDidConfigure() {
        if platform.lifecycleObservers.isEmpty {
            let center = NotificationCenter.default
            platform.lifecycleObservers = [
                center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
                    Task { @MainActor in HireShelby.shared.applicationDidBecomeActive() }
                },
                center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
                    Task { @MainActor in HireShelby.shared.applicationDidEnterBackground() }
                },
            ]
        }
        isAppActive = UIApplication.shared.applicationState != .background
        if !isAppActive { client?.applicationDidEnterBackground() }
    }

    private func applicationDidBecomeActive() {
        isAppActive = true
        client?.applicationDidBecomeActive()
        if platform.presentWhenActive {
            platform.presentWhenActive = false
            presentChat()
        }
    }

    private func applicationDidEnterBackground() {
        isAppActive = false
        client?.applicationDidEnterBackground()
    }

    func optionsDidChange() {
        client?.reportLocalAppearance(options.theme.localAppearance)
    }

    /// Keeps the app icon's badge at the unread count; at zero, also removes Hire Shelby notifications from
    /// Notification Center.
    func platformUnreadCountDidChange() {
        guard options.updatesAppBadge, client != nil else { return }
        let count = unreadCount
        let center = UNUserNotificationCenter.current()
        center.setBadgeCount(count, withCompletionHandler: nil)
        guard count == 0 else { return }
        center.getDeliveredNotifications { notifications in
            let ids = notifications
                .filter { HireShelbyClient.isHireShelbyNotification($0.request.content.userInfo) }
                .map(\.request.identifier)
            if !ids.isEmpty {
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
            }
        }
    }

    func logError(_ message: String) {
        guard options.logLevel != .off else { return }
        if let handler = options.logHandler {
            handler(.error, message)
        } else {
            Logger(subsystem: "com.hireshelby.sdk", category: "HireShelby").error("\(message, privacy: .public)")
        }
    }
}
#endif
