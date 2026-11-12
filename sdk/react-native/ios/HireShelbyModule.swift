import ExpoModulesCore
import SwiftUI
import UIKit

/// The JavaScript side of `@hireshelby/react-native`: each function hands over to `HireShelby.shared`, the iOS
/// SDK compiled into this module. Calls run on the main actor, where the SDK lives.
public final class HireShelbyModule: Module {
  private var unreadTask: Task<Void, Never>?
  private var dismissesChatForPaywall = true

  public func definition() -> ModuleDefinition {
    Name("HireShelby")

    Events("onUnreadCountChange", "onEvent", "onPaywall")

    Constant("sdkVersion") {
      HireShelbyVersion.current
    }

    OnCreate {
      Task { @MainActor [weak self] in self?.attach() }
    }

    OnDestroy {
      unreadTask?.cancel()
    }

    // MARK: Setup

    AsyncFunction("configure") { (appId: String, options: OptionsRecord) in
      MainActor.assumeIsolated {
        self.dismissesChatForPaywall = options.dismissesChatForPaywall
        HireShelby.configure(appId: appId, options: options.sdkOptions)
        PushTokenRelay.didConfigure(enabled: options.automaticPushToken)
      }
    }.runOnQueue(.main)

    // MARK: Identity

    AsyncFunction("identify") { (userId: String?, name: String?, email: String?) in
      MainActor.assumeIsolated { HireShelby.shared.identify(userId: userId, name: name, email: email) }
    }.runOnQueue(.main)

    AsyncFunction("identifyWithToken") { (token: String) in
      MainActor.assumeIsolated { HireShelby.shared.identify(token: token) }
    }.runOnQueue(.main)

    AsyncFunction("logout") {
      MainActor.assumeIsolated { HireShelby.shared.logout() }
    }.runOnQueue(.main)

    AsyncFunction("deleteData") { () async throws in
      try await Self.deleteData()
    }

    AsyncFunction("setMetadata") { (metadata: [String: String]) in
      MainActor.assumeIsolated { HireShelby.shared.setMetadata(metadata) }
    }.runOnQueue(.main)

    // MARK: Chat

    AsyncFunction("presentChat") {
      MainActor.assumeIsolated { HireShelby.shared.presentChat() }
    }.runOnQueue(.main)

    AsyncFunction("dismissChat") {
      MainActor.assumeIsolated { HireShelby.shared.dismissChat() }
    }.runOnQueue(.main)

    AsyncFunction("getUnreadCount") { () async -> Int in
      await Self.refreshedUnreadCount()
    }

    // MARK: Push

    AsyncFunction("setPushToken") { (hex: String, environment: String) in
      try MainActor.assumeIsolated {
        guard let token = Self.data(fromHex: hex) else { throw InvalidPushTokenException() }
        HireShelby.shared.setPushToken(token, environment: HireShelbyPushEnvironment(rawValue: environment) ?? .automatic)
      }
    }.runOnQueue(.main)

    AsyncFunction("clearPushToken") {
      MainActor.assumeIsolated { HireShelby.shared.clearPushToken() }
    }.runOnQueue(.main)

    AsyncFunction("setPromotionalPushAllowed") { (allowed: Bool) in
      MainActor.assumeIsolated { HireShelby.shared.setPromotionalPushAllowed(allowed) }
    }.runOnQueue(.main)

    AsyncFunction("handleNotification") { (payload: [String: Any], openChat: Bool) -> Bool in
      let userInfo = payload as [AnyHashable: Any]
      return MainActor.assumeIsolated {
        HireShelby.shared.handleNotification(userInfo: userInfo, openChat: openChat)
      }
    }.runOnQueue(.main)

    // MARK: Paywalls, StoreKit, automations

    AsyncFunction("reportPaywalls") { (paywalls: [PaywallRecord]) in
      MainActor.assumeIsolated { HireShelby.shared.reportPaywalls(paywalls.map(\.paywall)) }
    }.runOnQueue(.main)

    AsyncFunction("reportStoreKit") { (paying: Bool?, originalTransactionIds: [String]) in
      MainActor.assumeIsolated {
        HireShelby.shared.reportStoreKit(paying: paying, originalTransactionIds: originalTransactionIds)
      }
    }.runOnQueue(.main)

    AsyncFunction("reportStoreKitEntitlements") { () async in
      await Self.reportStoreKitEntitlements()
    }

    AsyncFunction("track") { (event: String, opensChat: Bool) in
      MainActor.assumeIsolated { HireShelby.shared.track(event, opensChat: opensChat) }
    }.runOnQueue(.main)

    // MARK: AI replies

    AsyncFunction("getAIReplies") { () -> AIRepliesRecord in
      AIRepliesRecord(MainActor.assumeIsolated { HireShelby.shared.aiReplies })
    }.runOnQueue(.main)

    AsyncFunction("setAIRepliesAllowed") { (allowed: Bool) async throws in
      try await Self.setAIRepliesAllowed(allowed)
    }
  }

