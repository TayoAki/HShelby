# Changelog

All notable changes to the Hire Shelby iOS SDK. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- AI replies ask first (App Review guideline 5.1.2(i)): the chat shows who would receive the person's messages and
  the AI answers only people who allow it; a menu switch turns it off. `HireShelby.shared.aiReplies` and
  `setAIRepliesAllowed(_:)` for the app's own settings.
- `setPromotionalPushAllowed(_:)`: offers and automations' messages push only with the person's opt-in to
  promotional notifications (guideline 4.5.4).
- Review cards use Apple's rating prompt by default (`reviewPrompt: .inAppPrompt`, guideline 5.6.1).
- `HireShelby.configure(appId:options:)` with the API base URL, theme, logging, app badge and remote design options.
- Identity: `identify(userId:name:email:)`, verified identity with `identify(token:)`, `logout()`, `deleteData()`,
  `setMetadata(_:)`; a different user on the device starts a new session.
- SwiftUI chat (`HireShelby.ChatView`) and `presentChat()` / `presentChat(from:)`: paging, optimistic sending with a
  persisted outbox, photos (up to 4, converted on the device), typing both ways, read receipts, team names and
  avatars, the "AI" label, review and offer cards, offline and sending-restriction notices, Dynamic Type, dark mode,
  VoiceOver labels, English strings ready for localization.
- Live updates over `/v1/live` with reconnects, resync and polling fallback; unread count polling while the chat is
  closed; `unreadCount` as `@Published`, `AsyncStream` and callback.
- Push: `setPushToken(_:environment:)` with automatic APNs environment, `clearPushToken()`,
  `handleNotification(userInfo:)`, `notificationPresentationOptions(userInfo:)`, `registerForPushIfAuthorized()`,
  app badge updates.
- Paywall reports and `onPaywall`, review requests (App Store page or in-app prompt), `track(_:opensChat:)` for
  automations, StoreKit reporting (`reportStoreKit`, `reportStoreKitEntitlements()`).
- The team's published chat design, applied when the chat opens; the app's own theme reported to the dashboard.
- Privacy manifest (`PrivacyInfo.xcprivacy`).
