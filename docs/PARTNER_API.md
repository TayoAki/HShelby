# Partner API

App Builder (our AI app builder) includes Hire Shelby in the apps it builds: it creates a workspace for each paying
user and an app per project, keeps each workspace's state, gives the owner a one-time link to join, and reads what
AI replies cost so it can charge credits. The contract is App Builder's
[`docs/11-hire-shelby-partner.md`](https://github.com/TayoAki/TeachMeKanji/blob/main/docs/11-hire-shelby-partner.md);
this is Hire Shelby's side (`apps/api/src/routes/partner.ts`, tests in `apps/api/test/partner.test.ts`).

## Setup

- `PARTNER_API_KEY` on the api (at least 32 characters; generate it in Railway). App Builder sends the same value as
  `HIRESHELBY_PARTNER_KEY`, with `HIRESHELBY_API_URL` set to the API's URL. Without a key the routes answer 404.
- `PARTNER_NAME` (default `appbuilder`): every call only touches this partner's workspaces.
- Auth: `Authorization: Bearer <key>`, compared in constant time (401 otherwise); 300 calls a minute.

## Calls (prefix `/partner/v1`)

| Call | Body | Answer |
|---|---|---|
| `PUT /workspaces/:externalId` | `{ name, ownerEmail }` | `{ workspace }` (201 new, 200 renamed) |
| `PATCH /workspaces/:externalId` | `{ active?, aiAllowed?, ownerEmail? }` | `{ workspace }` |
| `POST /workspaces/:externalId/claim-link` | none | `{ url }` |
| `PUT /workspaces/:externalId/apps/:appExternalId` | `{ name, bundleId? }` | `{ app }` (201 new, 200 renamed) |
| `DELETE /workspaces/:externalId/apps/:appExternalId` | none | 204 (also when already deleted) |
| `GET /usage?after=<id>&limit=<1–500, default 200>` | none | `{ items, next }` |

- `workspace`: `{ externalId, active, aiAllowed, claimed, dashboardUrl }`. A new one starts active with AI allowed and
  no members; `claimed` once someone joined; `dashboardUrl` is the dashboard's origin.
- `app`: `{ externalId, appId, name }`; `appId` is the public `app_…` ID the SDK takes. Created like the dashboard's
  apps but without its subscription check. A deleted project's next PUT gets a new app.
- `claim-link`: the dashboard's URL once a member has the workspace's owner email; otherwise a new one-time link
  `/claim/<token>` for that email, valid 7 days (stored as the token's SHA-256 in `partner_claims`).
- `usage`: AI runs on the partner's apps that called the model, oldest first after `after`; each
  `{ id, workspaceExternalId, appExternalId, costUsd, createdAt }`. `costUsd` prices the run's input, output,
  cache-read and cache-write tokens with `packages/core/src/pricing.ts` (Claude Opus 5.5: $4 / $20 / $0.20 / $5 per
  million) for the model the run recorded, or the configured model for older runs. `next` is the last id returned, or
  `null` when there's nothing new. A run appears about 10 seconds after it's written, so the cursor never steps over
  a run still being saved (ids are time-ordered only to the millisecond). No message content ever leaves through this API.

Audit events: `partner.workspace.created`, `partner.workspace.updated`, `partner.app.created`, `app.deleted`.

## What a partner workspace changes

- **Billing:** it counts as subscribed exactly while `active` (before Stripe and beta access are looked at). The
  dashboard says "Included with App Builder" instead of offering Checkout; when App Builder marks it inactive, replies
  lock as in an unpaid workspace (users can still write in).
- **AI replies:** with `aiAllowed` off (out of credits), `ai.consider` returns `disabled` and the chat stops asking
  people about AI replies; the team still gets every message.
- **Joining:** the owner opens the claim link (`apps/dashboard/src/app/claim/[token]`), signs up or in with the
  address it was made for (a valid claim lets them sign up while sign-ups are invite-only, without an empty
  workspace of their own) and joins as owner (`POST /api/partner-claims/:token/accept`). A used or expired link says
  so and offers sign-in.
