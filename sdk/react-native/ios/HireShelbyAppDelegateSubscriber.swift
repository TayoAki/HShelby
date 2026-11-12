import ExpoModulesCore
import UIKit

/// Gets the APNs device token to Hire Shelby without any code in the app: Expo forwards the app delegate's
/// callbacks here. The token goes to the SDK once `configure` has run (unless `automaticPushToken` is off).
public final class HireShelbyAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    PushTokenRelay.received(deviceToken)
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    // permission may have been granted since launch (the app asks for it, never the SDK)
    PushTokenRelay.registerIfAuthorized()
  }
}

/// Holds the token until `configure` says whether to forward it.
@MainActor
enum PushTokenRelay {
  private static var token: Data?
  private static var configured = false
  private static var enabled = true

  static func received(_ deviceToken: Data) {
    token = deviceToken
    if configured, enabled { HireShelby.shared.setPushToken(deviceToken) }
  }

  static func didConfigure(enabled: Bool) {
    configured = true
    self.enabled = enabled
    guard enabled else { return }
    if let token { HireShelby.shared.setPushToken(token) }
    registerIfAuthorized()
  }

  /// Asks iOS for the token when the app already has notification permission; iOS answers through the app
  /// delegate (`received`). Never asks for permission.
  static func registerIfAuthorized() {
    guard configured, enabled, token == nil else { return }
    Task { @MainActor in await HireShelby.shared.registerForPushIfAuthorized() }
  }
}
