# Hire Shelby iOS SDK

Hire Shelby is an in-app support chat for iOS apps. Your users write from inside the app; your team answers from
the Hire Shelby dashboard, Telegram, or the AI. This package is the native SDK: a SwiftUI chat, the session with
the Hire Shelby API, push, offers and review requests.

- iOS 16+, Swift 6 (strict concurrency), no third-party dependencies
- `HireShelby`: the product you add (chat UI, presentation, push helpers), re-exports `HireShelbyCore`
- `HireShelbyCore`: the Foundation-only engine (API client, session, conversation, outbox, live updates)

## Install

The package is published from this folder to its own repository,
`https://github.com/tayoaki/hireshelby-ios`.

In Xcode: **File → Add Package Dependencies…**, enter the URL, choose **Up to Next Major Version** from `0.1.0`
and add the **HireShelby** library to your app target. In a `Package.swift`:

```swift
.package(url: "https://github.com/tayoaki/hireshelby-ios", from: "0.1.0"),
// …
.target(name: "MyApp", dependencies: [.product(name: "HireShelby", package: "hireshelby-ios")]),
```

The session is kept in the Keychain, so run signed builds (the simulator included).

## Quickstart

These are the same steps as the setup prompt the dashboard gives your coding agent.

### 1. Configure once at launch

Use the App ID from the dashboard and match the chat to your app's own theme (never invent colors):

```swift
import HireShelby
import SwiftUI

@main
struct MyApp: App {
    init() {
        // Hire Shelby support chat
        HireShelby.configure(
            appId: "app_XXXXXXXXXXXXXXXXXXXXXX",
            options: .init(theme: .init(
                accentColor: Color("AccentColor"),
                backgroundColor: Color("Background"),
                fontName: "Avenir-Book"
            ))
        )
    }

    var body: some Scene { WindowGroup { ContentView() } }
}
```

UIKit apps call `HireShelby.configure(appId:options:)` in `application(_:didFinishLaunchingWithOptions:)`.
`options.apiBaseURL` defaults to `https://api.hireshelby.com`.

### 2. Add the support entry

There is no floating button: put Support where your app's users look for help (a row in Settings, an entry on
the home screen) by copying one of your own controls, with the unread count as a badge:

```swift
struct SupportRow: View {
    @ObservedObject private var support = HireShelby.shared

    var body: some View {
        Button { support.presentChat() } label: {
            HStack {
                Label("Support", systemImage: "bubble.left.and.bubble.right")
                Spacer()
                if support.unreadCount > 0 {
                    Text("\(support.unreadCount)")
                        .font(.caption.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(.red))
                }
            }
        }
    }
}
```

- `HireShelby.shared.presentChat()` presents the chat as a sheet (no-op if it's open). UIKit:
  `presentChat(from: viewController)`, `dismissChat()`.
- SwiftUI can host it: `.sheet(isPresented: $showsSupport) { HireShelby.ChatView() }`, or push it onto your own
  `NavigationStack` with `HireShelby.ChatView(includesNavigationStack: false)`.
- The unread count is also an `AsyncStream` (`for await count in HireShelby.shared.unreadCountUpdates`) and, for
  UIKit, a callback: `let token = HireShelby.shared.client?.observeUnreadCount { badge.text = "\($0)" }`
  (keep `token`).

### 3. Connect what the app already has

```swift
// After restoring a session and after sign-in, with what the app knows (nil keeps the earlier value):
HireShelby.shared.identify(userId: user.id, name: user.name, email: user.email)

// Apps without accounts: just the name the user entered, if any.
HireShelby.shared.identify(name: enteredName)

// Details the team sees next to the chat: up to 20 string values, each call replaces all of them.
// Never health data, passwords, precise location or payment details; names and emails go through identify.
HireShelby.shared.setMetadata(["plan": "Pro", "signed_up": "2026-03-01"])

// Only where a signed-in session really ends (sign-out, account switch), before the next user's identify.
// Never for guests. The next user gets their own conversation; the old one stays in your inbox.
HireShelby.shared.logout()

// Account deletion: await it before discarding your session.
try await HireShelby.shared.deleteData()
```

A different `userId` than the device's starts a new session for that user by itself (one person's history never
shows up for another), but call `logout()` at sign-out anyway.

### 4. Push notifications

