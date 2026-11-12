# Partner API

For app builders that add Hire Shelby to the apps they build for their users (App Builder is the first). The
partner creates a Hire Shelby app for each project, builds its App ID into the app, and the project's owner answers
their users' chats in the Hire Shelby dashboard. Owners don't need an account first: they're invited, and the
invitation lets them sign up even while sign-ups are invite-only.

Base URL: `https://api.hireshelby.com/partner/v1` (staging: the staging API's URL). Every call sends the partner's
key: `Authorization: Bearer <key>`. JSON in and out; errors are `{ "error": { "code", "message" } }`. 300 calls a
minute per partner (429 with `Retry-After` past it).

## Keys

The api's `PARTNERS` variable lists partners as `id:key`, comma separated: a lowercase slug id (`app-builder`,
shown to owners as "App Builder") and a random key (`openssl rand -hex 32`). The same key goes in the partner's own
server-side configuration, never in an app. To rotate it, replace the key in both places and redeploy; there's one key per partner.

`PARTNER_BETA_DAYS` (default 90): how long a partner-created workspace counts as subscribed during the closed beta.

## Create the app: `PUT /apps/:externalId`

`externalId` is the partner's own project ID (1–128 of `A–Z a–z 0–9 . _ : -`). The call is idempotent: the first
creates the app (201), later ones return it (200) and renew the owner's invitation if it expired.

```json
{ "name": "Habit Tracker", "owner": { "email": "olive@example.com", "name": "Olive Owner" }, "bundleId": "com.example.habit" }
```

`owner.name` and `bundleId` are optional. Answer (also from `GET /apps/:externalId`):

```json
{
  "externalId": "proj_123",
  "app": { "id": "…", "appId": "app_XXXXXXXXXXXXXXXXXXXXXX", "name": "Habit Tracker", "bundleId": "com.example.habit" },
  "workspace": { "id": "…", "name": "Olive's App Builder apps" },
  "owner": { "email": "olive@example.com", "status": "invited", "invitationExpiresAt": "2027-02-10T…" },
  "urls": {
    "inbox": "https://app.hireshelby.com/inbox",
    "signUp": "https://app.hireshelby.com/sign-up?email=olive%40example.com&next=%2Finbox",
    "signIn": "https://app.hireshelby.com/sign-in?next=%2Finbox"
  },
  "apiBaseUrl": "https://api.hireshelby.com",
  "push": { "configured": false, "bundleId": null, "issue": null },
  "createdAt": "…"
}
```

- **`app.appId`** goes into the app: `HireShelby.configure("app_…")`. It works at once, before the owner joins;
  messages wait in the inbox.
- **One workspace per owner and partner.** An owner's projects share it, with beta access for
  `PARTNER_BETA_DAYS`. A different owner for an existing project is `409 owner_mismatch` (delete the app first).
- **The owner** (`owner.status`): `member` if they already had an account (they're added straight away), `invited`
  until they sign up with that address (they land in the workspace as its owner, without an empty workspace of
  their own), `expired` after 90 days unanswered (PUT again). Show `urls.signUp` (or `urls.inbox` for members) in
  the partner's own UI. When the api has an email key, Hire Shelby also emails the owner once.

## Push: `PUT /apps/:externalId/push`

The APNs auth key and notification settings, as in the dashboard's Push settings. The key is checked, stored
encrypted and never returned; leaving `p8` out keeps the stored one.

```json
{ "teamId": "ABCDE12345", "keyId": "KEY1234567", "bundleId": "com.example.habit", "p8": "-----BEGIN PRIVATE KEY-----\n…" }
```

Optional: `titleTemplate`, `bodyTemplate` (`{app}`, `{agent}`, `{message}`), `senderName`, `showPreview`, `sound`.
Answers with the app (`push.configured: true`). A key APNs later rejects shows in `push.issue`.

With a key in place, replies reach the phone once the app has notification permission: the React Native SDK
forwards the device token itself (see `sdk/react-native/README.md`).

## Delete: `DELETE /apps/:externalId`

Deletes the app and its conversations (204). The project ID can be used again, and the owner's workspace stays
theirs.

## In the app (React Native, Expo)

```ts
import { HireShelby } from "@hireshelby/react-native";

HireShelby.configure("app_…", { theme: { accentColor: "#FF5A1F" } }); // once, at startup
HireShelby.identify({ userId, name, email });                         // after sign-in, if the app has accounts
<Button title="Support" onPress={() => HireShelby.presentChat()} />
```

Build with a development or release build (not Expo Go). Notification taps: pass expo-notifications' response to
`HireShelby.handleNotification(response)`.
