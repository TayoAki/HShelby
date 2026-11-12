# Hire Shelby for React Native

In-app support chat for React Native and Expo apps on iOS. Your users write from inside the app; your team answers
from the Hire Shelby dashboard, Telegram, or the AI. The chat on screen is the native iOS SDK's, so it looks and
behaves like the rest of iOS.

- iOS 16.4+ (Expo SDK 55 or later, or bare React Native with Expo Modules), no other dependencies
- Android, the web and Expo Go: safe to call, does nothing (`HireShelby.isSupported` is false)

## Install

**Expo:**

```sh
npx expo install @hireshelby/react-native
npx expo run:ios        # or an EAS build: the chat is native code, so Expo Go can't run it
```

**Bare React Native:** if your app doesn't use Expo Modules yet, run `npx install-expo-modules@latest` once, then:

```sh
npm install @hireshelby/react-native
npx pod-install
```

No config plugin, Info.plist keys or permissions are needed: the chat picks photos with the system picker, which
needs no permission, and never asks for notification permission.

## Quickstart

These are the same steps as the setup prompt the dashboard gives your coding agent.

### 1. Configure once at startup

In your entry file (outside any component), with the App ID from the dashboard. Match the chat to your app's own
theme; never invent colors:

```ts
import { HireShelby } from "@hireshelby/react-native";

HireShelby.configure("app_XXXXXXXXXXXXXXXXXXXXXX", {
  theme: { accentColor: "#FF5A1F", backgroundColor: "#FFFFFF", fontName: "Avenir-Book" },
});
```

### 2. Add the support entry

Copy an existing control on that screen. Show the unread count as a badge; hide it at zero:

```tsx
import { HireShelby, useUnreadCount } from "@hireshelby/react-native";

function SupportButton() {
  const unread = useUnreadCount();
  return (
    <Pressable onPress={() => HireShelby.presentChat()}>
      <Text>Support</Text>
      {unread > 0 && <Badge count={unread} />}
    </Pressable>
  );
}
```

### 3. Connect what the app already has

```ts
// after restoring a session and after sign-in, with what the app knows
HireShelby.identify({ userId: user.id, name: user.name, email: user.email });

// where a signed-in session really ends (sign-out, account switch); never for guests
HireShelby.logout();

// account deletion: await it before discarding the session
await HireShelby.deleteData();

// what the team sees next to the chat: up to 20 strings, each call replacing the last
HireShelby.setMetadata({ plan: "pro", signedUp: "2026-03-01" });
```

Never send health data, passwords, precise location or payment details.

### 4. Push notifications

