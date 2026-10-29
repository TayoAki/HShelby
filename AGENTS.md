# Agent notes

npm-workspaces monorepo. Node 22.

| Path | What |
|---|---|
| `apps/api` | Hono API: Better Auth at `/api/auth/*`, org-scoped `/api/*`, SDK `/v1/*`, webhooks `/webhooks/*` (Telegram, subscription providers), automation and AI-reply jobs (`ai.consider`, Claude via `@anthropic-ai/sdk`; tests use the fake in `test/fake-anthropic.ts`), live WebSockets at `/api/live` and `/v1/live` (fan-out with Postgres LISTEN/NOTIFY). `src/server.ts` starts HTTP and the gateway together. Tests hit a real Postgres. |
| `apps/worker` | pg-boss jobs: `push.send`, `team.notify` → `telegram.send`, nightly cleanup, deleted-app purge, hourly unsent-upload sweep, hourly `billing.sync`. Needs `DATABASE_URL` and `ENC_KEYS`; `S3_*` for photos, `STRIPE_SECRET_KEY` for the billing sync. |
| `apps/dashboard` | Next.js dashboard. Proxies `/api/*` to the API (`API_INTERNAL_URL`), so auth cookies stay first-party. |
| `apps/web` | Landing-page study clone. Not deployed (it carries another company's brand). |
| `packages/db` | Drizzle schema + SQL migrations (`npm run db:generate` after schema changes). |
| `packages/contracts` | Zod request/response schemas and error codes shared by API and dashboard. |
| `packages/core` | IDs, secret encryption, App Store client, setup-prompt template. |
| `packages/push` | APNs client, notification content and delivery (shared by API "Send test" and the worker); `@hshelby/push/testing` has a fake APNs. |
| `packages/subscriptions` | RevenueCat, Superwall, Adapty and App Store Server Notifications v2: verification (incl. Apple's JWS chain) and normalization to ten canonical events; `@hshelby/subscriptions/testing` has fixtures and an App Store signer. |
| `packages/telegram` | Telegram Bot API client, notification/mirror formatting, per-chat pacing and delivery (shared by API and worker); `@hshelby/telegram/testing` has a fake Bot API. |
| `packages/storage` | S3-compatible photo storage (presigned PUT/GET, prefix deletes) and JPEG/PNG header checks; `@hshelby/storage/convert` converts library images and profile photos with sharp (API only); `@hshelby/storage/testing` makes a bucket on the test S3. |
| `packages/billing` | Subscription status rules (what counts as paying), founder-spot count, Stripe→row mapping; `@hshelby/billing/testing` has a fake Stripe (API, signed webhooks, Checkout and portal pages). |
| `packages/ui` | Phone frame and chat mock shared by web and dashboard. |

- Local Postgres for tests: `TEST_DATABASE_URL` (default `postgres://postgres@localhost:5433/hshelby_test`).
- Local S3 for photo tests: `TEST_S3_ENDPOINT` (default `http://127.0.0.1:5070`); run `pip install "moto[server]" && moto_server -p 5070`.
- Checks before pushing: `npm run typecheck && npm run lint && npm test && npm run build`.
- Railway redeploys a service only when its watch patterns match the change. When an app gains a workspace dependency, add that package's path to the service's watch patterns (see `docs/BACKEND_PLAN.md` Status).
- AI replies eval (real model, needs `ANTHROPIC_API_KEY`): `npm run eval -w @hshelby/api`. Not part of `npm test`.
- Plan and phases: `docs/BACKEND_PLAN.md`. Stripe runs in test mode only; the API refuses `sk_live_` keys.
- Restores, the monthly restore drill and the load test: `docs/RUNBOOK.md`. The API's rate limits scale with `RATE_LIMIT_SCALE` (tests set `0`); a load test from one machine needs it raised on the api.

The Next.js apps use Next 16, which differs from older versions: read `node_modules/next/dist/docs/` before changing Next.js code (`next dev` also writes its own `AGENTS.md` block inside each Next app).
