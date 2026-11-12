> **Draft for legal review.** Not legal advice. Fill in the bracketed placeholders and have counsel review before publishing.

Effective date: [EFFECTIVE DATE]

# Data Processing Addendum

This Data Processing Addendum ("DPA") is part of the agreement between HireShelby ("Hire Shelby", "we") and the Customer under our [Terms of Service](./terms-of-service.md) (the "Agreement"). It applies whenever we process Customer Personal Data to provide the Service, and the Customer accepts it by accepting the Agreement. A Customer that wants a countersigned copy can ask at legal@hireshelby.com.

Capitalised terms not defined here have the meaning given in the Terms of Service.

## 1. Definitions

- **Data Protection Laws**: all laws that apply to the processing of Customer Personal Data under the Agreement, including the EU General Data Protection Regulation 2016/679 ("GDPR"), the GDPR as it forms part of UK law with the UK Data Protection Act 2018 ("UK GDPR"), the Swiss Federal Act on Data Protection ("FADP"), the California Consumer Privacy Act as amended by the California Privacy Rights Act ("CCPA") and other US state privacy laws.
- **Customer Personal Data**: personal data in Customer Data that we process on the Customer's behalf: in particular End Users' data, and Team Members' names and photos as they appear in conversations.
- **Subprocessor**: a third party we engage that processes Customer Personal Data.
- **Personal Data Breach**: a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, Customer Personal Data that we process. It doesn't include unsuccessful attempts that don't compromise security, such as blocked log-in attempts, pings or port scans.
- **SCCs**: the standard contractual clauses for transfers to third countries approved by European Commission Implementing Decision (EU) 2021/914.
- **UK Addendum**: the International Data Transfer Addendum to the SCCs issued by the UK Information Commissioner under section 119A of the UK Data Protection Act 2018.
- "Controller", "processor", "data subject", "personal data" and "processing" have the meanings in the GDPR; "business", "service provider", "contractor", "sell", "share" and "business purpose" have the meanings in the CCPA.

## 2. Roles and scope

