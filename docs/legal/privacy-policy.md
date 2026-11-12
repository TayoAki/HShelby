> **Draft for legal review.** Not legal advice. Fill in the bracketed placeholders and have counsel review before publishing.

Effective date: [EFFECTIVE DATE]

# Privacy policy

This policy explains how [COMPANY LEGAL NAME], doing business as Hire Shelby ("Hire Shelby", "we", "us"), handles personal data when you visit hireshelby.com, sign up for or use the dashboard at app.hireshelby.com, or contact us.

Hire Shelby gives iOS app developers an in-app support chat. Our customers ("Customers") are businesses and developers who add our SDK to their apps. The people who use those apps ("app users") can write to the Customer's team from inside the app, and the team answers from our dashboard, from its own Telegram group, or with AI replies.

**The short version**

- We collect what we need to run your account and the service: your name, email address, password (stored only as a hash), workspace details, billing status and sign-in sessions.
- We use one cookie: the session cookie that keeps you signed in. No analytics, no advertising, no trackers. See the [cookie notice](./cookie-notice.md).
- We don't sell personal data, we don't share it for advertising, and we don't use Customer data to train AI models.
- App users' messages and details belong to the Customer whose app they use. We handle them only on that Customer's instructions, and the app's own privacy policy applies to them. See [section 10](#10-app-users).
- Our servers are in the United States.

## 1. Who is responsible

For the personal data described in this policy (accounts, workspaces, billing, website and dashboard visitors, and messages you send us), Hire Shelby is the controller:

[COMPANY LEGAL NAME], doing business as Hire Shelby, incorporated in [JURISDICTION OF INCORPORATION]
[COMPANY ADDRESS]
Privacy questions and requests: privacy@hireshelby.com

EU representative: [EU REPRESENTATIVE, if required]
UK representative: [UK REPRESENTATIVE, if required]

For app users' data, and for the content a Customer puts into the service (its replies, help docs, AI instructions, automations and settings), the Customer is the controller and we are its processor (a "service provider" under US state privacy laws). Our [Data Processing Addendum](./dpa.md) governs that processing.

## 2. What we collect

**Your account.** When you sign up or accept an invitation: your name, email address and password. We store the password only as a salted hash (scrypt), never the password itself. If you add a profile photo, we crop it to a 256-pixel square JPEG and drop its metadata (such as location) before storing it.

**Your workspace.** The workspace name; its members and their roles (owner, admin, member); invitations (the invited email address, the role offered, and who sent it); the apps you add and their settings. Workspace owners and admins can invite people by email and remove members; if someone invites you, we receive your email address from them. When you add an app we fill in its public App Store details (name, icon, bundle ID, App Store ID, seller name) from Apple's public App Store catalogue.

