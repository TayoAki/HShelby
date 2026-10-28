# hshelby

In-app support chat for iOS apps, modelled on a study of [reception.sh](https://reception.sh). This repo holds the backend, the team dashboard, and the research behind them.

| Path | What |
|---|---|
| `apps/api` | Hono API. Better Auth (email + password, organizations, Stripe test-mode subscriptions) at `/api/auth/*`, the dashboard's org-scoped routes (apps, inbox) at `/api/*`, the SDK's at `/v1/*`. |
| `apps/worker` | pg-boss jobs: push delivery, nightly cleanup, purging deleted apps. |
| `apps/dashboard` | Next.js dashboard: sign-up/in, onboarding (Add app → Connect → Integrations → Subscribe), and the team inbox. |
| `apps/web` | Landing-page clone from the study. Not deployed: it reproduces another company's brand. |
| `packages/*` | `db` (Drizzle schema + migrations), `contracts` (Zod schemas), `core` (IDs, encryption, App Store client, setup prompt), `push` (APNs client and delivery), `ui` (phone and chat mock). |
| [`docs/BACKEND_PLAN.md`](docs/BACKEND_PLAN.md) | Stack, data model, API contract and phased schedule. Its Status section covers what runs on Railway staging and the variables each service needs. |
| [`docs/PRODUCT_TEARDOWN.md`](docs/PRODUCT_TEARDOWN.md) | How reception works: features, SDK surface, identity flow, inferred architecture. |
| [`SITE_SPEC.md`](SITE_SPEC.md), [`preview/`](preview/) | Spec, video and screenshots of the landing-page clone. |

## Run it locally

Needs Node 22 and a Postgres you can reach (the tests default to `postgres://postgres@localhost:5433/hshelby_test`).

```bash
npm install
cp apps/api/.env.example apps/api/.env              # fill in BETTER_AUTH_SECRET and ENC_KEYS
cp apps/dashboard/.env.example apps/dashboard/.env
npm run db:migrate     # DATABASE_URL, default postgres://postgres@localhost:5433/hshelby_dev
npm run dev:api        # http://localhost:8080
npm run dev:dashboard  # http://localhost:3000
```

No iOS SDK yet? `npx tsx apps/api/scripts/sdk-sim.ts --app app_… --say "Hello" --chat` plays an app user: it registers a device, sends messages, and prints team replies from the inbox. `--user-id/--name/--email` identify the user (add `--verified` with `IDENTITY_SECRET` set to sign a token), `--meta key=value` sets custom fields, `--push-token <hex>` registers for notifications so "Send test" and replies target it, and `--logout` / `--delete` end the device.

Checks (CI runs the same): `npm run typecheck && npm run lint && npm test && npm run build`.

Stripe runs in test mode only. Billing stays off until all four `STRIPE_*` variables are set, and the API refuses `sk_live_` keys.