1. For Customer Personal Data, the Customer is the controller (or a processor acting for its own client) and Hire Shelby is the Customer's processor (or subprocessor) and, under US state privacy laws, its service provider.
2. Hire Shelby is an independent controller for the data it needs to run the Customer relationship: Team Members' accounts and sign-in sessions, workspace membership, billing, the audit log and support correspondence. Our [Privacy Policy](./privacy-policy.md) covers that data, and this DPA doesn't.
3. [Annex I](#annex-i-description-of-the-processing) describes the processing: subject matter, duration, nature, purpose, types of data and data subjects.

## 3. Customer's responsibilities

The Customer:

1. ensures it has a lawful basis for the processing it instructs, and gives End Users the notices and obtains the consents Data Protection Laws (and Apple's rules) require, including about AI Replies, push notifications and any Telegram group it connects (the SDK asks each End User before AI Replies answer them; the Customer reports End Users' opt-in to promotional notifications only when they gave it);
2. ensures its instructions comply with Data Protection Laws;
3. doesn't use the Service to collect special categories of personal data, data about criminal convictions, government ID numbers, payment card numbers or passwords (see [Annex I](#annex-i-description-of-the-processing), section B.3, and the [Acceptable Use Policy](./acceptable-use-policy.md));
4. is responsible for its own configuration: who has admin roles, keeping its identity secret on its server, using identity verification where its app has sign-in, and its connections to third-party services; and
5. tells us if it acts as a processor for another controller and that controller's instructions affect ours.

## 4. Processing on instructions

1. We process Customer Personal Data only on the Customer's documented instructions. The Agreement, this DPA and the Customer's use and configuration of the Service are those instructions. They include, when the Customer sets them up:
   - turning on AI Replies for an app, which instructs us to send the data in [Annex I](#annex-i-description-of-the-processing), section B.5, to the AI Subprocessors in [Annex III](#annex-iii-subprocessors);
   - uploading an APNs key, which instructs us to send push notifications through Apple's push notification service;
   - connecting a Telegram bot and group, which instructs us to post End Users' messages to that group and accept replies from it;
   - connecting a subscription provider or App Store Server Notifications, which instructs us to receive and match subscription events;
   - automations, offers, review requests, templates and other settings; and
   - deleting an End User's data, an app or the workspace.
2. Additional instructions must be in writing and consistent with the Agreement. We may charge for instructions that need work beyond the Service's normal features, after agreeing it with the Customer.
3. If the law requires us to process Customer Personal Data otherwise, we'll tell the Customer first, unless the law prohibits it.
4. We'll tell the Customer if we believe an instruction infringes Data Protection Laws. We may then decline to follow it until it's confirmed or changed.
5. Apple, Telegram, RevenueCat, Superwall, Adapty and other services the Customer connects are not our Subprocessors. They process data under their own terms with the Customer. We send data to them, or accept data from them, only on the Customer's instruction, and we aren't responsible for their processing.
6. We don't use Customer Personal Data to train AI models, and we don't use it to develop or evaluate our AI features unless the Customer asks us to in writing.

## 5. Confidentiality

We give access to Customer Personal Data only to personnel and contractors who need it to provide, secure or support the Service, or to comply with the law, and who are bound by confidentiality obligations. We look at a Customer's conversations only to provide support the Customer asks for, to investigate security incidents or abuse, or when the law requires it.

## 6. Security

1. We implement the technical and organisational measures in [Annex II](#annex-ii-security-measures), taking into account the state of the art, the cost of implementation, and the nature, scope, context and purposes of the processing and the risks to data subjects.
2. We may update these measures over time, but won't materially lower the overall level of security during the term.

## 7. Subprocessors

1. **Authorisation.** The Customer gives general authorisation for us to engage Subprocessors. The current Subprocessors are listed in [Annex III](#annex-iii-subprocessors) (the "Subprocessor List"). Some are engaged only when the Customer uses a feature: the AI Subprocessors only process data for apps with AI Replies on.
2. **Terms.** Each Subprocessor is bound by a written contract with data protection obligations that protect Customer Personal Data at least as well as this DPA does, to the extent relevant to its service, including the requirements of Article 28(3) GDPR.
3. **Notice of changes.** We update the Subprocessor List before any data goes to a new Subprocessor. We give the Customer at least 30 days' notice of a new Subprocessor, or of a Subprocessor processing Customer Personal Data in a new country, by email to the workspace's owners and by updating the Subprocessor List. Configuration changes that add a Subprocessor follow the same process, for example routing AI requests to a cloud provider other than Anthropic or using another company's AI model.
4. **Objection.** The Customer may object to a new Subprocessor on reasonable data protection grounds by emailing privacy@hireshelby.com within 30 days of our notice. We'll discuss the concern in good faith and look for an alternative, such as not using the Subprocessor for the Customer's data or the Customer not using the feature that needs it (for AI Subprocessors, keeping AI Replies off). If we can't resolve the objection within 30 days, the Customer may terminate the affected part of the Service, or the Agreement, by written notice, and we'll refund prepaid fees for the terminated part for the remaining period.
5. **Urgent replacement.** If we must replace a Subprocessor urgently (for example, because it stops its service or for security reasons), we'll give notice as soon as we can, and the Customer's right to object applies from that notice.
6. **Responsibility.** We remain responsible to the Customer for our Subprocessors' performance of their data protection obligations.

## 8. Data subject requests

1. The Service gives the Customer tools to handle End Users' requests: the inbox shows each person's conversation, photos and details; search finds people by name, email, user ID or latest message; "Delete user data" deletes a person's device record with its identity, metadata, conversations, messages and photos; and the SDK's delete function lets an app offer the same deletion to End Users in the app.
2. Deletion works per device record. If a person used the chat on several devices, or signed out and back in (which starts a new device record and keeps the old conversation), the Customer deletes each record. Subscription event records that name the person's app user ID stay until the app is deleted; we'll delete them on the Customer's request.
3. Where the tools don't cover a request, for example an export of one person's conversation, the Customer can ask us at support@hireshelby.com, and we'll give reasonable assistance, taking into account the nature of the processing.
4. If an End User sends a request to us directly, we won't answer it ourselves, except to tell them to contact the Customer. We'll pass it on to the Customer promptly, and within 5 business days, where we can identify the Customer.

## 9. Impact assessments and consultations

On request, we'll give the Customer reasonable information and assistance for its data protection impact assessments and prior consultations with supervisory authorities about the Service, in particular this DPA, its annexes, the Subprocessor List and our [security overview](./security.md).

## 10. Personal Data Breaches

1. We'll notify the Customer of a Personal Data Breach without undue delay, and in any case within 72 hours of becoming aware of it.
2. We'll send the notice to the workspace's owners by email and include, as far as we know it at the time: what happened; the categories and approximate number of data subjects and records affected; the likely consequences; the measures we've taken or propose to take; and a contact for more information. Where we can't give everything at once, we'll give it in phases without undue further delay.
3. We'll take reasonable steps to contain and investigate the breach and to reduce its effects, and reasonably help the Customer meet its own obligations to notify authorities and data subjects.
4. Our notification isn't an acknowledgement of fault or liability.

## 11. Deletion and return

1. **During the term.** The Customer can delete an End User's data at any time (section 8) and delete an app, after which the app's photos, devices, conversations, messages and subscription events are purged from our live systems, normally within 15 minutes. Photos uploaded but never sent are deleted after 24 hours.
2. **At the end.** Before the workspace is closed, and for 30 days after the Agreement ends, the Customer can ask for an export of its Customer Data in a common machine-readable format at support@hireshelby.com; we'll provide it within 30 days of the request.
3. Within 30 days after the workspace is closed or the Agreement ends (or after we provide a requested export, if later), we delete Customer Personal Data from our live systems, unless the law requires us to keep it, in which case we'll keep it confidential and process it only for that purpose.
4. Deleted data stays in our hosting provider's database backups only until they roll off, within [BACKUP RETENTION], and backups are used only to restore the Service after an incident.
5. On request, we'll confirm deletion in writing.

## 12. Audits

1. We'll make available the information reasonably necessary to demonstrate compliance with this DPA and Article 28 GDPR. We'll first do so with documentation: this DPA and its annexes, the Subprocessor List, our [security overview](./security.md), and written answers to a reasonable security questionnaire (once a year, or after a Personal Data Breach).
2. If that documentation isn't enough to demonstrate compliance, or a supervisory authority requires it, the Customer may audit our compliance itself or through an independent auditor bound by confidentiality, at the Customer's cost, with at least 30 days' written notice, during business hours, no more than once in 12 months (unless after a Personal Data Breach or at an authority's request), and within an agreed scope that doesn't give access to other customers' data or compromise security.
3. Audits of our Subprocessors are carried out through the reports and documentation they make available.
4. Audit rights under the SCCs are exercised in line with this section.

## 13. International transfers

1. We and our Subprocessors process Customer Personal Data in the United States, as the Subprocessor List shows. We'll only transfer Customer Personal Data to another country in line with this section and section 7.
2. **EEA.** Where Customer Personal Data is transferred from the European Economic Area to us in a country without an adequacy decision, the SCCs are incorporated into this DPA by reference and apply as follows:
   - Module 2 (controller to processor) applies where the Customer is a controller, and Module 3 (processor to processor) where the Customer is a processor;
   - Clause 7 (docking clause) applies;
   - Clause 9(a): Option 2 (general written authorisation), with the notice period in section 7.3 of this DPA;
   - Clause 11(a): the optional language doesn't apply;
   - Clause 13: the competent supervisory authority is set out in [Annex I](#annex-i-description-of-the-processing), section C;
   - Clause 17: Option 1, the law of [EU MEMBER STATE];
   - Clause 18(b): the courts of [EU MEMBER STATE];
   - Annexes I, II and III of the SCCs are completed by Annexes I, II and III of this DPA.
3. **United Kingdom.** For transfers from the UK, the UK Addendum is incorporated by reference: Table 1 is completed with the parties in [Annex I](#annex-i-description-of-the-processing); Table 2 with the SCC modules and options in section 13.2; Table 3 with Annexes I to III of this DPA; and in Table 4 either party may end the UK Addendum as its Section 19 allows.
4. **Switzerland.** For transfers subject to the FADP, the SCCs apply as in section 13.2 with these changes: the Swiss Federal Data Protection and Information Commissioner is the competent supervisory authority for those transfers; references to the GDPR include the FADP; and "Member State" includes Switzerland, so data subjects there can enforce their rights where they habitually reside.
5. **Onward transfers.** We transfer Customer Personal Data to Subprocessors outside the EEA, UK or Switzerland only under the SCCs (Module 3), the UK Addendum or another transfer mechanism recognised by Data Protection Laws.
6. **Government requests.** If a public authority asks us for Customer Personal Data, we'll tell the Customer unless the law prohibits it, ask the authority to go to the Customer directly, challenge requests we reasonably consider unlawful, and disclose only the minimum the request legally requires.
7. **Precedence.** If the SCCs or the UK Addendum conflict with this DPA or the Agreement, the SCCs or the UK Addendum prevail.

## 14. US state privacy laws

Where the CCPA or a similar US state privacy law applies:

1. We are the Customer's service provider (and, where relevant, contractor or processor). The Customer discloses personal information to us only for the limited and specified business purposes in [Annex I](#annex-i-description-of-the-processing), section B.6.
2. We won't sell or share the personal information; retain, use or disclose it for any purpose other than those business purposes (including any commercial purpose) or outside our direct business relationship with the Customer; or combine it with personal information we receive from or on behalf of others, or collect from our own interactions with consumers, except as those laws allow.
3. We'll comply with the obligations those laws place on us and give the personal information the same level of privacy protection they require of the Customer. We'll tell the Customer if we can no longer meet these obligations.
4. The Customer may take reasonable and appropriate steps to make sure we use the personal information consistently with its obligations (through section 12), and, on notice, to stop and remedy unauthorised use.
5. Our Subprocessors are bound by written contracts with the same restrictions.
6. We certify that we understand and will comply with the restrictions in this section.

## 15. Liability

Each party's liability under this DPA, including under the SCCs to the extent the law allows, is subject to the limitations and exclusions in the Agreement. Nothing in this DPA limits a data subject's rights under the SCCs.

## 16. Term and precedence

This DPA applies for as long as we process Customer Personal Data, including after the Agreement ends. If this DPA conflicts with the Terms of Service on the processing of personal data, this DPA prevails (subject to section 13.7). We update this DPA in the same way as the Terms of Service, and won't reduce the protection it gives without at least 30 days' notice.

Contact for this DPA: privacy@hireshelby.com

---

## Annex I: Description of the processing

### A. Parties

**Data exporter**: the Customer, as identified in its workspace and billing details. Contact: the workspace's owners. Role: controller (Module 2) or processor (Module 3). Activities: using the Service to run an in-app support chat for its iOS apps. Signature and date: by accepting the Agreement.

**Data importer**: HireShelby, [COMPANY ADDRESS]. Contact: privacy@hireshelby.com. EU representative: [EU REPRESENTATIVE, if required]. UK representative: [UK REPRESENTATIVE, if required]. Role: processor (Module 2) or subprocessor (Module 3). Activities: providing the Service. Signature and date: by accepting the Agreement.

### B. Description of the processing and transfer

**B.1 Data subjects**

- End Users: people whose installs of the Customer's apps connect to the Service through the SDK, whether or not they write to the Customer (automations can message people who haven't written).
- The Customer's Team Members, as the authors of replies shown to End Users and in conversations.
- People mentioned in messages, photos, help docs or AI instructions.

**B.2 Categories of personal data**

| Category | What | Where it comes from |
|---|---|---|
| Identity (optional) | The app's user ID, name and email address, sent as labels or verified with an identity token signed by the Customer's server (we keep the accepted claims, not the token); whether the person is verified | The Customer's app |
| Device details | Device model, iOS version, app version, SDK version, locale and time zone | The SDK |
| Install identifier and credential | A random ID for each install's record and a hash of its device credential (the credential stays in the device's Keychain). Never Apple's advertising identifier (IDFA) or identifier for vendors (IDFV) | The Service and the SDK |
| Push notifications | The APNs device token and environment, and the last delivery problem Apple reported | The SDK and Apple |
| Messages | Text (up to 4,000 characters per message), time, sender (End User, teammate, automation or AI), read state | End Users and the Customer's team |
| Photos | JPEG or PNG images, up to 1 MiB and 2,048 pixels, up to 4 per message, with their size, dimensions and checksum | End Users and the Customer's team |
| Custom metadata | Up to 20 string values the app sets (keys up to 64 characters, values up to 512), including subscription-provider customer IDs | The Customer's app |
| Purchases and subscriptions | StoreKit paying state and original transaction IDs (up to 50); subscription status, product and expiry; subscription event records (provider, event, product, the app user ID, environment) | The SDK; subscription providers and App Store Server Notifications the Customer connects |
| Offers and reviews | Paywalls the app reports it can show (IDs, titles, products, prices, periods, trials); offers and review requests sent; the time of the first tap on each | The SDK and the Customer |
| Activity | Last seen, whether the chat is open, unread counts, events the app tracks for automations, automation runs, when a review was last requested, blocked and signed-out status | The SDK and the Service |
| AI run records | For each AI turn: outcome, actions taken, refused tool calls, handover reason, token counts and response time | The Service |
| Team Members in conversations | Names on replies; first names and profile photos shown to End Users if the Customer turns on team names or photos | The Customer |
| Customer content | Help docs, AI instructions, templates and automations, to the extent they contain personal data | The Customer |

We don't store End Users' IP addresses: a hash of the address is kept in memory for at most 10 minutes for rate limiting. Typing indicators are relayed and never stored.

**B.3 Special categories of data**

None intended. The Customer must not ask for or send special categories of data (such as health data), data about criminal convictions, government ID numbers, payment card numbers or passwords as identity fields, custom metadata, help docs or AI instructions. End Users may still volunteer such data in a message or photo; the Service treats every message the same way, under the measures in Annex II. The Service isn't designed for apps directed to children (see the Terms of Service).

**B.4 Frequency**

Continuous, for as long as the Customer uses the Service.

**B.5 Nature of the processing**

Collecting data from the SDK; storing and hosting it; showing it to the Customer's team in the dashboard; delivering messages in real time; sending push notifications through Apple's push notification service; posting to the Customer's Telegram group if connected; receiving and matching subscription events; running the Customer's automations; generating AI Replies if turned on; and deleting data.

For AI Replies, each turn sends the AI Subprocessors: the AI's rules, the Customer's instructions (up to 4,000 characters) and help docs (up to 200,000 characters); the latest 30 messages of the conversation (each cut to 2,000 characters, with photos and cards as placeholders and teammates' first names on their replies); and the person's name and email if known, whether they're verified, locale, local time and time zone, app and iOS version, device model, subscription status, product and expiry, the offers their device can show and whether a rating request is available. Custom metadata, the user ID and photos aren't sent. The AI is limited to 4 model calls per turn and hands the conversation to the team after 30 AI messages in a day.

**B.6 Purpose**

To provide the Service to the Customer under the Agreement and its instructions: in-app support conversations between End Users and the Customer's team, notifications, cards, automations and AI Replies; to secure the Service and prevent abuse; and to give support the Customer asks for.

**B.7 Retention**

For the term of the Agreement, until the Customer deletes the data, as follows:

- An End User's data: until the Customer deletes it in the dashboard, the app deletes it through the SDK, or the app or workspace is deleted.
- Photos uploaded but never sent: 24 hours.
- Push tokens: replaced or cleared when the app reports a new one or turns notifications off, when the End User signs out, or when Apple reports the token invalid.
- A deleted app's data: purged from live systems, normally within 15 minutes.
- At the end of the Agreement: deleted within 30 days (section 11).
- Backups: until they roll off, within [BACKUP RETENTION].

Data the Customer's own services already received (such as posts in its Telegram group, or notifications delivered to devices) is outside our systems and isn't affected by these deletions.

**B.8 Transfers to Subprocessors**

As listed in Annex III, for the subject matter, nature and duration described in this Annex.

### C. Competent supervisory authority

Under Clause 13 of the SCCs: where the Customer is established in an EU Member State, the supervisory authority of that Member State; where it isn't but has appointed a representative under Article 27(1) GDPR, the supervisory authority of the Member State where the representative is established; otherwise, the supervisory authority of the Member State where the End Users whose data is transferred are located. For the UK, the Information Commissioner's Office; for Switzerland, the Federal Data Protection and Information Commissioner.

---

## Annex II: Security measures

The technical and organisational measures we apply to Customer Personal Data. Our [security overview](./security.md) describes them in plain terms.

**Encryption**
- Connections to the dashboard, API and SDK endpoints use HTTPS (TLS). Traffic between our services stays on our hosting provider's private network.
- Credentials the Customer gives us (APNs keys, Telegram bot tokens, app identity secrets and subscription-provider secrets) are encrypted at rest with AES-256-GCM under a versioned application key (`ENC_KEYS`) held only in our hosting environment, never in source code. APNs keys and Telegram bot tokens are never shown again after upload.
- Team Members' passwords are stored only as salted scrypt hashes. Device credentials and webhook secret tokens are stored only as SHA-256 hashes.

**Access control: Customer side**
- Every workspace's data is separated by workspace, and every dashboard request is checked against the signed-in person's current membership and role.
- Roles: owners and admins manage apps, secrets, integrations, AI Replies, automations, members and billing, and can delete data; members work in the inbox.
- Dashboard sessions use a first-party, HttpOnly, Secure, SameSite=Lax cookie. Resetting a password signs out the account's other sessions. Live connections are accepted only from the dashboard's own origin and are re-checked at least hourly.
- SDK access tokens last 15 minutes and are revoked at once when a device signs out or is deleted. Customers can require identity verification (tokens signed by their own server) and allow only verified users to send messages.

**Access control: our side**
- Access to production systems (hosting, database, storage and secrets) is limited to the personnel who operate the Service and need it.
- Secrets are configured in the hosting environment only, never committed to source code.

**Audit log**
- Sensitive actions in a workspace are recorded with who did them and when, and owners and admins can review them: revealing or rotating identity secrets, deleting apps and End Users' data, blocking users, push, Telegram and subscription-provider changes, AI Replies settings and knowledge changes, published chat designs, invitations, member and role changes, and automations.

**Input handling**
- All requests are validated against strict schemas with size limits.
- Photos are uploaded directly to private storage with short-lived links bound to the declared type, size and checksum; before a photo is attached to a message, the server reads it back and checks its size, checksum, file signature and dimensions. Photos are served only through links that expire after 15 minutes.
- Image library uploads are checked by content and converted; SVGs with scripts, external references or embedded objects are refused.
- Inbound webhooks are verified before they're processed: Apple's signature chain for App Store Server Notifications, HMAC signatures for Superwall and Stripe, and secret values compared in constant time for RevenueCat, Adapty and Telegram. Redelivered events are ignored.

**Abuse prevention**
- Rate limits per address (using a hash of the IP address), per device, per app and per webhook URL, including limits on registrations, messages, photo uploads and tracked events.
- Customers can block End Users.

**AI Replies**
- Off by default, turned on per app by an admin.
- Even then, the chat asks each End User first, naming the AI providers; nothing of an End User's reaches the AI until they allow it, and they can turn it off in the chat at any time. The choice and its time are recorded.
- Requests go to Anthropic's Claude, through OpenRouter pinned to Anthropic with no fallback to other providers and data collection denied, or directly to Anthropic.
- Each turn sends only the data listed in Annex I, section B.5. The model's actions are limited to four tools, and guardrails in code check them: offers only for paywalls the device reported, limits on rating requests, a block on promising refunds, at most one message per turn, and no reply once a teammate has answered. The AI is instructed never to claim to be human and to say it's an AI assistant when asked.

**Availability and recovery**
- The database is backed up with our hosting provider's volume backups and point-in-time recovery. We test restoring a backup monthly and keep a written restore procedure.
- Background work (notifications, Telegram posts, automations, AI Replies) runs as durable jobs that retry after failures.

**Data minimisation and deletion**
- The SDK sends only the details listed in Annex I. Precise location, contacts and advertising identifiers aren't collected.
- Team Members' profile photos are re-encoded with metadata removed; the dashboard re-encodes photos teammates send, removing metadata.
- Deletion paths: per End User (dashboard and SDK), per app (purged by a background job), unsent photos after 24 hours, expired sessions and password reset links within two days of expiring.

**Development and change management**
- Code is kept in version control. Every change to the main branch runs automated type checks, linting, tests (including tests against a real Postgres database) and a build. Staging and production are separate environments.

**Subprocessors**
- Engaged under written contracts with data protection obligations (DPA section 7), and changed only through the notice process there.

**Incidents**
- We investigate suspected incidents, contain them, and notify Customers as DPA section 10 requires.

---

## Annex III: Subprocessors

This list mirrors our internal subprocessor register. We update it before any data goes to a new Subprocessor and give notice as [section 7](#7-subprocessors) describes.

| Subprocessor | Purpose | Personal data | Location | When |
|---|---|---|---|---|
| Railway Corporation | Hosting: API, background worker, dashboard, Postgres database, photo storage, backups | Everything the Service stores: team accounts (names, emails, password hashes, sessions), End Users' messages and photos, the device, identity and custom fields the app sends, push tokens, the audit log | United States | Always |
| OpenRouter, Inc. | Passes AI Reply requests to the model | Per AI turn: the app's help docs and the team's instructions; the person's latest 30 messages (photos only as a placeholder) and Team Members' first names on their replies; the person's name and email if the app sends them, locale, local time, app and iOS version, device model, subscription status, the offers their device reported | United States | Only for apps with AI Replies on. Requests are pinned to Anthropic, with no fallback to other providers and data collection denied |
| Anthropic, PBC | Runs Claude, which writes the AI Replies | Same as OpenRouter | United States | Only for apps with AI Replies on: through OpenRouter today, or directly |
| Resend (Plus Five Five, Inc.) | Account email: password resets and team invitations | The recipient's email address and name, the inviter's name and the workspace name, and the link | United States | When account emails are sent |
| Stripe, Inc. | Workspace subscriptions | The workspace's billing contact: name, email, billing address, card (held by Stripe), subscription status. No End Users' data | United States | Workspaces that subscribe |

Resend and Stripe process data Hire Shelby controls (account and billing data) rather than End Users' data; they're listed for completeness.

**Services the Customer connects.** Not our Subprocessors: the Customer chooses them, and data flows through them on its instruction once it sets them up (section 4.5).

| Service | When | Data |
|---|---|---|
| Apple Push Notification service | The Customer uploads an APNs key | The device's push token and each notification (title and a preview of the reply, from the app's notification template) |
| Telegram | The Customer connects its own bot | New messages, replies and handovers posted to the Customer's chat, with the person's name and app details. Photos aren't forwarded |
| RevenueCat, Superwall, Adapty, App Store Server Notifications | The Customer connects one | They send us subscription events (app user ID, product, status); we send them nothing |

**Not in use.** We don't use error-tracking, analytics or uptime-monitoring services that receive Customer Personal Data. If we add one, it goes through the notice process in section 7.

**Changes that trigger notice.** Among others: adding an AI provider (for example, allowing requests to be served by a cloud provider other than Anthropic, or using another company's AI model); and moving hosting or photo storage to a new country.