  // MARK: Wiring

  /// Forwards the SDK's unread count, events and paywall taps to JavaScript.
  @MainActor
  private func attach() {
    let sdk = HireShelby.shared
    unreadTask?.cancel()
    unreadTask = Task { @MainActor [weak self] in
      for await count in sdk.unreadCountUpdates {
        self?.sendEvent("onUnreadCountChange", ["count": count])
      }
    }
    sdk.onEvent = { [weak self] event in
      self?.sendEvent("onEvent", Self.payload(for: event))
    }
    sdk.onPaywall = { [weak self] paywallId in
      guard let self else { return }
      // React Native screens sit under the chat's sheet: close it first so the paywall shows
      if self.dismissesChatForPaywall {
        sdk.dismissChat(animated: true) { [weak self] in self?.sendEvent("onPaywall", ["paywallId": paywallId]) }
      } else {
        self.sendEvent("onPaywall", ["paywallId": paywallId])
      }
    }
  }

  @MainActor
  private static func deleteData() async throws {
    do {
      try await HireShelby.shared.deleteData()
    } catch let error as HireShelbyError {
      throw HireShelbyException(error)
    }
  }

  @MainActor
  private static func setAIRepliesAllowed(_ allowed: Bool) async throws {
    do {
      try await HireShelby.shared.setAIRepliesAllowed(allowed)
    } catch let error as HireShelbyError {
      throw HireShelbyException(error)
    }
  }

  @MainActor
  private static func refreshedUnreadCount() async -> Int {
    await HireShelby.shared.refreshUnreadCount()
    return HireShelby.shared.unreadCount
  }

  @MainActor
  private static func reportStoreKitEntitlements() async {
    await HireShelby.shared.reportStoreKitEntitlements()
  }

  static func payload(for event: HireShelbyEvent) -> [String: Any?] {
    switch event {
    case .chatOpened: return ["type": "chatOpened"]
    case .chatClosed: return ["type": "chatClosed"]
    case .messageSent: return ["type": "messageSent"]
    case .reviewOpened: return ["type": "reviewOpened"]
    case .paywallOpened(let paywallId): return ["type": "paywallOpened", "paywallId": paywallId]
    case .dataDeleted: return ["type": "dataDeleted"]
    case .identityRejected(let error): return ["type": "identityRejected", "code": error.code.rawValue, "message": error.message]
    case .aiRepliesChanged(let allowed): return ["type": "aiRepliesChanged", "allowed": allowed]
    }
  }

  /// An APNs token as hex (what expo-notifications' `getDevicePushTokenAsync()` returns on iOS).
  static func data(fromHex hex: String) -> Data? {
    let digits = Array(hex.utf8)
    guard digits.count.isMultiple(of: 2), (64...400).contains(digits.count) else { return nil }
    var data = Data(capacity: digits.count / 2)
    var index = 0
    while index < digits.count {
      guard let byte = UInt8(String(decoding: digits[index..<index + 2], as: UTF8.self), radix: 16) else { return nil }
      data.append(byte)
      index += 2
    }
    return data
  }
}

// MARK: - Arguments

struct OptionsRecord: Record {
  @Field var apiBaseUrl: String?
  @Field var theme: ThemeRecord?
  /// "off", "error", "info" or "debug".
  @Field var logLevel: String?
  @Field var updatesAppBadge: Bool = true
  @Field var usesRemoteAppearance: Bool = true
  /// "inApp" (Apple's rating prompt) or "appStorePage".
  @Field var reviewPrompt: String?
  @Field var dismissesChatForPaywall: Bool = true
  /// Forward the APNs token to Hire Shelby without app code (see HireShelbyAppDelegateSubscriber).
  @Field var automaticPushToken: Bool = true