Upload your APNs key in the dashboard (the app's Push settings). The SDK never asks for permission; forward the
token if the app already has it:

```swift
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { await HireShelby.shared.registerForPushIfAuthorized() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        HireShelby.shared.setPushToken(deviceToken) // environment: .automatic reads the provisioning profile
    }

    // Keep these on the main actor.
    @MainActor
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        HireShelby.shared.notificationPresentationOptions(userInfo: notification.request.content.userInfo) ?? [.banner, .sound]
    }

    @MainActor
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if HireShelby.shared.handleNotificationResponse(response) { return } // opened the chat
        // …your own notifications
    }
}
```

Hire Shelby notifications carry `userInfo["hireshelby"] = {conversationId, messageId}`.
`handleNotification(userInfo:openChat:)` is the lower-level call. By default the SDK keeps the app icon's badge at
the unread count (pushes carry it); set `options.updatesAppBadge = false` if your app owns its badge.
`clearPushToken()` stops pushes to the device.

### 5. Build and check

Run the app on a simulator, open Support and send a message: it appears in the dashboard inbox. Reply there and
the badge on your Support entry updates.

### 6. Identity verification (optional)

Labels from `identify(userId:name:email:)` are unverified: anyone with your public App ID could send them. With a
real sign-in and a backend, verify users:

1. In the dashboard, reveal the app's identity secret (the app's Settings, Identity verification) and store it on
   your server as `HIRESHELBY_IDENTITY_SECRET`. Never put it in the app.
2. Add an authenticated endpoint that returns an HS256 JWT signed with that secret, used verbatim including its
   `ids_` prefix. Claims: `user_id` (required, from the session, never from the request), `exp` (required; 7 days),
   `name` and `email` (optional).

   ```js
   // Node, with jose
   const token = await new SignJWT({ user_id: user.id, name: user.name, email: user.email })
     .setProtectedHeader({ alg: "HS256" })
     .setExpirationTime("7d")
     .sign(new TextEncoder().encode(process.env.HIRESHELBY_IDENTITY_SECRET));
   ```
