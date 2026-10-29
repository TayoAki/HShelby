# hshelby

In-app support chat for iOS apps, modelled on a study of [reception.sh](https://reception.sh). This repo holds the backend, the team dashboard, and the research behind them.

| Path | What |
|---|---|
| `apps/api` | Hono API. Better Auth (email + password, organizations, Stripe test-mode subscriptions) at `/api/auth/*`, the dashboard's org-scoped routes (apps, inbox) at `/api/*`, the SDK's at `/v1/*`, webhooks at `/webhooks/*`, and live WebSockets at `/api/live` and `/v1/live`. |
| `apps/worker` | pg-boss jobs: push delivery, Telegram posts, nightly cleanup, purging deleted apps, removing unsent photo uploads, syncing subscriptions from Stripe. |
| `apps/dashboard` | Next.js dashboard: sign-up/in, onboarding (Add app → Connect → Integrations → Subscribe), the team inbox (replies, photos, review and offer cards), app settings (push, Telegram, chat design), the asset library, account and billing. |
| `apps/web` | Landing-page clone from the study. Not deployed: it reproduces another company's brand. |
| `packages/*` | `db` (Drizzle schema + migrations), `contracts` (Zod schemas), `core` (IDs, encryption, App Store client, setup prompt), `push` (APNs client and delivery), `telegram` (Bot API client, delivery, a fake Telegram for tests), `subscriptions` (provider webhooks: verification and normalization), `storage` (S3-compatible photo storage), `billing` (subscription rules and a fake Stripe for tests), `ui` (phone and chat mock). |
| [`docs/BACKEND_PLAN.md`](docs/BACKEND_PLAN.md) | Stack, data model, API contract and phased schedule. Its Status section covers what runs on Railway staging and the variables each service needs. |
| [`docs/SUBPROCESSORS.md`](docs/SUBPROCESSORS.md), [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Who processes customer data (for the DPA); restores, the restore drill and the load test. |
| [`docs/PRODUCT_TEARDOWN.md`](docs/PRODUCT_TEARDOWN.md) | How reception works: features, SDK surface, identity flow, inferred architecture. |
| [`SITE_SPEC.md`](SITE_SPEC.md), [`preview/`](preview/) | Spec, video and screenshots of the landing-page clone. |

## Run it locally

Needs Node 22 and a Postgres you can reach (the tests default to `postgres://postgres@localhost:5433/hshelby_test`). The photo tests also need a local S3: `pip install "moto[server]" && moto_server -p 5070` (`TEST_S3_ENDPOINT`, default `http://127.0.0.1:5070`).

```bash
npm install
cp apps/api/.env.example apps/api/.env              # fill in BETTER_AUTH_SECRET and ENC_KEYS
cp apps/dashboard/.env.example apps/dashboard/.env
npm run db:migrate     # DATABASE_URL, default postgres://postgres@localhost:5433/hshelby_dev
npm run dev:api        # http://localhost:8080
npm run dev:dashboard  # http://localhost:3000
```

No iOS SDK yet? `npx tsx apps/api/scripts/sdk-sim.ts --app app_… --say "Hello" --chat` plays an app user: it registers a device, sends messages, and prints team replies from the inbox (with `--chat` it stays connected over the live WebSocket, so the dashboard shows it "In chat", and typing shows both ways). `--user-id/--name/--email` identify the user (add `--verified` with `IDENTITY_SECRET` set to sign a token), `--meta key=value` sets custom fields, `--push-token <hex>` registers for notifications so "Send test" and replies target it, `--photo path.jpg` (repeatable, with an optional `--caption`) sends photos through the upload flow, `--paywall id=Title` (repeatable) reports paywalls the team can send offers for (type `/tap` in `--chat` to tap the latest card), `--track event_name` runs the app's automations for an event (`/track` in `--chat`), `--storekit-tx ID` and `--paying` report StoreKit state for subscription matching, and `--logout` / `--delete` end the device. Photos need the `S3_*` variables (see `apps/api/.env.example`).

Checks (CI runs the same): `npm run typecheck && npm run lint && npm test && npm run build`.

Stripe runs in test mode only. Billing stays off until the four founder `STRIPE_*` variables are set (then nothing is gated), and the API and worker refuse `sk_live_` keys. The tests run billing against a fake Stripe from `@hshelby/billing/testing`, which also serves Checkout and billing-portal pages, so the whole subscribe/cancel loop works locally without a Stripe account.