Upload your APNs key in the dashboard (the app's Push settings), or have your app builder do it. The rest is
automatic: whenever your app has notification permission, the SDK sends the device token to Hire Shelby itself.
It never asks for permission; your app does, when it fits (with expo-notifications:
`Notifications.requestPermissionsAsync()`).

To open the chat when someone taps a reply's notification, and to skip the banner while the chat already shows the
message, with expo-notifications:

```ts
import * as Notifications from "expo-notifications";

Notifications.addNotificationResponseReceivedListener((response) => {
  void HireShelby.handleNotification(response); // false for your own notifications
});

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = HireShelby.shouldShowNotification(notification);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});
```

To send the token yourself instead, configure with `automaticPushToken: false` and call
`HireShelby.setPushToken((await Notifications.getDevicePushTokenAsync()).data)`.

The team's replies always push. Offers and automations' messages are promotional, so they reach the lock screen
only for people who opted in to promotional notifications in your app (Apple's guideline 4.5.4); they always
appear in the chat. If your app asks for that opt-in, report it with
`HireShelby.setPromotionalPushAllowed(true)`.

### 5. Build and check

Build for an iOS simulator (`npx expo run:ios`), open Support and send a test message. It appears in the dashboard
inbox.

### 6. Identity verification (optional)

With real sign-in and a backend: your server signs an HS256 JWT with the app's identity secret (claims `user_id`
and `exp`; `name` and `email` optional), and the app passes it after sign-in and on every launch:

```ts
HireShelby.identify({ token: await api.getSupportToken() });
```

Never put the identity secret in the app.

## Offers, review requests and automations

Report the paywalls your app can show, so the team (and the AI) can send offers for them, and show the paywall
when someone taps one. The chat closes first, so a React Native paywall screen isn't hidden under it:

```ts
HireShelby.reportPaywalls([{ id: "pro_yearly", title: "Pro yearly 50% off", source: "revenuecat" }]);
HireShelby.setPaywallHandler((paywallId) => navigation.navigate("Paywall", { id: paywallId }));
```

Review cards show Apple's rating prompt (`reviewPrompt: "inApp"`, the default). Automations start from events you
track; only events an enabled automation listens for leave the device:

```ts
HireShelby.track("paywall_declined", { opensChat: true });
```

Report what StoreKit (or your purchases SDK) says, so automations and the team know who pays:
`HireShelby.reportStoreKit({ paying: true, originalTransactionIds: ["2000000123456789"] })`, or
`await HireShelby.reportStoreKitEntitlements()` to read StoreKit 2 on the device.

## AI replies

When the team turns on AI replies, the chat asks each person first, naming who receives their messages (for
example "OpenRouter and Anthropic"). The AI answers only people who tap **Allow**; everyone else gets the team. The
person can change their mind in the chat's menu, and AI replies are labelled. For a switch in your own settings:

```ts
const ai = await HireShelby.getAIReplies();
// ai.isEnabled: show the switch; ai.isAllowed: its state
await HireShelby.setAIRepliesAllowed(value); // only when the person flips it
```

## App Review

| Guideline | The SDK | You |
|---|---|---|
| 5.1.1(i), 5.1.2 Privacy | Ships a privacy manifest; collects only what the iOS SDK's README lists | Answer the App Store privacy questions (see the dashboard's App Store privacy guide); mention Hire Shelby in your privacy policy |
| 5.1.2(i) Third-party AI | Asks before any message goes to the AI, names who receives it, labels AI replies, lets the person turn it off | Nothing, unless you add your own switch (only the person may turn it on) |
| 5.1.1(v) Account deletion | `deleteData()` removes the person's support data | Await it in your account-deletion flow |
| 5.6.1 Ratings | Review cards use Apple's rating prompt by default | Don't offer anything in return for a review |
| 4.5.4 Push notifications | Never asks for permission; offers and automations push only after `setPromotionalPushAllowed(true)` | Report your own promotional opt-in, only if you ask for one with clear wording and let people turn it off |
| 1.3 Kids Category | Not designed for children's apps | Don't use it in apps in the Kids Category |

## Reference

| Call | What it does |
|---|---|
| `configure(appId, options?)` | Sets the SDK up; calls before it are kept |
| `identify({ userId, name, email })` / `identify({ token })` | Who the user is; a token verifies them |
| `logout()` / `deleteData()` | End the session / delete the user's support data |
| `setMetadata(record)` | Details the team sees |
| `presentChat()` / `dismissChat()` / `isChatOpen()` | The chat sheet |
| `useUnreadCount()` / `getUnreadCount()` / `addUnreadCountListener(fn)` | The unread badge |
| `addEventListener(fn)` / `useHireShelbyEvent(fn)` / `useIsChatOpen()` | SDK events |
| `setPaywallHandler(fn)` / `reportPaywalls(list)` | Offers |
| `setPushToken(hex)` / `clearPushToken()` / `setPromotionalPushAllowed(bool)` | Push (the token is sent automatically by default) |
| `handleNotification(n)` / `shouldShowNotification(n)` / `isHireShelbyNotification(n)` | Notifications |
| `reportStoreKit(state)` / `reportStoreKitEntitlements()` / `track(event)` | Subscriptions and automations |
| `getAIReplies()` / `setAIRepliesAllowed(bool)` | AI replies |
| `isSupported` / `version` | Whether the native module is in this build |

Options: `theme` (`accentColor`, `onAccentColor`, `backgroundColor`, `incomingBubbleColor`, `incomingTextColor`,
`fontName`, `colorScheme`, `title`, `welcomeTitle`, `welcomeText`, `welcomeIcon`, `showsCloseButton`),
`apiBaseUrl`, `logLevel`, `updatesAppBadge`, `usesRemoteAppearance`, `reviewPrompt`, `dismissesChatForPaywall`,
`automaticPushToken`.

## Development

This package wraps the iOS SDK in `../ios`: `npm run sync:ios` copies its sources into `ios/HireShelbySDK` (done
automatically when packing), where the podspec compiles them with the bridge (`ios/HireShelbyModule.swift`).

```sh
npm install && npm run typecheck && npm test
cd example && npm install && npm run prebuild && npx expo run:ios
```

CI (`.github/workflows/react-native-sdk.yml` in the main repository) runs the tests and builds the example app for
the simulator.

## License

MIT. See [LICENSE](LICENSE).
