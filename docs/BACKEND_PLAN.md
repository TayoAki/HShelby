# Backend build plan

How to build the server side of a reception-style product: the API the iOS SDK talks to, the API behind the team inbox, realtime delivery, push, Telegram, subscription webhooks, automations, billing and (later) AI replies.

This plan builds on [`PRODUCT_TEARDOWN.md`](PRODUCT_TEARDOWN.md): §5 (inferred architecture and wire protocol), §6 (full data model) and §7.3 (the hard parts). It turns those into decisions, a repo layout, contracts and a phased schedule with acceptance tests.

---

## TL;DR

| | Decision |
|---|---|
| Language | **TypeScript on Node 22**, one monorepo. Zod schemas shared by the API, the dashboard and generated Swift models. |
| HTTP | **Hono** (`@hono/zod-openapi`), one API service for SDK, dashboard and webhooks. |
| Database | **Postgres 16** + **Drizzle** (schema + migrations). |
| Jobs | **pg-boss** (Postgres-backed queue). Durable delays, cron, retries, and enqueue *inside the same transaction* as the data change. |
| Realtime | Polling for MVP (as reception's own web widget does). Then WebSockets in the API process, fanned out across instances with **Postgres `LISTEN/NOTIFY`**; move to Redis pub/sub only when scale demands it. |
| Files | S3-compatible bucket (**Cloudflare R2** or **Railway Buckets**), presigned PUT with SHA-256 checksum, short-lived signed GET. |
| Auth | Dashboard: **Better Auth** with Google, cookie sessions. SDK: device secret (Keychain) exchanged for 15-min access tokens; verified users via HS256 JWT signed by the customer's server. |
| Push / Telegram / Billing | Direct APNs over HTTP/2 (`jose` for ES256). Telegram Bot API webhooks. Stripe Checkout + Billing Portal + webhooks. |
| Hosting | **Railway**: `api`, `worker`, `dashboard`, `web` services + Postgres + bucket, staging and production environments. (You have Railway and Stripe connected in this workspace; swap freely.) |
| Timeline | **MVP backend ≈ 6–7 weeks** for one experienced TypeScript developer. **Parity without AI ≈ 4 months**, ≈ 4.5 months with AI. Backend only; the SDK and dashboard UI run in parallel. |

Why one Postgres for everything at the start: messages, the job queue, realtime fan-out and rate-limit counters all live in one database you already back up. That is one fewer service to run until real load says otherwise.

---

## Status

**B0–B8 run on Railway staging** (billing is switched off there until the Stripe test secret key is set) (project `hshelby`, environment `staging`): dashboard at `https://dashboard-staging-0dee.up.railway.app`, API at `https://api-staging-f8f8.up.railway.app`.

B1 (messaging core) as built:

- **SDK API** (`apps/api/src/routes/sdk.ts`): `POST /v1/devices`, `POST /v1/session/refresh`, `PATCH /v1/device`, `GET /v1/conversation?after|before|limit`, `POST /v1/messages`, `POST /v1/read`, `GET /v1/unread`. Device secrets are `dvs_` + 43 chars, stored as SHA-256. Access tokens are 15-minute HS256 JWTs with a key derived (HKDF) from `BETTER_AUTH_SECRET`, so no extra secret to manage; every request re-checks the device, its app and its session version.
- **Ordering and idempotency** (`apps/api/src/messaging.ts`): the §5.2 transaction. The acceptance test (200 concurrent sends, 20% retried `clientId`s → exactly 200 rows, seq 1–200) is in `apps/api/test/messaging.test.ts`. Teammates' replies are idempotent per author and `clientId`.
- **Unread:** each side has a read cursor (`user_read_seq`, `team_read_seq`) and a counter. Sending or replying reads your own side; a read locks the row, then recounts.
- **Inbox API** (`apps/api/src/routes/inbox.ts`): conversations list (status/app filters, keyset cursor), detail, thread paging, reply, read, resolve/reopen, device block/unblock (audited). `conversations.organization_id` is denormalized from the app for the inbox index.
- **Dashboard:** `/inbox` with a polled list and thread (optimistic replies, resolve, block, device details). Onboarding's "waiting for your first message" completes on the first real message.
- **Try it without an app:** `npx tsx apps/api/scripts/sdk-sim.ts --app app_… --api <api url> --say "Hello" --chat` plays the SDK.
- **Deferred to their phases:** rate limits on `POST /v1/devices` (B12).

B4 (identity and deletion) as built:

- **Labels:** `identity: {userId, name, email}` on `POST /v1/devices` and `PATCH /v1/device` (now `{device, identity, identityToken, metadata}`, all optional, applied atomically). Omitted or empty fields keep the server's value. Labels never change a verified device.
- **Verified identity** (`apps/api/src/identity.ts`): HS256 only, keyed with the app's `ids_…` secret verbatim; `user_id` (string ≤255 or safe integer) and `exp` required, future `nbf` refused, 30 s clock tolerance, tokens ≤4,096 characters. `name`/`email` kept when valid, other claims ignored. The device stores the accepted claims, never the token. Errors: `identity_token_invalid` / `identity_token_expired` (422). Test vectors are in `apps/api/test/identity.test.ts`.
- **One user per device:** a different user ID for a device that has one is `identity_mismatch` (409); the app logs out and registers again. Guest → signed-in keeps the conversation.
- **Metadata:** whole-dictionary replace, ≤20 entries, keys 1–64, values ≤512, strings only. `revenuecat_id`, `superwall_id`, `adapty_id` survive updates that omit them.
- **Only verified users can chat** (`apps.only_verified`, admin setting, audited): unverified devices get `verification_required` (403) on send; `GET /v1/conversation` returns `sending: {allowed, reason}` and `identity` so the SDK can say "Sign in to send messages."
- **Secret rotation:** `POST /api/apps/:id/identity-secret/rotate {unverifyExisting}` (admin, audited) invalidates old tokens at once.
- **Logout:** `POST /v1/session/logout {deviceSecret}` ends the device (credential dead, history kept, idempotent). The SDK registers a new device next, which starts a new chat; the inbox marks the old one signed out.
- **Delete:** `DELETE /v1/device` and admin `DELETE /api/devices/:id` (audited) remove the device with its conversations and messages in one statement (foreign-key cascades). Deleted apps are purged by the worker's `purge.deleted-apps` job every 15 minutes, in batches.
- **Dashboard:** names, emails and a verified seal in the inbox, search (name, email, user ID, latest message), user and custom-field details, a signed-out notice, admin "Delete user data", and an app Settings page for the secret, rotation and only-verified mode. The setup prompt gains an identity-verification step.
- **Not yet:** `devices.deleted_at` is unused and will be dropped in a later migration (dropping it now would break the running version mid-deploy).

B3 (push) as built:

- **Package** `packages/push`: an HTTP/2 APNs client (token auth; ES256 provider tokens cached 50 minutes per key; one connection per host), notification content (title/body templates with `{message}`, `{agent}`, `{app}` filled in one pass; title ≤100 and body ≤500 characters; preview and sound switches; sender name; badge = the conversation's unread count unless the app owns its badge; `thread-id` and the conversation ID for tap-to-open), and delivery with outcome handling. `@hshelby/push/testing` has a fake APNs server for tests.
- **Devices:** registration and `PATCH /v1/device` take `push: {token, environment, updatesAppBadge}` (raw APNs token in hex; `null` clears it). A token reported by a new device is removed from the app's other devices; logout clears it.
- **Sending:** a teammate's reply enqueues `push.send` inside its own transaction (pg-boss `fromDrizzle`), keyed by message ID. The worker sends it to the device's environment; Postgres LISTEN/NOTIFY wakes the worker immediately.
- **APNs answers:** 410 drops the token; device rejections (BadDeviceToken, DeviceTokenNotForTopic) are kept as the device's push issue; key rejections (403, BadTopic) flag the app's settings; 429/5xx/timeouts retry with exponential backoff (5 retries) and are recorded on the last attempt. A delivery clears earlier issues.
- **Dashboard:** app Settings has a Push notifications card: `.p8` upload (validated, stored encrypted, never returned; the Key ID is read from Apple's file name), Key/Team/Bundle IDs, templates with a live preview, "Send test" to up to 10 recent devices with per-device results, and remove. Device details show notification status and the last push issue. Changes are admin-only and audited.
- **Not verified here:** delivery to a real iPhone. That needs an Apple key and a device; everything up to Apple's servers is tested against the fake APNs.
- **Deferred:** per-language templates. (Skipping the push while the user is in the chat came with B6, card pushes with B7.)

B2 (photos) as built:

- **Package** `packages/storage`: a client for any S3-compatible bucket (a Railway Bucket on staging; R2 and S3 work the same way), with presigned PUT and GET, one-object-at-a-time deletes (the one delete every provider supports), prefix deletes, and a JPEG/PNG header reader that gets the type and pixel size without decoding. `@hshelby/storage/testing` makes a bucket on a local moto server.
- **Upload:** `POST /v1/uploads {contentType, bytes, width, height, checksum}` (JPEG or PNG, ≤1 MiB, longest side ≤2048 px, base64 SHA-256) stores a pending row and returns a PUT URL valid for 15 minutes, signed with the type, length and checksum. The SDK PUTs the file, then sends `POST /v1/messages {clientId, text, attachmentIds}` (up to 4 photos; text is optional when there are photos). The SDK should re-encode before uploading, which applies EXIF orientation and drops metadata such as location.
- **Verify on send** (`apps/api/src/photos.ts`): before the message is stored, the server reads each object back and checks its size, SHA-256, file signature and dimensions, so it doesn't depend on the provider enforcing the signature. A missing object is `upload_incomplete` (409: PUT again, resend); anything else is `invalid_attachment` (422). Photos are attached inside the message's transaction, and a retried `clientId` returns the stored message with its photos.
- **Reading:** messages carry `attachments: [{id, url, contentType, width, height}]`; `url` is a signed GET that works for 15 minutes, is fresh on every fetch, and serves the type the server checked (not the one the uploader sent). A photo-only message previews as "Photo" in the inbox and "Sent a photo" in a push.
- **Limits:** 20 unsent uploads per device (`too_many_uploads`, 429); blocked devices, and unverified ones in only-verified mode, can't upload. An upload has to be sent within 23 hours.
- **Cleanup:** the worker's hourly `maintenance.unsent-uploads` job removes uploads still unsent after 24 hours, object first, then row. The hour between the send window and the sweep means a send never attaches a photo the sweep is deleting. Deleting a device (SDK or admin) deletes its photos first; purging an app deletes the app's.
- **Teammates:** `POST /api/conversations/:id/attachments` (multipart `file`; the 1.1 MB body limit applies to that route only) checks and stores the photo, and the reply sends it with `attachmentIds`. The dashboard redraws each picked photo in the browser (EXIF orientation applied, metadata dropped, longest side 2048 px, PNG kept when it fits, otherwise JPEG at falling quality until ≤1 MB), uploads it as soon as it's picked, and shows photos in the thread with a full-size viewer.
- **Without a bucket** (no `S3_*` variables) photos are off: uploads answer `uploads_not_configured` (503) and text messaging works as before.
- **Simulator:** `--photo PATH` (repeatable) and `--caption` run the SDK's upload flow.
- **Checked on staging** (Railway Bucket): the bucket itself refuses a PUT whose bytes don't match the signed SHA-256 (400 `XAmzContentSHA256Mismatch`) or whose length or content type differs (403 `SignatureDoesNotMatch`); an unsigned GET is 403, and signed GETs come back with the overridden type. The server's own checks stay, since other providers (and the moto server in tests) don't enforce these.
- **Deferred:** thumbnails (the dashboard and SDK show the ≤2048 px original), photos in Telegram (B8).

B5 (billing) as built:

- **Rules** (`packages/billing`): one subscription per workspace. `active`, `trialing` and `past_due` (Stripe retrying a failed renewal) keep paid features on; anything else (`canceled`, `unpaid`, `incomplete`…) turns them off. With billing switched off (no Stripe variables), nothing is gated.
- **Gating** (402 `subscription_inactive`): teammates' replies and photo uploads, a second app, and invitations (Better Auth's `beforeCreateInvitation`). Never gated: anything end users do, reading the inbox, resolve and block, deleting a user's data, settings. Before subscribing, the team can reply in each app's setup conversation (its first conversation, from the developer's test device: `apps.setup_conversation_id`), as reception allows.
- **Checkout and portal:** Better Auth's Stripe plugin (`/api/auth/subscription/upgrade` and `/billing-portal`, webhooks at `/api/auth/stripe/webhook`, and the return from Checkout, which records the subscription even before its webhook arrives). A guard sells only the plan on offer, only as a workspace subscription, only to owners and admins of a workspace that isn't subscribed. Card changes, plan changes and cancellation happen in Stripe's billing portal.
- **Founder spots:** the founder prices (`STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`) are on sale until `FOUNDER_SPOTS` (default 50) workspaces hold a founder subscription that is still on; then the standard prices are. A founder who leaves frees a spot. The count is checked when Checkout starts, so two workspaces racing for the last spot can both get it. Without standard prices set, the founder price stays on sale. Amounts come from Stripe, cached for 10 minutes. `GET /public/pricing` (no auth, any origin, cached 60 s) gives the landing page the offer and the counter.
- **Backstop:** the plugin answers 200 even when applying a webhook fails, so the worker's hourly `billing.sync` re-reads every subscription Stripe may still change and fixes rows that drifted. It needs `STRIPE_SECRET_KEY` on the worker.
- **Dashboard:** a Billing page (plan, renewal or end date, a past-due notice and "Manage billing", or else the offer with the founder counter and Subscribe), an inbox banner while unsubscribed or past due, a composer that says why it's locked (and marks the setup conversation), "Add app" leading to Billing when locked, and the onboarding Subscribe step showing the live offer.
- **Tests** run the real plugin against a fake Stripe (`@hshelby/billing/testing`): checkout and webhooks turn replies on; cancel-at-period-end and past-due keep them on; the end turns them off while the user's messages keep arriving; the return from Checkout works without the webhook; the plan, admin and founder-cap guards; a forged webhook is refused; the sync job fixes missed changes. A browser walkthrough runs the same loop through the fake's Checkout and portal pages.
- **Staging Stripe:** the shared "UGC Mediakits" sandbox has a product `hshelby (staging)` with the four prices and a webhook endpoint for the staging API (API version `2026-04-22.dahlia`); their IDs and the webhook secret are set on the api service. Billing switches on once that sandbox's secret key is set as `STRIPE_SECRET_KEY` on the api service (the worker references it). The sandbox is shared, so the endpoint also receives other projects' subscription events; the plugin ignores prices it doesn't know.

B6 (realtime) as built:

- **Endpoints:** `GET /v1/live` (SDK; access token in the `Authorization` header) and `GET /api/live` (dashboard; session cookie, and only from the dashboard's own origin, since browsers send cookies on cross-site WebSocket handshakes) upgrade to WebSocket on the API's port (`apps/api/src/realtime/gateway.ts`). The dashboard connects to its own origin; Next's rewrite proxies the upgrade to the API.
- **Events, not data** (`packages/contracts/src/realtime.ts`): `message {seq}`, `read {seq}` and `typing` to the SDK; `message`, `conversation` (status or read state changed), `typing` and `presence` to dashboards. Every connection starts with `ready`; `resync` means events may have been missed. Either way clients catch up once with `after=seq`.
- **Fan-out:** messages, reads and status changes publish `pg_notify('rt', …)` inside their own transactions, so nothing is announced before it commits and a rolled-back change never is. Every instance keeps one connection that LISTENs and routes events to its sockets: dashboards by organization, the SDK by device. If that connection drops, it reconnects with backoff and tells every socket to resync. `realtime/fanout.ts` is the only file to change for Redis pub/sub.
- **Typing:** relayed through the same channel, never stored, throttled to one event per 2 s per sender, and never echoed to the teammate typing. A typing indicator lasts 5 s.
- **In chat:** the SDK's socket is open only while the chat is on screen. Opening sets `devices.chat_open`; heartbeats (the SDK's every 15 s, and the server's pings) refresh `last_seen_in_chat_at` at most every 20 s; closing clears it. "In chat" means open and seen within 45 s, so a crashed instance's sockets stop counting on their own. The worker **skips the push** for a reply to a device that's in chat (`in_chat` outcome).
- **Safety:** 4 KB message limit, 40 messages per 10 s per socket, pings every 15 s to drop dead connections. SDK sockets close with 4001 after 15 minutes (the access token's lifetime) and dashboard sockets after an hour, so credentials are rechecked on reconnect: a logged-out or deleted device can't stay connected.
- **Dashboard:** one socket per tab with reconnect and backoff. The inbox and the open thread update live; polling drops to every 30 s while the socket is up (3–5 s otherwise). It shows "In chat" badges, "Chat open" in the device details, and typing both ways.
- **Simulator:** `--chat` uses the live socket (heartbeats, typing on keypress, team typing and read receipts printed) and polls only while it's down.
- **Done-when test** (`apps/api/test/realtime.test.ts`): two API instances on one database; a reply sent through A reaches a dashboard socket and the user's socket on B in 17–19 ms locally, including the HTTP request and the transaction (the target is under 300 ms). The same file covers read receipts, workspace isolation, resync after a dropped listener, typing, presence and refused credentials.

B7 (cards) as built:

- **Paywall reports:** `POST /v1/devices` and `PATCH /v1/device` take `paywalls: [{id, title, source, presentable, products}]`, the paywalls the app can show right now (IDs 1–64 of `[A-Za-z0-9_.-]`, titles ≤60, at most 20 paywalls and 40 products, IDs unique). Each report replaces the device's list (`devices.available_paywalls`, `paywalls_reported_at`); omitting it leaves the list alone, `[]` clears it. Reports also feed the app's registry (`app_paywalls`), which rewrites a row only when it changed or is over an hour old, so an SDK that reports on every foreground doesn't write every time.
- **Cards** are agent messages with `kind` `review` or `paywall` and a stored `card` (`messages.card`). `POST /api/conversations/:id/cards {kind, clientId, text?, buttonLabel?, scenario? | paywallId, confirmRepeat?}` goes through the same append transaction as replies (seq, idempotent `clientId`, push, live event) and is gated like replies.
  - An **offer** must name a paywall the device last reported and can present, else 422 `paywall_unavailable`. The card keeps the paywall's title as it was when sent; the SDK sees only `{type, paywallId, buttonLabel}`.
  - A **review** needs the app's App Store ID (`app_store_id_required`, 422), which admins set on the app (`PATCH /api/apps/:id {appStoreId}`, audited). The review URL is computed when the message is read, so changing or clearing the ID updates older cards (no ID: the SDK shows the text without a button). Sending one sets `devices.review_asked_at`, which automations will use to skip people already asked. `{app}` in the text becomes the app's name.
  - **Repeat guard:** if the last card of the same kind got no reply from the user, another one needs `confirmRepeat` (409 `card_repeat_unconfirmed`); the dashboard asks the teammate to type "send review" or "send offer". It runs inside the transaction, with the conversation row locked.
  - A null `buttonLabel` means the SDK's default ("Rate on the App Store", "View offer") in the user's language; admins can set custom labels per app.
- **Click receipts:** `POST /v1/actions/:messageId/click {clickedAt?}` records the first tap on one of the device's cards (`messages.action_clicked_at`) and answers `{actionClickedAt, first}`; later or concurrent taps return the first one. A receipt the SDK cached offline may carry its tap time, kept between the card's sending and now. The first tap publishes an `action` event, so the dashboard shows "Alex opened the Pro yearly paywall" live.
- **Settings and stats** (`/api/apps/:id/...`): `cards/settings` (review templates for General, After helping and After feedback, ≤500 characters with `{app}`; up to 5 button labels each for reviews and offers; admins change them), `paywalls` (the registry), and `cards/stats?days=7|30|90` (sent, first opens, by sender and by paywall; a partial index on `messages(created_at) where kind <> 'text'` keeps it cheap).
- **Push:** a card with no text pushes "Sent an offer: Pro yearly" or "Asked for a rating". The in-chat skip applies as for replies.
- **Dashboard:** "Ask for review" and "Send offer" in the composer (templates, the device's reported paywalls only, label choice, the repeat confirmation), cards rendered in the thread with their tap receipts, "Paywalls" and "Review asked" in the details panel, and a Reviews and offers card (App Store ID, templates, labels, activity) plus a Paywalls card on the app's settings page.
- **Simulator:** `--paywall id=Title` (repeatable) reports paywalls; in `--chat`, cards print with their button and `/tap` sends the click receipt.
- **Done-when tests** (`apps/api/test/cards.test.ts`): an offer for an unreported (or unpresentable, or no longer reported) paywall is refused; five racing taps record exactly one first tap, and later taps return it. The same file covers the registry, malformed reports, the review link and App Store ID permissions, the repeat guard, resends, stats and settings.
- **Deferred:** per-language templates and "Suggested" offer text in the user's language; "Reset support" (which would keep card history).
- **Checked on staging:** the browser walkthrough (settings, an offer, the tap, the repeat guard, stats) runs against the staging dashboard; the tap receipt shows in the thread about 370 ms after the tap.

B8 (Telegram) as built:

- **Package** `packages/telegram`: a Bot API client (Telegram's errors as data: retry_after, migrate_to_chat_id, chat gone, thread gone), message formatting (HTML, escaped, cut at 3,500 characters), the delivery logic shared by the API and the worker, and `@hshelby/telegram/testing`, a fake Bot API with bots, chats, topics, reactions, webhooks with secret tokens, a per-chat rate limit, migrations and planned failures.
- **Connecting** (`PUT /api/apps/:id/telegram {botToken, chatId}`, admins, audited): checks the token (`getMe`) and the chat (`getChat`; channels refused), sets the bot's webhook to `/webhooks/telegram/<bot>` with a fresh secret token (stored as SHA-256), posts a confirmation, and stores the connection. The token is encrypted with `ENC_KEYS` and never returned. A bot belongs to one workspace (`telegram_bot_in_use`, 409) but can serve several of its apps, since Telegram allows one webhook per bot. `PATCH` pauses or switches topics (refused unless the chat is a forum and the bot can manage topics), `POST …/test` posts a test, `DELETE` disconnects and, for a bot nothing else uses, removes the webhook and forgets the token.
- **Out** (jobs `team.notify` → `telegram.send`): every message enqueues `team.notify` in its own transaction. A customer's message is posted as "**App · User** ✓" (the check for verified users) with its text, "📷 Photo" for photos (files aren't forwarded) and a description for cards. A reply written in the inbox, by an automation or the AI is mirrored silently as a Telegram reply under the customer's latest notification. Nothing is posted while paused, and nothing missed is replayed.
- **Pacing:** at most one post per chat every `TELEGRAM_CHAT_INTERVAL_MS` (3 s, i.e. Telegram's ~20 a minute per group). `team.notify` reserves the chat's next slot (`telegram_chats.next_slot_at`) and schedules the send there; each send also waits, under the chat's row lock, until the interval since the chat's last send has passed, so retries and catch-up after downtime can't burst. A 429 pushes the chat's slot back by `retry_after` and reschedules the job. One worker takes sends in slot order, so a chat's posts keep the order they were written in.
- **In** (`POST /webhooks/telegram/:botId`, secret token checked in constant time): a team member's Reply to a notification or a mirrored answer (or, with topics, any message in the customer's topic) becomes a team reply in the app (`source: telegram`), with its push. Only plain text up to 4,000 characters; bots, anonymous admins, forwards, media and edits are ignored. The reply is attributed to the workspace's only member, or to the team when there are several. The bot reacts 👍 once it's saved, or answers "Reply sent." where reactions are off; too-long replies and replies while the subscription is inactive get a short notice instead. A redelivered update is a no-op (`telegram_posts` key).
- **Chat changes:** a group upgraded to a supergroup is followed, both from the migration update and from the error on the next post, and posts, topics and the connection move with it. A bot removed from the chat records the reason on the connection, shown in settings. With topics on, each customer gets a forum topic "App · User" (renamed when the name changes, recreated if deleted); without the rights, posts fall back to the main chat and the connection says why.
- **Worker queues:** `push.send`, `team.notify` and `telegram.send` now fetch up to 10 jobs at a time and keep fetching while the queue returns full batches, settling each job on its own (one failure retries only that job). Before, pg-boss waited for its 30 s backstop poll after a NOTIFY wake-up, so a burst of replies could take minutes.
- **Dashboard:** a Telegram card on the app's settings page (BotFather steps, connect, status, pause, topics, test, disconnect, the last refusal), and "via Telegram" on replies sent from there.
- **Done-when tests:** `apps/api/test/telegram.test.ts` (a Reply in Telegram lands in the app chat once, with the 👍; connecting, refusals, pausing, mirrors, routing and what's ignored, too-long replies, a forged secret, reactions off, several teammates, a migrated group, a removed bot, topics, a 429) and `apps/worker/test/telegram.test.ts` (a burst of 50 customer messages is posted in order with no 429 from a fake Telegram that allows 20 per window, scaled to a 110 ms interval).
- **Not checked here:** a real Telegram group (needs a bot token from BotFather). Everything up to Telegram's API runs against the fake; on staging, connecting with a made-up token gets Telegram's own refusal.

Where B0 differs from the plan below:

- **Sign-in is email + password.** Google comes later; it is one `socialProviders.google` block in `apps/api/src/auth.ts` plus a button.
- **Billing moved partly into B0.** Better Auth's Stripe plugin handles organization subscriptions (plan `founder`, monthly or yearly). It runs in **test mode only**: the API refuses `sk_live_` keys, and billing stays off until all four `STRIPE_*` variables are set. B5 added the gating, founder spots, the portal and the sync backstop (see above).
- **Not done yet:** OpenAPI output from `contracts`, Sentry, email delivery (invitations are logged, not sent).

Railway layout:

| Service | Build / start | Notes |
|---|---|---|
| `api` | `npm run build -w @hshelby/api` / `npm run start -w @hshelby/api` | Pre-deploy `npm run migrate -w @hshelby/api`; healthcheck `/health` (runs `select 1`). |
| `worker` | same with `@hshelby/worker` | pg-boss: `push.send`, `team.notify` and `telegram.send`, nightly cleanup at 03:00 UTC, deleted-app purge every 15 minutes, unsent-upload sweep and `billing.sync` hourly. |
| `dashboard` | same with `@hshelby/dashboard` | Healthcheck `/health`. Proxies `/api/*` to the API over the private network, so auth cookies are first-party. |
| `Postgres` | Railway template | |
| `photos` | Railway Bucket | Private; read and written only through presigned URLs and the API. |

Service settings live on the services themselves (Railway's JSON config-as-code is deprecated). Watch patterns limit redeploys to the paths each service uses: its app, every workspace package it bundles (directly or through another package), the root `package.json`, `package-lock.json` and `tsconfig.base.json`. When an app gains a workspace dependency, add that package's path to the service's watch patterns, or a change made only in the package won't redeploy it.

Variables (secrets are set in Railway only, never in the repo):

| Service | Variable | Value |
|---|---|---|
| api | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| api | `BETTER_AUTH_URL` | `https://${{dashboard.RAILWAY_PUBLIC_DOMAIN}}` (the browser's origin) |
| api | `BETTER_AUTH_SECRET`, `ENC_KEYS` | random; `ENC_KEYS` is `v1:<base64 32 bytes>` |
| api | `PUBLIC_API_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| api | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | Stripe sandbox values (the two prices are the founder prices); webhook endpoint `https://<api domain>/api/auth/stripe/webhook` with `checkout.session.completed` and `customer.subscription.created/updated/deleted` |
| api | `STRIPE_PRICE_STANDARD_MONTHLY`, `STRIPE_PRICE_STANDARD_YEARLY`, `FOUNDER_SPOTS` | Optional: the prices after the founder spots (default 50) are taken |
| worker | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| worker | `ENC_KEYS` | `${{api.ENC_KEYS}}` (decrypts apps' APNs keys) |
| worker | `STRIPE_SECRET_KEY` | `${{api.STRIPE_SECRET_KEY}}` (billing sync; optional) |
| api, worker | `TELEGRAM_CHAT_INTERVAL_MS` | Optional: minimum gap between posts in one Telegram chat (default 3000) |
| api, worker | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `${{photos.ENDPOINT}}`, `${{photos.REGION}}`, `${{photos.BUCKET}}`, `${{photos.ACCESS_KEY_ID}}`, `${{photos.SECRET_ACCESS_KEY}}` (photos are off without them) |
| dashboard | `API_INTERNAL_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`, read at build time |

---

## 1. What the backend has to do

1. **SDK API** (`/v1`): register devices, issue tokens, sync conversations, accept messages and photos, track read/unread, record card taps, accept app events, serve remote appearance.
2. **Dashboard API** (`/api`): orgs, members, invitations, apps, inbox (list, thread, reply, resolve, block), customer details, settings for push / Telegram / reviews / paywalls / automations / billing.
3. **Realtime**: new messages, typing, read state and "In chat" presence to the phone and to every open dashboard tab.
4. **Outbound work**: APNs pushes, Telegram notifications, automation steps, purges, nightly cleanup, AI replies.
5. **Inbound webhooks**: Telegram, RevenueCat, Superwall, Adapty, App Store Server Notifications v2, Stripe.
6. **Billing and gating**: one subscription per org. If it lapses, users can still write in, but the team can't reply (reception's documented behavior).

Not in this plan, but they consume it: the Swift SDK, the React Native wrapper, the dashboard UI. Section 6 is the contract they build against.

---

## 2. Architecture

```mermaid
flowchart LR
  subgraph Clients
    SDK["iOS SDK / RN wrapper"]
    DASH["Dashboard (Next.js)"]
  end
  subgraph Edge["Cloudflare (DNS proxy, WAF, rate rules)"]
  end
  subgraph Railway
    API["api (Hono)<br/>/v1 · /api · /webhooks/*<br/>WS /v1/live · /api/live"]
    WORKER["worker (pg-boss)<br/>push · telegram · automations<br/>purge · cleanup · ai"]
    PG[("Postgres<br/>data + pg-boss queue<br/>+ LISTEN/NOTIFY")]
    BUCKET[("S3-compatible bucket<br/>photos, icons, assets")]
  end
  APNS[(Apple APNs)]
  TG[(Telegram Bot API)]
  SUBS[(RevenueCat / Superwall /<br/>Adapty / App Store ASN v2)]
  STRIPE[(Stripe)]
  GOOGLE[(Google OAuth)]
  CLAUDE[(Anthropic API)]

  SDK --> Edge --> API
  DASH --> Edge
  SDK -- presigned PUT / signed GET --> BUCKET
  API <--> PG
  WORKER <--> PG
  API -- NOTIFY --> PG -- LISTEN --> API
  WORKER --> APNS
  WORKER --> TG
  TG -- webhook --> API
  SUBS -- webhook --> API
  STRIPE -- webhook --> API
  GOOGLE --> API
  WORKER --> CLAUDE
```

**Rule of thumb:** the API does the minimum inside the request (validate → write → enqueue → NOTIFY) and the worker does anything that talks to a third party. So a slow APNs or Telegram call never slows a send, and every side effect retries on its own.

---

## 3. Repo layout

The current landing page moves to `apps/web` in phase B0.

```
apps/
  api/           Hono app: routes, auth middleware, WebSocket gateway, webhook receivers
  worker/        pg-boss consumers + cron schedules
  dashboard/     Next.js inbox (client of the API)
  web/           marketing site (today's src/)
packages/
  contracts/     Zod request/response schemas + error codes → OpenAPI → Swift models
  db/            Drizzle schema, migrations, typed query helpers
  core/          domain logic: messaging, identity, cards, automations, appearance
  integrations/  apns, telegram, stripe, storage, provider normalizers (rc/superwall/adapty/asn)
  testing/       factories, Postgres test harness, webhook fixtures
```

`core` has no HTTP in it, so the API, the worker and tests all call the same functions.

---

## 4. Data model, MVP subset

The full model is in the teardown §6. The MVP needs these tables, with the constraints that matter:

```text
organizations   id, name, stripe_customer_id, sub_status, plan, current_period_end
users           id, email, name, image                (Better Auth also owns sessions/accounts)
memberships     org_id, user_id, role{admin|member}   UNIQUE(org_id, user_id)
invitations     id, org_id, email, role, token_hash, expires_at

apps            id, org_id, public_id 'app_…' UNIQUE, name, icon_key, bundle_id, app_store_id,
                identity_secret_enc, only_verified, appearance_published_json, appearance_version
push_configs    app_id PK, team_id, key_id, p8_enc, title_template, body_template

devices         id, app_id, secret_hash UNIQUE, session_version, user_id_ext, name, email, verified,
                metadata_json, app_version, sdk_version, os_version, model, locale, timezone,
                push_token, push_env{sandbox|production}, push_issue, blocked, last_seen_at, deleted_at
                INDEX(app_id, user_id_ext)

conversations   id, app_id, device_id, status{open|closed}, last_seq bigint DEFAULT 0,
                user_read_seq, team_read_at, unread_for_user, unread_for_team,
                last_message_at, superseded_at
                UNIQUE(device_id) WHERE superseded_at IS NULL   -- one live conversation per device
                INDEX(app_id, status, last_message_at DESC)      -- the inbox query

messages        id, conversation_id, seq, sender{user|agent}, source{sdk|dashboard|telegram|automation|ai},
                author_user_id, device_id, client_id, kind{text|review|paywall}, text, card_json,
                action_clicked_at, created_at
                UNIQUE(conversation_id, seq)
                UNIQUE(device_id, client_id)                     -- idempotent retries

attachments     id, device_id|user_id, message_id NULL, object_key, content_type, bytes, width, height,
                sha256, status{pending|verified}, created_at
```

Conventions:
- Every table that holds customer data reaches `org_id` through `app_id`. Every query goes through a `scoped(orgId)` helper; no raw cross-org queries.
- Secrets (`p8_enc`, `identity_secret_enc`, Telegram tokens, provider secrets) use AES-256-GCM envelope encryption with a versioned master key from env (`ENC_KEY_V1`), so keys can rotate later.
- IDs: UUIDv7 internally (time-ordered); public prefixes (`app_`, `ids_`) only at the edge.

---

## 5. The core flows

### 5.1 Device registration and tokens

1. `POST /v1/devices` with `{appId, device details, identity?, metadata?, push?, identityToken?}`.
2. The server creates a device and returns `{deviceSecret, accessToken, expiresIn}`. `deviceSecret` is 32 random bytes, stored only as SHA-256. The SDK keeps it in the Keychain (`…ThisDeviceOnly`).
3. `accessToken` is a 15-minute HS256 token signed with a server key: `{dev, app, sv: session_version, exp}`.
4. `POST /v1/session/refresh` with the device secret issues a new access token.
5. `logout` and `DELETE /v1/device` bump `session_version`, which kills outstanding tokens.
6. **Verified users:** if `identityToken` is present, verify HS256 against the app's decrypted `ids_…` secret. `user_id` and `exp` are required, max 4,096 chars. On success, set `verified=true` and store the claims, not the token. A different `user_id` from the stored one starts a fresh device session (the teardown's mismatch rule). When `only_verified` is on, reject unverified sends with `verification_required`.

### 5.2 Sending a message (the heart of it)

Ordering and no duplicates come from one short transaction:

```sql
BEGIN;
-- 1. Lock (or create) the device's live conversation and take the next seq
UPDATE conversations
   SET last_seq = last_seq + 1, status = 'open',
       last_message_at = now(), unread_for_team = unread_for_team + 1
 WHERE device_id = $device AND superseded_at IS NULL
RETURNING id, last_seq;            -- row lock serializes concurrent sends
-- (if no row: INSERT the conversation first, then repeat)

-- 2. Insert; UNIQUE(device_id, client_id) turns a retried send into a conflict
INSERT INTO messages (conversation_id, seq, sender, source, device_id, client_id, kind, text)
VALUES ($conv, $seq, 'user', 'sdk', $device, $clientId, 'text', $text);

-- 3. Side effects ride the same transaction (outbox): never lost, never sent for a rolled-back row
--    boss.send('team.notify', {messageId}, {db: tx})   -> Telegram + dashboard counters
--    boss.send('ai.consider', {conversationId}, {db: tx, singletonKey: conv, startAfter: 8})
SELECT pg_notify('rt', json_build_object('conv', $conv, 'seq', $seq)::text);
COMMIT;
```

On a unique violation for `(device_id, client_id)`, roll back and return the stored message: the client sees success and still has exactly one copy (reception's checklist tests this explicitly). Agent replies from the dashboard, Telegram, automations and AI all go through the same `core.appendMessage()` with a different `sender`/`source`, and enqueue `push.send` instead of `team.notify`.

### 5.3 Reading, unread, sync

- `GET /v1/conversation?after=<seq>` returns the conversation plus messages after `seq` (or the latest 50). It's used for the first load, polling, and catch-up after a WebSocket reconnect.
- `POST /v1/read {seq}`: `user_read_seq = GREATEST(user_read_seq, $seq)`, then recompute `unread_for_user`.
- `GET /v1/unread` is cheap and index-only, and it's what the SDK polls when the chat is closed. Polling stops once push works (reception does the same, and it's what keeps idle installs from hammering you).

### 5.4 Photos

1. `POST /v1/uploads {contentType, bytes, width, height, checksum}`: validate JPEG/PNG, ≤ 1 MiB, ≤ 2,048 px. Create a pending attachment and return a presigned PUT carrying `x-amz-checksum-sha256` and `If-None-Match: *`.
2. The client PUTs straight to the bucket.
3. `POST /v1/messages {…, attachmentIds}`: the server HEADs each object (size and checksum match), marks it verified and links it to the message.
4. Reads use signed GET URLs that live 15 minutes. A nightly `cleanup` job deletes pending uploads older than 24h.

### 5.5 Realtime (phase B6)

- `GET /v1/live` (SDK) and `GET /api/live` (dashboard) upgrade to WebSocket and authenticate with the access token or the session cookie.
- Every API instance runs one `LISTEN rt`. On each notification it forwards `{type:'message.created', conv, seq}` to sockets subscribed to that conversation or app. Clients fetch with `after=seq`, so NOTIFY payloads stay tiny (well under Postgres's 8 KB limit).
- Typing: client → server → peers, never stored.
- Presence: the SDK sends a heartbeat every 15 s while the chat is visible. The server writes `last_seen_in_chat_at` at most once a minute. "In chat" means seen in the last 45 s.
- **Skip push** for an agent reply when the device is "In chat". That saves APNs calls and stops the double ping.
- When one Postgres connection per instance becomes a limit (dozens of instances), switch fan-out to Redis pub/sub. Only `realtime/fanout.ts` changes.

### 5.6 Push (`push.send` job)

- Per app: encrypted `.p8`, Key ID, Team ID. Provider JWT (ES256 via `jose`), cached about 50 min per (team, key).
- `node:http2` sessions to `api.push.apple.com` / `api.sandbox.push.apple.com`, chosen by the **device's** `push_env`. Headers: `apns-topic = bundle_id`, `apns-push-type: alert`. Body: templated title and body, `thread-id = conversationId`, a custom key for the conversation, and `badge = unread_for_user` when the device opted in.
- Responses:

  | Response | Action |
  |---|---|
  | `410 Unregistered` | clear the token |
  | `400 BadDeviceToken` / `DeviceTokenNotForTopic` | store as the device's push issue (shown in the dashboard) |
  | `403 InvalidProviderToken` | flag the app's push config |
  | `429` / `5xx` | retry with backoff |

- Job `singletonKey = messageId`, so one push per message even under retries.

### 5.7 Telegram

- The customer pastes their own bot token (from BotFather). The server calls `setWebhook` with `secret_token` and checks it on every update (`X-Telegram-Bot-Api-Secret-Token`).
- **Outbound** (`team.notify`): `sendMessage` to the linked group, then store `telegram_posts(chat_id, message_id → conversation_id)`.
- **Inbound:** a reply → `reply_to_message.message_id` → conversation → `core.appendMessage(source='telegram')` → 👍 reaction via `setMessageReaction`.
- Handle `migrate_to_chat_id` (a group upgraded to a supergroup). Throttle to about 20 messages/min per group with a per-chat pg-boss throttle.

### 5.8 Subscription webhooks → automations (phase B10)

1. Verify each provider:

   | Provider | Check |
   |---|---|
   | RevenueCat | auth header |
   | Superwall | `whsec_` HMAC |
   | Adapty | auth header + URL check |
   | App Store ASN v2 | JWS x5c chain to the Apple root + `bundleId` |

2. `INSERT provider_events … ON CONFLICT (provider, provider_event_id) DO NOTHING`. Providers retry, so this keeps processing idempotent.
3. Normalize to canonical events (trial_started, trial_converted, renewed, cancelled, expired, billing_issue, refunded…).
4. Match devices by user ID, sticky provider IDs, or `originalTransactionId`. Update plan and status metadata.
5. `automation.evaluate` creates `automation_runs`. Each step is a pg-boss job with `startAfter`, computed in the device's time zone for "tomorrow at 10:00" waits. Every step re-checks enablement, the audience rules and the 24h ongoing-conversation suppression, and holds the run if an offer or rating can't be sent.

### 5.9 Billing

- Stripe Checkout (subscription mode, monthly and yearly prices) plus the Billing Portal.
- Webhooks `checkout.session.completed`, `customer.subscription.updated|deleted` and `invoice.payment_failed` → `organizations.sub_status`.
- A `requireActiveSubscription` middleware guards team-side writes (reply, cards, new apps, invites). SDK writes from end users are **never** gated.

---

## 6. API contract (what the SDK and dashboard build against)

All bodies are Zod-validated. Errors use `{error: {code, message}}` with stable codes (`verification_required`, `identity_changed`, `upload_incomplete`, `device_blocked`, `subscription_inactive`, …). OpenAPI is generated from `packages/contracts`, and Swift `Codable` models are generated from the OpenAPI.

**SDK `/v1`** (Bearer access token unless noted)

| Method & path | Purpose |
|---|---|
| `GET /v1/apps/:appId/appearance` | Public remote appearance, cacheable (no auth) |
| `POST /v1/devices` | Register; returns device secret + access token (App ID auth) |
| `POST /v1/session/refresh` | Device secret → new access token |
| `PATCH /v1/device` | Update details, identity, metadata, push token, available paywalls |
| `GET /v1/conversation?after=` | Sync / poll / catch-up |
| `POST /v1/messages` | Send `{clientId, text, attachmentIds}` |
| `POST /v1/uploads` | Presign a photo upload |
| `POST /v1/read` | Advance read cursor `{seq}` |
| `GET /v1/unread` | Unread count for badges |
| `POST /v1/actions/:messageId/click` | Card tap receipt (first tap wins) |
| `POST /v1/track` | App event `{event}` → `{sent, openChat}` |
| `POST /v1/session/logout` · `DELETE /v1/device` | Logout / delete data |
| `GET /v1/live` (WS) | Live stream while the chat is open (phase B6) |

**Dashboard `/api`** (session cookie, org-scoped): `orgs`, `members`, `invitations`, `apps` (+ secrets reveal/rotate), `conversations` (list with `status`/`app`/search, cursor pagination), `conversations/:id/messages` (reply, review card, offer card), `conversations/:id/{resolve,reopen}`, `devices/:id` (details, block, reset), `push-config`, `telegram`, `providers`, `automations`, `billing/{checkout,portal}`, `GET /api/live` (WS).

**Webhooks:** `/webhooks/telegram/:connectionId`, `/webhooks/revenuecat/:appId`, `/webhooks/superwall/:appId`, `/webhooks/adapty/:appId`, `/webhooks/appstore/:appId`, `/webhooks/stripe`.

---

## 7. Jobs and schedules

| Job | Trigger | Idempotency | Retry |
|---|---|---|---|
| `push.send` | agent message to a device not "In chat" | `singletonKey = messageId` | 5× exponential, then mark push issue |
| `team.notify` | user message | `singletonKey = messageId` | 5× |
| `telegram.send` | from `team.notify` | per-chat throttle | respects `retry_after` |
| `ai.consider` | user message (debounced ~8 s) | `singletonKey = conversationId` | 2× |
| `automation.evaluate` / `automation.step` | app event, provider event / scheduled | run id + step index | 3× |
| `purge.scope` | delete device/app/org | scope id | until success, alert after 10 |
| `cleanup.nightly` | cron 03:00 UTC | n/a | daily |
| `billing.sync` | Stripe webhook backstop | org id | 3× |

---

## 8. Security checklist

- [ ] Org scoping enforced in `core` (and covered by a test that tries to read another org's conversation through every dashboard route).
- [ ] All secrets encrypted at rest. Revealed in the dashboard only to admins, and every reveal or rotation is logged.
- [ ] Device secrets and invitation tokens stored hashed. Access tokens short-lived and revocable through `session_version`.
- [ ] Webhook signatures verified before parsing anything else. Raw bodies kept for HMAC checks.
- [ ] Rate limits per device, per app and per hashed IP (start in Postgres or in-process; Cloudflare rules in front).
- [ ] Upload type/size/dimension checks server-side, checksum verified, signed GETs only.
- [ ] No message bodies in logs (log IDs). PII deletion paths tested end to end.
- [ ] Backups: daily Postgres snapshots plus a monthly restore drill.

---

## 9. Phased schedule (backend only, one developer)

Each phase ends with acceptance tests that must pass in CI and on staging.

| Phase | Scope | Done when | Effort |
|---|---|---|---|
| **B0 Foundations** (done, see Status) | Monorepo, move landing page to `apps/web`, Postgres + Drizzle migrations, Hono skeleton with error envelope, `contracts` → OpenAPI, Better Auth (Google), orgs/members/invitations/apps CRUD, encryption util, pino logs + Sentry, Railway staging deploy with migrate-on-deploy, CI | A teammate signs in with Google, creates an org and an app, and sees its `app_…` ID on staging | 1 wk |
| **B1 Messaging core** (done, see Status) | Device register/refresh, conversation sync, send with seq + idempotency, read/unread, inbox list/thread/reply/resolve/block | A script acting as the SDK sends 200 concurrent messages with 20% retried `clientId`s → exactly 200 rows, seq 1–200 with no gaps; a dashboard reply shows up on the next poll | 2 wks |
| **B2 Photos** (done, see Status) | Presign, verify, signed GET, hourly cleanup | A wrong checksum is rejected; a pending upload disappears after 24h in a time-travel test | 0.5–1 wk |
| **B3 Push** (built; real-device check pending, see Status) | `.p8` upload, `push.send`, env per device, templates, badge, issue capture, "send test" | Real device gets a push in sandbox and production builds; a revoked token clears itself | 1 wk |
| **B4 Identity & deletion** (done, see Status) | `identify` labels, metadata limits, JWT verification, only-verified mode, logout/delete + `purge.scope` | JWT test vectors from the docs pass; a deleted device's rows and objects are gone | 1 wk |
| **B5 Billing** (built; real Stripe test mode pending, see Status) | Stripe Checkout/Portal/webhooks, gating middleware, founder-spot counter | Test-mode subscription toggles reply access; users can still send while lapsed | 0.5–1 wk |
| **MVP backend** | | | **≈ 6–7 wks** |
| **B6 Realtime** (done, see Status) | WS gateway, LISTEN/NOTIFY fan-out, typing, presence, skip-push-when-in-chat | Two API instances: a reply sent via instance A reaches a socket on B in < 300 ms | 1–1.5 wks |
| **B7 Cards** (done, see Status) | Review + offer cards, paywall registry from device reports, click receipts, stats | An offer card for an unreported paywall is refused; the first tap is recorded once | 1 wk |
| **B8 Telegram** (done, see Status) | Connect bot, notify, reply mapping, reactions, supergroup migration, throttle | Replying in Telegram lands in the app chat; 50 bursts respect the per-chat limit | 1.5 wks |
| **B9 Appearance & assets** | Draft/publish remote appearance, asset library (PNG ≤ 512 px), team photos | SDK fetches the published version; drafts never leak | 1 wk |
| **B10 Subscriptions + automations** | Four provider receivers, normalization, matching, automation builder API, run engine with waits, suppression, holds, results | Replaying each provider's fixture set yields the expected canonical events; a "cancelled → offer tomorrow 10:00 local" run fires at the right UTC time across 3 time zones | 3 wks |
| **B11 AI replies** | See §11 | Eval set passes the bar you set; handover never double-replies | 2–3 wks |
| **B12 Hardening** | Load test, Redis if needed, audit log, restore drill | 1,000 polling devices + 50 msgs/s holds p95 < 150 ms on staging | 1 wk |

**Totals:** MVP backend ≈ 6–7 weeks; parity without AI ≈ 4 months; with AI ≈ 4.5 months. These are backend-only numbers; the full-product estimates in the teardown (§7.2) add the SDK, React Native wrapper and dashboard UI.

### Week 1, day by day
1. Turborepo + npm workspaces; move `src/` into `apps/web`; CI (lint, typecheck, test).
2. `packages/db` with organizations/users/memberships/apps; first migration; Railway Postgres (staging).
3. `apps/api` Hono skeleton, error envelope, request IDs, health check; Better Auth with Google.
4. Org, member, invite and app routes with the `scoped(orgId)` helper and the cross-org test.
5. Encryption util + `ids_` secret generation; OpenAPI output from `contracts`; deploy to staging.

---

## 10. Testing and operations

- **Tests:** Vitest. Integration tests run against a real Postgres (Docker locally, a disposable database in CI); no mocking the database.
- **Concurrency tests** for seq/idempotency; **fixture tests** for every webhook provider (payloads copied from their docs); **contract tests** that the OpenAPI matches the routes.
- **Environments:** Railway `staging` and `production`, plus PR environments for the API. Migrations run as a pre-deploy step; every migration has to work alongside the previous app version (expand → migrate → contract).
- **Observability:** pino JSON logs, Sentry for errors, and three dashboards from day one: API latency, pg-boss queue depth and failures, push/Telegram error rates.
- **Backups:** Railway Postgres backups plus a monthly restore into staging.

---

## 11. AI replies (phase B11)

Reception markets this but its legal docs say it isn't live yet, so it's a chance to ship it first.

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`) through `@anthropic-ai/sdk`. Thinking can't be turned off on this model; control cost and latency with `output_config: { effort: "low" }` (or `"medium"`, the default) for chat replies. Pricing at the time of writing: $4 / $20 per million input / output tokens, cached reads $0.20. Evaluate a cheaper model later if the bill matters; that's a measured trade-off, not a default.
- **Knowledge without a vector database at first.** A typical indie app's help docs are small. Put the app's docs in the system prompt and mark them with prompt caching, so every reply re-reads them at the cached rate. Only once docs outgrow that (hundreds of thousands of tokens) add retrieval: pgvector in the same Postgres plus an embeddings provider. Anthropic doesn't offer an embeddings model; Voyage AI is the usual pairing.
- **Tools** via the SDK's tool runner (`client.beta.messages.toolRunner` with `betaZodTool`, reusing the Zod contracts): `reply(text)`, `send_offer(paywallId, text)`, `ask_review(text)`, `handover(reason)`. Mark them `strict: true` and use `tool_choice: auto`; forced tool choice returns a 400 on this model.
- **Guardrails live in the tool code, not the prompt.** `send_offer` only accepts paywalls the device reported as available; `ask_review` respects the repeat guard; nothing can promise refunds. If a human replies, cancel the pending `ai.consider` job and pause the AI on that conversation until handed back.
- **Refusals:** enable server-side fallbacks (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`). If the final `stop_reason` is still `refusal`, hand over to a human.
- **Debounce:** wait about 8 s after the last user message so three quick messages get one answer.
- **Before turning it on per app:** an eval set built from real resolved conversations, and adding Anthropic to your DPA's subprocessor list.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Duplicate or out-of-order messages on flaky networks | `UNIQUE(device_id, client_id)`, row-locked seq, `after=seq` catch-up, concurrency test in CI |
| Polling cost from idle installs | `/v1/unread` is index-only; back off when the chat is closed; stop polling once push works |
| APNs environment mistakes | `push_env` stored per device from the SDK; "send test" button; surface push issues in the dashboard |
| Webhook replays and ordering | Event-ID uniqueness; handlers are idempotent; state derives from the latest provider timestamp |
| Long automation waits lost on deploy | Waits are pg-boss jobs in Postgres, not timers in memory |
| Single Postgres as a bottleneck | Plenty for the first thousands of apps; the escape hatches (Redis fan-out, read replica, partitioning `messages` by month) are isolated |

---

## 13. Decisions to make before B0

1. **Hosting:** Railway (assumed above) or Cloudflare-first (Workers + Durable Objects, as the teardown suggests)? Railway is simpler to run; Cloudflare scales sockets more cheaply.
2. **Team shape:** if one person does backend and SDK, interleave B1 with the SDK's first chat screen so the contract gets exercised early.
3. **AI in v1 or later?** Shipping it first is a differentiator; it adds about 2–3 weeks.
4. **Data residency:** EU customers will ask. Pick the Railway region (and bucket region) before launch.