  var sdkOptions: HireShelby.Options {
    let levels: [String: HireShelbyLogLevel] = ["off": .off, "error": .error, "info": .info, "debug": .debug]
    return HireShelby.Options(
      apiBaseURL: apiBaseUrl.flatMap(URL.init(string:)) ?? HireShelbyClient.defaultAPIBaseURL,
      theme: theme?.sdkTheme ?? HireShelby.Theme(),
      logLevel: logLevel.flatMap { levels[$0] } ?? .error,
      updatesAppBadge: updatesAppBadge,
      usesRemoteAppearance: usesRemoteAppearance,
      reviewPrompt: reviewPrompt == "appStorePage" ? .appStorePage : .inAppPrompt
    )
  }
}

struct ThemeRecord: Record {
  @Field var accentColor: UIColor?
  @Field var onAccentColor: UIColor?
  @Field var backgroundColor: UIColor?
  @Field var incomingBubbleColor: UIColor?
  @Field var incomingTextColor: UIColor?
  @Field var fontName: String?
  /// "light" or "dark"; unset follows the app.
  @Field var colorScheme: String?
  @Field var title: String?
  @Field var welcomeTitle: String?
  @Field var welcomeText: String?
  /// An SF Symbol name; an empty string hides the icon.
  @Field var welcomeIcon: String?
  @Field var showsCloseButton: Bool = true

  var sdkTheme: HireShelby.Theme {
    HireShelby.Theme(
      accentColor: accentColor.map(Color.init(uiColor:)),
      onAccentColor: onAccentColor.map(Color.init(uiColor:)),
      backgroundColor: backgroundColor.map(Color.init(uiColor:)),
      incomingBubbleColor: incomingBubbleColor.map(Color.init(uiColor:)),
      incomingTextColor: incomingTextColor.map(Color.init(uiColor:)),
      fontName: fontName,
      colorScheme: colorScheme == "dark" ? .dark : colorScheme == "light" ? .light : nil,
      title: title,
      welcomeTitle: welcomeTitle,
      welcomeText: welcomeText,
      welcomeIcon: welcomeIcon.map { $0.isEmpty ? .hidden : .systemImage($0) } ?? .systemImage("bubble.left.and.bubble.right.fill"),
      showsCloseButton: showsCloseButton
    )
  }
}

struct AIRepliesRecord: Record {
  @Field var isEnabled: Bool = false
  /// "granted", "declined" or null.
  @Field var consent: String?
  @Field var processors: [String] = []
  @Field var isAllowed: Bool = false
  @Field var needsConsent: Bool = false

  init() {}

  init(_ ai: HireShelbyConversation.AIReplies) {
    isEnabled = ai.isEnabled
    consent = ai.consent?.rawValue
    processors = ai.processors
    isAllowed = ai.isAllowed
    needsConsent = ai.needsConsent
  }
}

struct PaywallProductRecord: Record {
  @Field var id: String = ""
  @Field var price: String?
  @Field var period: String?
  @Field var trial: String?
}

struct PaywallRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  /// "revenuecat", "superwall", "adapty" or "app".
  @Field var source: String?
  @Field var isPresentable: Bool = true
  @Field var products: [PaywallProductRecord] = []

  var paywall: HireShelbyPaywall {
    HireShelbyPaywall(
      id: id,
      title: title,
      source: source.flatMap(HireShelbyPaywall.Source.init(rawValue:)) ?? .app,
      isPresentable: isPresentable,
      products: products.map { HireShelbyPaywall.Product(id: $0.id, price: $0.price, period: $0.period, trial: $0.trial) }
    )
  }
}

// MARK: - Errors

/// An SDK error, with its code (`ERR_HIRESHELBY_CONNECTION_FAILED`…) for JavaScript.
final class HireShelbyException: Exception, @unchecked Sendable {
  let error: HireShelbyError

  init(_ error: HireShelbyError) {
    self.error = error
    super.init()
  }

  override var code: String {
    "ERR_HIRESHELBY_" + error.code.rawValue.uppercased()
  }

  override var reason: String {
    error.message
  }
}

final class InvalidPushTokenException: Exception, @unchecked Sendable {
  override var code: String { "ERR_HIRESHELBY_INVALID_PUSH_TOKEN" }
  override var reason: String {
    "setPushToken needs the APNs device token in hex, as expo-notifications' getDevicePushTokenAsync() returns it on iOS"
  }
}
