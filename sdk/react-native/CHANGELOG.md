# Changelog

All notable changes to `@hireshelby/react-native`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- The Hire Shelby iOS SDK 0.1.0 for React Native and Expo (iOS): `configure`, `identify` (labels or a verified
  token), `logout`, `deleteData`, `setMetadata`, `presentChat`/`dismissChat`, unread count (`useUnreadCount`),
  events, paywall handler, push (`setPushToken`, `handleNotification`, `shouldShowNotification` for
  expo-notifications), `setPromotionalPushAllowed`, paywalls and StoreKit reports, `track`, AI replies
  (`getAIReplies`, `setAIRepliesAllowed`).
- Safe everywhere: on Android, the web and Expo Go calls do nothing and `isSupported` is false.