**Closed beta.** If we invite you to the closed beta, we keep your email address, the date your free access ends, a short internal note (for example, what you're building) and whether you've used the invitation. Granting and ending beta access is recorded in your workspace's audit log.

**Sign-in sessions.** For each session: a random session token, the IP address and browser user agent at sign-in, and when the session expires. The session cookie in your browser holds the token.

**Billing.** Subscriptions are paid through Stripe Checkout. Stripe collects and holds your card details and billing name, email and address; we never see full card numbers. We store the Stripe customer ID, the plan, the subscription status and the billing period dates.

**Activity in the dashboard.** Our audit log records sensitive actions in a workspace: who did what and when, such as revealing or rotating an app's identity secret, deleting an app or an app user's data, blocking a user, connecting or removing push notifications, Telegram or a subscription provider, changing AI reply settings, publishing a chat design, inviting someone, and members joining, leaving or changing roles. Entries about members include their name and email. Replies, cards, automations and settings you create are Customer content (section 10).

**Account emails.** When we send a password reset link or an invitation to a workspace, we process the recipient's email address and name and, for invitations, the inviter's name and the workspace name. A password reset link works once and for one hour, and resetting your password signs out your other sessions.

**When you contact us.** What you send us, for example an email to support@hireshelby.com, and our replies.

**Technical data.** Our servers and hosting provider process IP addresses and request details to deliver pages and API responses. For rate limiting we use a hash of the IP address, kept in memory for at most 10 minutes. Our service logs (timestamps, request IDs, errors) are kept by our hosting provider for a limited period.

**Visitors to hireshelby.com.** The website sets no cookies and runs no analytics or advertising tags. Our hosting provider processes your IP address to serve the pages.

**What we don't collect.** We don't buy data about you, and we don't use advertising identifiers, tracking pixels or third-party analytics.

## 3. Why we use it, and our lawful bases

If you're in the European Economic Area, the UK or Switzerland, these are our lawful bases under the GDPR and UK GDPR:

| Purpose | Data | Lawful basis |
|---|---|---|
| Create and run your account and workspace, sign you in, run the closed beta, and provide the service | Account, workspace, beta invitation, sessions | Performance of our contract with you (Art. 6(1)(b)). For team members invited by a Customer: our and the Customer's legitimate interests in running the workspace (Art. 6(1)(f)) |
| Billing: subscriptions, payment issues, invoices | Billing | Contract; legal obligation to keep tax and accounting records (Art. 6(1)(c)) |
| Keep the service and Customer data secure: rate limits, preventing abuse, the audit log, investigating incidents | Technical data, sessions, audit log | Legitimate interests in protecting the service, Customers and app users |
| Service emails: password resets, invitations, notices about these terms, subprocessors, security or billing | Account | Contract; legitimate interests; legal obligation where a notice is required |
| Answer your questions and support requests | Messages to us, account | Contract; legitimate interests |
| Fix and improve the service using operational data (error logs, counts of messages and requests, AI token usage and response times) | Technical data | Legitimate interests in running a reliable service |
| Comply with the law, enforce our terms, and establish or defend legal claims | As needed | Legal obligation; legitimate interests |

We don't send marketing emails today. If we start, we'll ask for your consent where the law requires it, and every marketing email will have an unsubscribe link.

Where we rely on legitimate interests, you can object (section 9). We don't make decisions about you based solely on automated processing that have legal or similarly significant effects.

## 4. What we don't do

- We don't sell personal data, and we don't "share" it for cross-context behavioural advertising (as California law defines those terms).
- We don't use analytics, advertising or tracking cookies, pixels or SDKs, on our website, in the dashboard or in our SDK.
- We don't use Customer data, app users' data or your account data to train AI models. AI replies are an optional feature a Customer turns on; requests go to Anthropic's Claude through OpenRouter, pinned to Anthropic with OpenRouter's data collection setting on "deny", and Anthropic's commercial terms don't allow it to train models on that content. See [section 10](#10-app-users).

## 5. Who we share it with

**Our subprocessors**, who run parts of the service for us under contract and only on our instructions. The current list, with what each one processes and where, is in [Annex III of the DPA](./dpa.md#annex-iii-subprocessors). For the data in this policy:

| Provider | What for | Your data involved |
|---|---|---|
| Railway Corporation (US) | Hosting: servers, database, file storage, backups | Everything we store |
| Stripe, Inc. (US) | Subscriptions and payments | Billing contact, card (held by Stripe), subscription status |
| Resend (Plus Five Five, Inc.) (US) | Sending account emails: password resets and team invitations | The recipient's email address and name, the inviter's name and the workspace name, and the link |
| OpenRouter, Inc. and Anthropic, PBC (US) | AI replies, only for apps with AI replies on | Team members' first names on their replies, when a conversation is sent to the AI |

**Other people in your workspace** see your name, email address, role and profile photo, and the replies you write.

**App users** see your first name and profile photo next to your replies if your workspace turns on "team names" or "team photos". If your workspace connects a Telegram group, replies mirrored there show the sender's name.

**Services a Customer connects.** If your workspace connects Apple's push notification service, Telegram or a subscription provider, data flows to or from those services on the workspace's behalf (see [Annex III of the DPA](./dpa.md#annex-iii-subprocessors)).

**Legal reasons.** We disclose data when the law requires it, or when it's necessary to protect the rights, safety or property of Hire Shelby, our Customers, app users or others. Where the law allows, we'll tell the affected Customer first.

**Business transfers.** If we're involved in a merger, acquisition or sale of assets, data may transfer to the new owner, who must keep honouring this policy. We'll tell you before that happens.

**With your consent**, in other cases.

## 6. How long we keep it

| Data | How long |
|---|---|
| Account (name, email, password hash) | While your account exists. Account deletion isn't self-service yet: email privacy@hireshelby.com from your account's address and we'll delete it within 30 days. You can remove your profile photo at any time in the dashboard. |
| Workspace, apps, settings, audit log | For the life of the workspace, then deleted within 30 days after the workspace is closed, as the [Terms of Service](./terms-of-service.md#13-term-termination-and-your-data) describe. |
| Closed beta invitations | While the closed beta runs; deleted when it ends, or sooner on request. |
| Invitations | An invitation expires after 48 hours. The record (invited email address, role, inviter) is kept with the workspace's history and deleted with the workspace. |
| Password reset links | Valid for one hour and usable once; the record is deleted from our database within two days of expiring. |
| Sign-in sessions | Signing out ends a session. Otherwise it expires 7 days after it was last renewed (it renews while you use the dashboard) and is deleted from our database within two days of expiring. |
| Billing records | Subscription details for the life of the workspace; payment and invoice records for as long as tax and accounting law requires. Stripe keeps its own records under its privacy policy. |
| Messages to us | As long as needed to deal with the request and for our records, then deleted. |
| Rate-limit counters (hashed IP address) | In memory only, for at most 10 minutes. |
| Service logs | A limited period set by our hosting provider. |
| Backups | Data deleted from the live systems stays in backups until they roll off, within [BACKUP RETENTION]. |

## 7. International transfers

We store data in the United States, with Railway as our hosting provider, and our other subprocessors are also in the United States. If you're in the EEA, the UK or Switzerland, your data is therefore processed in a country whose laws may not give the same protection as yours. Where the law requires a transfer mechanism, we rely on the European Commission's Standard Contractual Clauses (with the UK International Data Transfer Addendum and the Swiss adjustments where they apply), both with our Customers (see the [DPA](./dpa.md)) and with our subprocessors. You can ask us for a copy of the relevant safeguards at privacy@hireshelby.com.

## 8. Security

We protect data with measures that suit a small, focused service: TLS for connections to the service, encryption of stored credentials (APNs keys, Telegram bot tokens, identity secrets and subscription-provider secrets) with an application key, hashed passwords and device credentials, workspace isolation, role-based access, an audit log, rate limits, backups and a tested restore procedure. The [security overview](./security.md) has the details and explains how to report a vulnerability. No system is perfectly secure; if a breach affects your personal data, we'll tell you as the law requires.

## 9. Your rights

**Everyone.** You can update your name and profile photo in the dashboard at any time. For anything else, email privacy@hireshelby.com, preferably from your account's email address. We may need to confirm your identity before acting, and we won't charge you for a reasonable request.

**EEA, UK and Switzerland.** You have the right to access your personal data; correct it; have it deleted; restrict or object to our processing (including processing based on legitimate interests); receive it in a portable format; and withdraw consent where we rely on it. We'll answer within one month, which the law lets us extend by two months for complex requests. You can also complain to your local data protection authority, though we'd appreciate the chance to sort it out with you first.

**California and other US states.** To the extent the California Consumer Privacy Act (as amended by the CPRA) or a similar state law applies to us, you have the right to know what personal information we collect, use and disclose; to have it deleted; to correct it; and not to be discriminated against for using these rights. We don't sell or share personal information, so there's nothing to opt out of, and we treat a Global Privacy Control signal as a request not to sell or share. We use sensitive personal information (your account login and password) only to authenticate you, so the right to limit its use doesn't apply. You can use an authorised agent; we'll ask them for proof that you authorised them and may ask you to confirm your identity. We'll answer within 45 days, which the law lets us extend once by another 45 days.

In the last 12 months we have collected these categories of personal information, from you, your browser and Stripe, for the business purposes in section 3, and disclosed them for those purposes only to the service providers in section 5:

| Category | Examples |
|---|---|
| Identifiers | Name, email address, IP address, account and session IDs |
| Customer records | Name, billing contact details (held by Stripe) |
| Commercial information | Plan, subscription status and billing history |
| Internet or other network activity | Browser user agent, sign-in sessions, audit log entries |
| Professional information | Workspace name and your role in it |
| Audio, electronic or visual information | Your profile photo, if you add one |
| Sensitive personal information | Account login with password (stored as a hash) |

We don't collect information to infer characteristics about you.

## 10. App users

If you use an app that includes Hire Shelby's chat, the developer of that app (our Customer) decides what is collected and why, and its own privacy policy applies. We process app users' data only on the Customer's instructions, to provide the service to the Customer, under our [DPA](./dpa.md). In short:

- **What the chat handles.** Messages and photos the person sends; device details (device model, iOS version, app version, SDK version, locale and time zone); a random per-install identifier (never Apple's advertising identifier or identifier for vendors); the push notification token if the person allows notifications; and whatever identity and details the app chooses to pass: user ID, name, email address, up to 20 custom values, subscription status, the paywalls the app can show, and StoreKit purchase state. The [App Store privacy guide](./app-store-privacy-guide.md) has the full list.
- **Notifications** go through Apple's push notification service, using the Customer's own APNs key. They show what the Customer's notification template sets, usually the sender's name and a preview of the reply.
- **AI replies**, if the Customer turns them on: for each answer, the Customer's help docs and instructions, the latest 30 messages of the conversation (photos only as a placeholder), and limited details about the person (name and email if known, locale, local time, app and iOS version, device model, subscription status and available offers) are sent to Anthropic's Claude through OpenRouter. Custom values and the user ID aren't sent.
- **Telegram**, if the Customer connects its own bot: new messages (text, not photos), the person's name or user ID, and the app's name are posted to the Customer's Telegram group.
- **Deletion.** The Customer can delete a person's data from the dashboard, and an app can let people delete their own chat data from inside the app. Either way, that install's identity, details, conversations, messages and photos are removed from our live systems at once.

If you're an app user, please contact the app's developer about your data: their contact details are on the app's App Store page and in its privacy policy. If you contact us instead, we'll pass your request to the developer and help them answer it. We can't act on app users' data without the Customer's instructions, except where the law requires us to.

## 11. Children

Hire Shelby is a business service. The website and dashboard aren't directed to anyone under 16, and we don't knowingly collect personal data from them. If you believe a child has given us personal data, email privacy@hireshelby.com and we'll delete it. Apps that use our chat are the responsibility of their developers, who must not use it in apps directed to children without our written agreement (see the [Terms of Service](./terms-of-service.md)).

## 12. Changes

We'll update this policy when our practices change and change the effective date above. If a change is material, we'll tell Customers by email or in the dashboard at least 30 days before it takes effect, unless the change is required by law sooner.

## 13. Contact

Privacy questions and requests: privacy@hireshelby.com
Security reports: security@hireshelby.com
Everything else: support@hireshelby.com
Post: [COMPANY LEGAL NAME], [COMPANY ADDRESS]

Related documents: [Terms of Service](./terms-of-service.md) · [Data Processing Addendum](./dpa.md) · [Cookie notice](./cookie-notice.md) · [Security](./security.md) · [Acceptable use policy](./acceptable-use-policy.md)