3. Pass it after sign-in and on every launch (it's kept in memory only):

   ```swift
   HireShelby.shared.identify(token: try await api.fetchSupportToken())
   ```

A rejected token (`identity_token_invalid`, `identity_token_expired`) arrives as
`HireShelby.shared.onEvent = { if case .identityRejected(let error) = $0 { … } }`; fetch a fresh one. With "Only
verified users can chat" on, unverified users can read but the composer says "Sign in to send messages."

## Theming

`HireShelby.Theme` takes the app's own values; the team's published design from the dashboard ("Chat design")
wins property by property, and the SDK's defaults follow the system (Dynamic Type, dark mode):

| Theme | Default |
|---|---|
| `accentColor` (buttons, your bubbles) | the app's accent color |
| `onAccentColor` | white |
| `backgroundColor` | system background |
| `incomingBubbleColor`, `incomingTextColor` | secondary system background, label |
| `fontName` (a PostScript name the app registers; scales with Dynamic Type) or `fontDesign` | system font |
| `colorScheme` | follows the app |
| `title`, `welcomeTitle`, `welcomeText`, `welcomeIcon`, `showsCloseButton` | "Support", "How can we help?", … |

The SDK reports these values (colors as hex, never images) so the dashboard's design editor starts from your app's
design. A newly published design applies the next time the chat opens. Turn remote design off with
`options.usesRemoteAppearance = false`.

Strings are in `Sources/HireShelby/Resources/en.lproj/Localizable.strings`; messages and the team's button labels
are shown as written.

## Offers, review requests and automations

**Offers** open your paywalls. Report the paywalls the app can show (the team can only offer these) and present the
one a card names:

```swift
HireShelby.shared.reportPaywalls([
    HireShelbyPaywall(id: "pro_yearly", title: "Pro yearly", source: .revenueCat,
                      products: [.init(id: "pro.yearly", price: "$29.99", period: "P1Y", trial: "P1W")]),
])
HireShelby.shared.onPaywall = { paywallId in
    // present above the chat
    HireShelby.shared.topViewController()?.present(PaywallViewController(id: paywallId), animated: true)
}
```

IDs are 1–64 of `A–Z a–z 0–9 _ . -`, titles 1–60 characters (only the team sees them), at most 20 paywalls.
An offer for a paywall the app no longer reports shows "No longer available".

**Review requests** open the App Store's write-review page (`options.reviewPrompt = .appStorePage`, the default) or
Apple's in-app prompt (`.inAppPrompt`, which Apple may not show). Set the app's App Store ID in the dashboard;
without it, review cards show their text only. Taps are reported to the team once.

**Automations** start from events the app tracks. Only events an enabled automation listens for leave the device:

```swift
HireShelby.shared.track("paywall_declined", opensChat: true)
```

## StoreKit

Automations and the team see whether the person pays. Report StoreKit's state at launch and after purchases:

```swift
await HireShelby.shared.reportStoreKitEntitlements() // StoreKit 2: active subscriptions, non-consumables
// or from your own purchase layer:
HireShelby.shared.reportStoreKit(paying: true, originalTransactionIds: ["2000000123456789"])
```

Original transaction IDs match App Store Server Notifications (set up in the dashboard) to the person.

## Custom UI and headless use

`HireShelby.shared.client` is the engine (`HireShelbyClient`) and `client.conversation` the observable conversation
(`HireShelbyConversation`): messages with paging (`loadOlder()`), `send(text:photos:)`, `retry`/`discard`, typing,
card actions, connection state. `HireShelbyPhotoProcessing.photo(from:)` turns picked image data into an uploadable
JPEG (≤2048 px, ≤1 MB, orientation applied, metadata dropped).

## How it behaves

- **Session:** the install registers once (random per-install device record; never IDFA or IDFV). The device secret
  and access token live in the Keychain (`AfterFirstUnlockThisDeviceOnly`); a reinstall starts a new device. Tokens
  refresh before they expire; a 401 refreshes once, and a device that's gone (deleted in the dashboard) registers
  again.
- **Sending:** messages show at once and go through a persisted outbox in order, each with a client-generated
  `clientId`, so a retry never duplicates. Transient failures (offline, 429 `Retry-After`, 5xx) retry with
  exponential backoff and jitter; validation errors don't.
- **Live:** while the chat is on screen and the app is active, a WebSocket brings new messages, read receipts and
  typing both ways; it reconnects with backoff and catches up after every reconnect, and the chat polls while it's
  down. With the chat closed, the unread count is checked every 30 s while the app is active (every 5 minutes with
  a push token).
- **Photos:** up to 4 per message, converted on the device, uploaded straight to storage with a SHA-256-signed URL.

## Privacy

What the SDK sends, all linked to the user, none used for tracking, all for app functionality:

| Data | When |
|---|---|
| Name, email address, user ID | `identify` (labels or a verified token's claims) |
| Device ID | always: the SDK's own random registration, plus the APNs token if forwarded |
| Customer support | messages |
| Photos | photos the user attaches |
| Purchase history | StoreKit paying state and original transaction IDs, when the app reports them |
| Product interaction | tracked events, card taps |
| Other data | device model, OS, app and SDK versions, locale, time zone |
| Your metadata | whatever `setMetadata` sends: declare the matching types |

The package ships `PrivacyInfo.xcprivacy` declaring these, `NSPrivacyTracking` false and no tracking domains. It
uses no required-reason APIs (no UserDefaults: state lives in the Keychain and in files in Application Support,
excluded from backups).

**App Store privacy answers:** for each type above that your integration uses, answer *collected*, *linked to the
user's identity*, *not used for tracking*, purpose *App Functionality*. Add *Developer's Advertising or Marketing*
for Product Interaction and Purchase History if you send offers. Logs (`options.logLevel`, OSLog subsystem
`com.hireshelby.sdk`) never contain secrets, tokens, message text, identity or metadata values.

## Development

```sh
swift build && swift test   # the core builds and tests on macOS and Linux
xcodebuild -scheme HireShelby -destination 'generic/platform=iOS Simulator' build   # the chat UI
```

The integration test runs against a real API when both variables are set (it creates a device and a
conversation in that app's inbox):

```sh
HIRESHELBY_TEST_API_URL=https://api.example.com HIRESHELBY_TEST_APP_ID=app_… swift test --filter IntegrationTests
```

CI: `.github/workflows/ios-sdk.yml` in the main repository.

## License

To be decided; see [LICENSE](LICENSE).
