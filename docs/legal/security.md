> **Draft for legal review.** Not legal advice. Fill in the bracketed placeholders and have counsel review before publishing.

Effective date: [EFFECTIVE DATE]

# Security at Hire Shelby

Hire Shelby carries conversations between app developers and the people who use their apps, so we keep the design simple and the data we hold small. This page describes what we do today. We don't hold security certifications such as SOC 2 or ISO 27001, and we haven't had an independent penetration test yet; when that changes, we'll update this page.

The formal version of these measures is [Annex II of our DPA](./dpa.md#annex-ii-security-measures).

## Infrastructure

- The API, background worker, dashboard, database and photo storage run on Railway, in the United States. Our full list of subprocessors is in [Annex III of the DPA](./dpa.md#annex-iii-subprocessors).
- Connections to the dashboard, API and SDK endpoints use HTTPS (TLS). Traffic between our services stays on the hosting provider's private network.
- Photo storage is private: photos are uploaded and viewed only through short-lived signed links (15 minutes).
- Secrets live in the hosting environment's configuration, never in source code.

## Protecting your data

- **Workspace isolation.** Every workspace's data is kept apart, and every dashboard request is checked against the person's current membership and role.
- **Encryption of credentials.** APNs keys, Telegram bot tokens, app identity secrets and subscription-provider secrets are encrypted at rest with AES-256-GCM under a versioned application key. APNs keys and Telegram bot tokens are never shown again after you upload them.
- **Passwords and device credentials.** Passwords are stored only as salted scrypt hashes. The SDK's device credential stays in the iOS Keychain; we store only its SHA-256 hash.
- **Short-lived access.** SDK access tokens last 15 minutes and stop working at once when a device signs out or its data is deleted. Live connections are rechecked at least every hour.
- **Data we don't collect.** The SDK doesn't collect precise location, contacts or advertising identifiers. We don't store End Users' IP addresses; rate limiting uses a hash kept in memory for at most 10 minutes.
- **Deletion.** You can delete a person's data from the dashboard or let them do it from your app; deleting an app purges its data from our live systems, normally within 15 minutes. Photos that were uploaded but never sent are deleted after 24 hours.

## Accounts and access

- Dashboard sign-in uses email and password (at least 10 characters). Sessions use a single first-party cookie that scripts can't read (see the [cookie notice](./cookie-notice.md)). Resetting a password signs out your other sessions. Two-factor authentication isn't available yet.
- Roles: owners and admins manage apps, secrets, integrations, AI Replies, members and billing, and can delete data; members work in the inbox.
- The audit log records sensitive actions, such as revealing or rotating secrets, deleting data, changing integrations or AI settings and changing members' roles, with who did them and when.
- Inside Hire Shelby, access to production systems is limited to the people who operate the service.

## Checking what comes in

- Every request is validated against strict schemas and size limits.
- Photos are checked on the server (size, checksum, file type and dimensions) before they're attached to a message. Uploaded images for chat designs are converted, and unsafe SVGs are refused.
- Webhooks are verified before they're processed: Apple's certificate chain for App Store Server Notifications, signatures for Superwall and Stripe, and secret values for RevenueCat, Adapty and Telegram.
- Rate limits apply per address, device, app and webhook, including on registrations, messages, photo uploads and tracked events.

## AI Replies

- Off by default and turned on per app by an admin.
- Requests go to Anthropic's Claude through OpenRouter, pinned to Anthropic with no fallback to other providers and with data collection denied. We don't use your data to train AI models.
- Each answer sends only what it needs: your docs and instructions, the latest 30 messages (photos aren't sent), and a few facts about the person. Custom metadata and user IDs aren't sent. The [DPA](./dpa.md) lists exactly what goes.
- Guardrails in code check what the AI does: it can only offer paywalls the person's device reported, it's limited in asking for ratings, it can't promise refunds, it stops when a teammate replies, and it hands over to your team when unsure or after 30 AI messages in a day.

## Reliability and recovery

- The database is backed up with volume backups and point-in-time recovery. We test restoring a backup every month and keep a written restore procedure.
- Notifications, Telegram posts, automations and AI Replies run as durable background jobs that retry after failures.
- Every change to our code runs automated type checks, linting, tests against a real database, and a build. Staging and production are separate.

## Incidents

If a security incident affects your data, we'll tell your workspace's owners without undue delay, and within 72 hours of becoming aware of it, as our [DPA](./dpa.md) describes.

## Your part

- Use identity verification if your app has sign-in, keep the identity secret on your server (never in the app), and consider allowing only verified users to send messages.
- Give admin roles only to people who need them, and remove people who leave.
- Rotate secrets if you think they've leaked, and review the audit log.
- Control who is in any Telegram group you connect, since your users' messages are posted there.
- Turn off notification previews if your conversations may be sensitive.

## Reporting a vulnerability

If you think you've found a security vulnerability in Hire Shelby, please email **security@hireshelby.com**. Include what you found, where (URL, endpoint or SDK version), steps to reproduce, and the impact you expect. Please don't include real people's personal data.

We'll acknowledge your report within 3 business days, keep you updated, and tell you when it's fixed. We don't run a paid bug bounty, but we're glad to credit you if you'd like.

If you act in good faith and follow these rules, we won't take legal action against you for your research:

- Test only against your own account and workspace, and don't access, change or delete other people's data. If you come across someone else's data, stop and tell us.
- Don't run denial-of-service tests, flood the service, send spam, or use social engineering or physical attacks.
- Don't test third-party services we use (such as Railway, Stripe, OpenRouter, Anthropic, Apple or Telegram); report issues in those to them.
- Give us reasonable time to fix the issue before telling anyone else.

In scope: hireshelby.com, the dashboard at app.hireshelby.com, our API and our SDK.

Questions about security: security@hireshelby.com.
