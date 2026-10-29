# Subprocessors

The third parties that process personal data for a workspace (our customer) and its app's users, what each one does, and where. The DPA refers to this list. It's a working draft: have counsel review it, and the DPA itself, before beta testers sign up. Add a subprocessor here, and tell customers, before any data goes to it.

Last updated: 2026-10-29

## Subprocessors

| Subprocessor | Purpose | Personal data | Location | When |
|---|---|---|---|---|
| **Railway Corporation** | Hosting: API, worker, dashboard, Postgres database, photo storage, backups | Everything the service stores: team accounts (names, emails, password hashes, sessions), app users' messages and photos, the device, identity and custom fields the app sends, push tokens, the audit log | United States (staging runs in Railway's US West region; choose production's before launch) | Always |
| **OpenRouter, Inc.** | Passes AI-reply requests to the model | Per AI turn: the app's docs and the team's instructions; the person's latest 30 messages (photos only as a placeholder) and team members' first names on their replies; the person's name and email if the app sends them, locale, local time, app and iOS version, device model, subscription status, the offers their device reported | United States | Only for apps with AI replies on. Requests are pinned to Anthropic, with no fallback to other providers and data collection denied (`OPENROUTER_PROVIDERS`, `apps/api/src/ai/provider.ts`) |
| **Anthropic, PBC** | Runs Claude, which writes the AI replies | Same as OpenRouter | United States | Only for apps with AI replies on: through OpenRouter today, directly once `ANTHROPIC_API_KEY` is set |
| **Stripe, Inc.** | Workspace subscriptions | The workspace's billing contact: name, email, billing address, card (held by Stripe), subscription status. No app users' data | United States | Workspaces that subscribe |

## Services a team connects

Not chosen by us, but data leaves through them once a team sets them up:

| Service | When | Data |
|---|---|---|
| Apple Push Notification service | The team uploads an APNs key | The device's push token and each notification (title and a preview of the reply, from the app's push template) |
| Telegram | The team connects its own bot | New messages, replies and handovers posted to the team's chat, with the person's name and app details |
| RevenueCat, Superwall, Adapty, App Store Server Notifications | The team connects one | They send us subscription events (app user ID, product, status); we send them nothing |

## Not in use yet

- **Email delivery:** none. Invitations aren't emailed and there's no password reset email yet; add the provider here when one is chosen.
- **Error tracking, analytics, uptime monitoring:** none.

## When this list changes

- An `ANTHROPIC_API_KEY` on the api: AI replies go to Anthropic directly; remove OpenRouter.
- `OPENROUTER_PROVIDERS` widened (for example `google-vertex`, `amazon-bedrock`, `azure`): add Google, Amazon or Microsoft first.
- `AI_MODEL` set to another company's model: add that company first.
- A new region for production or the photo bucket: update Location.
