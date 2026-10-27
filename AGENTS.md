# Agent notes

npm-workspaces monorepo. Node 22.

| Path | What |
|---|---|
| `apps/api` | Hono API: Better Auth at `/api/auth/*`, org-scoped `/api/*`, SDK `/v1/*` later. Tests hit a real Postgres. |
| `apps/worker` | pg-boss jobs and cron (nightly cleanup). |
| `apps/dashboard` | Next.js dashboard. Proxies `/api/*` to the API (`API_INTERNAL_URL`), so auth cookies stay first-party. |
| `apps/web` | Landing-page study clone. Not deployed (it carries another company's brand). |
| `packages/db` | Drizzle schema + SQL migrations (`npm run db:generate` after schema changes). |
| `packages/contracts` | Zod request/response schemas and error codes shared by API and dashboard. |
| `packages/core` | IDs, secret encryption, App Store client, setup-prompt template. |
| `packages/ui` | Phone frame and chat mock shared by web and dashboard. |

- Local Postgres for tests: `TEST_DATABASE_URL` (default `postgres://postgres@localhost:5433/hshelby_test`).
- Checks before pushing: `npm run typecheck && npm run lint && npm test && npm run build`.
- Plan and phases: `docs/BACKEND_PLAN.md`. Stripe runs in test mode only; the API refuses `sk_live_` keys.

The Next.js apps use Next 16, which differs from older versions: read `node_modules/next/dist/docs/` before changing Next.js code (`next dev` also writes its own `AGENTS.md` block inside each Next app).
