> **Draft for legal review.** Not legal advice. Fill in the bracketed placeholders and have counsel review before publishing.

Effective date: [EFFECTIVE DATE]

# Legal and privacy documents

Drafts of Hire Shelby's public legal documents. They describe the service as built in this repository; the facts come from [`../SUBPROCESSORS.md`](../SUBPROCESSORS.md), [`../BACKEND_PLAN.md`](../BACKEND_PLAN.md), [`../RUNBOOK.md`](../RUNBOOK.md) and the code. When the product changes what it collects, where data goes or how long it's kept, update these too.

## Documents

| Document | What it is |
|---|---|
| [Privacy Policy](./privacy-policy.md) | How Hire Shelby handles personal data as a controller (Customer accounts, billing, website and dashboard visitors), and a summary of how app users' data is handled on Customers' behalf. |
| [Terms of Service](./terms-of-service.md) | The B2B agreement: accounts, the service, the free beta, billing, Customers' responsibilities for their app users, AI Replies, data, liability. |
| [Data Processing Addendum](./dpa.md) | GDPR Art. 28, UK GDPR and CCPA service-provider terms, with Annex I (the processing), Annex II (security measures) and Annex III (subprocessors). |
| [Acceptable Use Policy](./acceptable-use-policy.md) | What Customers and their apps may not do with the service. |
| [Cookie notice](./cookie-notice.md) | The one strictly necessary session cookie, and what we don't use. |
| [Security](./security.md) | Public security overview and how to report a vulnerability. |
| [End-user privacy template](./end-user-privacy-template.md) | Text Customers adapt for their own app's privacy policy, describing the support chat. |
| [App Store privacy guide](./app-store-privacy-guide.md) | How Customers answer App Store Connect's App Privacy questions when they embed the SDK. |

## Placeholders

| Placeholder | What goes there |
|---|---|
| `[EFFECTIVE DATE]` | The date each document takes effect (the same date across the set when first published). |
| `[COMPANY ADDRESS]` | Registered postal address. |
| `[JURISDICTION OF INCORPORATION]` | Where the entity is incorporated. |
| `[GOVERNING LAW]` | Law governing the Terms (and the DPA, except the SCCs). |
| `[VENUE]` | Courts with exclusive jurisdiction under the Terms. |
| `[EU REPRESENTATIVE, if required]` | Art. 27 GDPR representative, if the entity is outside the EU and needs one; otherwise remove the line. |
| `[UK REPRESENTATIVE, if required]` | Art. 27 UK GDPR representative, likewise. |
| `[EU MEMBER STATE]` | The EU Member State whose law governs the SCCs (Clause 17) and whose courts hear disputes (Clause 18), for example Ireland. |
| `[BACKUP RETENTION]` | How long deleted data can stay in backups. It follows the production backup settings in [`../RUNBOOK.md`](../RUNBOOK.md): about 1 month with daily and weekly volume backups and point-in-time recovery (weekly kept a month, recovery window about 4 weeks); 3 months if monthly backups are also on. |
| `[MINIMUM LIABILITY CAP]` | The floor of the Terms' liability cap (matters during the free beta, when no fees are paid). |
| `[SUBPROCESSOR LIST URL]` | Where the subprocessor list is published (Annex III of the DPA on hireshelby.com), for the end-user template. |

The contracting entity is named **HireShelby** throughout; the product is "Hire Shelby". If the registered name carries a suffix (LLC, Inc., Ltd), add it wherever HireShelby names the entity (the opening of each document, the DPA's data importer and the contact addresses).

Fields in curly braces (`{App name}`) in the end-user template are for Customers to fill in, not us.

Mailboxes used: privacy@hireshelby.com, legal@hireshelby.com, security@hireshelby.com, support@hireshelby.com. No personal addresses.

## Before publishing

**Legal**

- [ ] Counsel reviews every document, in particular: the liability cap and indemnities (the Terms give an IP indemnity for paid subscriptions only), the SCC clause choices and whether the entity's location changes them (an EEA-based entity doesn't need Module 2 for its own import), US state law thresholds, the AI Act and Apple's third-party-AI consent rule as they apply to AI Replies, the kids'-apps restriction, and the click-through: sign-up says "By creating an account you agree to…"; decide whether that's enough or a checkbox is needed, and link the DPA and AUP from it too.
- [ ] Entity details filled in: address, jurisdiction, governing law, venue, SCC Member State, representatives (or lines removed); the legal name is HireShelby (add its suffix if it has one).
- [ ] Signed DPAs (with SCCs where needed) in place with Railway, OpenRouter, Anthropic, Resend and Stripe, and their terms checked against what the documents say (no training on our data; OpenRouter's "deny data collection" routing).

**Operations**

- [ ] The four mailboxes exist, are monitored, and reach someone who can act within the times the documents promise (privacy and data subject requests within a month; breach notices within 72 hours; vulnerability reports acknowledged within 3 business days).
- [ ] Production region chosen and still in the United States, as the documents say (update them otherwise).
- [ ] Production volume backups and point-in-time recovery switched on, `[BACKUP RETENTION]` filled in to match, and the monthly restore drill kept up (the security page says we do it).
- [ ] Two-factor authentication on the accounts that reach production data (Railway, GitHub, Stripe, OpenRouter, Anthropic, Resend), since the DPA says access is limited.
- [ ] A way to email workspace owners about subprocessor changes (30 days' notice), changes to these documents (30 days' notice) and breaches.
- [ ] A written procedure for closing a workspace on request (export, deletion within 30 days) and for deleting a team member's account, since neither is self-service.
- [ ] Delete closed-beta invitations when the beta ends (the Privacy Policy says so; nothing removes `beta_invites` rows today).

**Publishing**

- [ ] Effective dates set, and the pages published at the URLs the dashboard links to (sign-up links `/legal/terms` and `/legal/privacy`).
- [ ] A `security.txt` on hireshelby.com and app.hireshelby.com pointing to security@hireshelby.com.
- [ ] The SDK's `PrivacyInfo.xcprivacy` declares exactly what the [App Store privacy guide](./app-store-privacy-guide.md) says.
- [ ] Customers notified of the documents (and of later material changes at least 30 days ahead).

**Keeping in sync**

- [ ] When [`../SUBPROCESSORS.md`](../SUBPROCESSORS.md) changes, update Annex III of the DPA and the sharing table in the Privacy Policy the same day, and send the 30-day notice before data goes to a new subprocessor.
- [ ] When the SDK starts sending new data, update the DPA's Annex I, the App Store privacy guide, the end-user template and the SDK's privacy manifest together.
