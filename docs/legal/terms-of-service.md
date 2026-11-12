> **Draft for legal review.** Not legal advice. Fill in the bracketed placeholders and have counsel review before publishing.

Effective date: [EFFECTIVE DATE]

# Terms of Service

These terms are an agreement between HireShelby ("Hire Shelby", "we", "us"), a company incorporated in [JURISDICTION OF INCORPORATION] with its address at [COMPANY ADDRESS], and the business or individual that creates a Hire Shelby workspace or uses the service ("Customer", "you").

By creating an account, joining a workspace or using the service, you agree to these terms, the [Acceptable Use Policy](./acceptable-use-policy.md) and the [Data Processing Addendum](./dpa.md) (together, the "Agreement"). If you accept on behalf of a company or other organisation, you confirm you have authority to bind it, and "you" means that organisation. Hire Shelby is for business use: don't use it as a consumer, and don't use it if you're under 18.

## 1. Definitions

- **Service**: the Hire Shelby dashboard (app.hireshelby.com), API, SDK, integrations and related features we provide.
- **SDK**: our software development kit that you add to your iOS app to show the support chat.
- **Workspace**: your account space in the dashboard, with its members, apps, settings and subscription.
- **Team Members**: the people you let into your workspace.
- **End Users**: the people who use your apps.
- **Customer Data**: data you or your End Users put into the Service: End Users' messages, photos, device, identity and subscription details, custom metadata and events; your team's replies; and your help docs, AI instructions, automations, templates, designs and images.
- **AI Replies**: the optional feature that answers End Users with an AI model.

## 2. Your account and workspace

- Give us accurate information and keep it up to date.
- Keep passwords and credentials safe. You're responsible for everything done in your workspace by your Team Members and anyone using their credentials. Tell us at once at security@hireshelby.com if you suspect unauthorised access.
- Workspace owners and admins control the workspace: they invite Team Members by email (an invitation expires after 48 hours) and remove them, change roles, manage settings and billing, and can delete apps and End Users' data. Make sure only the right people have those roles.
- Each Team Member must have their own account. Don't share logins.

## 3. The Service

The Service lets you add an in-app support chat to your iOS apps and run it from the dashboard. Depending on what you set up, it can: receive End Users' messages and photos; let your team reply from the dashboard or from your own Telegram group; send review-request and offer cards (an offer opens a paywall your app reported it can show); send push notifications through Apple's push notification service using your own APNs key; send automated messages triggered by subscription events from providers you connect (RevenueCat, Superwall, Adapty, App Store Server Notifications) or by events your app tracks; and answer with AI Replies.

**Services you connect.** Apple, Telegram, subscription providers and any other third-party service you connect are provided by those third parties under their own terms. You're responsible for your accounts with them and for following their terms. We're not responsible for them, and we may have to change or stop an integration if the third party changes or stops its service.

**Changes.** We improve the Service continuously and may add, change or remove features. If we remove a feature you pay for in a way that materially reduces the Service, we'll tell you at least 30 days in advance where we reasonably can, and you may cancel and get a pro-rata refund of prepaid fees for the remaining period.

**Support.** We provide support by email at support@hireshelby.com on a reasonable-efforts basis.

## 4. Beta and preview features

The Service starts as a free closed beta, and we may label other features "beta" or "preview" later. In the closed beta, only people we invite can create an account, and we grant free access to a workspace until a date we show in the dashboard's Billing page; until then the workspace works as if it were subscribed. We decide who joins the beta and may extend or shorten free access with notice. During the beta and for any beta or preview feature:

- It's provided free of charge (unless we tell you otherwise in advance) and "as is", without any service level agreement, uptime commitment or support response times.
- Features, limits and interfaces may change or be removed without notice, and things may break.
- We may end the beta, or your access to it, with at least 30 days' notice (or sooner if we must for security or legal reasons). When the beta ends, you can subscribe to a paid plan or close your workspace; section 13 applies to your data either way.
- Please tell us what works and what doesn't. Section 10 covers feedback.

The confidentiality, data protection and security commitments in the Agreement apply to beta use too.

## 5. Fees and billing

- **Plans.** Paid plans are a flat subscription per workspace, billed monthly or yearly in advance. Prices are shown in the dashboard before you subscribe. Founder prices, where offered, are limited to a number of workspaces; if a founder subscription ends, a later subscription is at the price then on offer.
- **When charging starts.** We won't charge you for free beta access. We'll give you at least 30 days' notice before your free access ends, and you'll only be charged once you subscribe. If free access ends and you haven't subscribed, paid features stop as described under "Failed payments" below.
- **Payment.** Stripe processes payments. Subscribing authorises us, through Stripe, to charge your payment method at the start of each billing period until you cancel. Subscriptions renew automatically.
- **Cancelling.** Owners and admins can cancel, change plans and update payment details in the billing portal (Billing in the dashboard). A cancellation takes effect at the end of the current billing period. Fees are non-refundable except where these terms or the law say otherwise.
- **Failed payments.** If a renewal fails, Stripe retries for a while and your workspace keeps working meanwhile. If the subscription then ends, your team can no longer reply, send photos or cards, invite Team Members, add apps or use AI Replies. End Users can still write to you, your data stays, and your team can still read the inbox, resolve and block conversations, delete End Users' data and change settings.
- **Taxes.** Prices exclude taxes unless stated. You pay any applicable sales, use, VAT or similar taxes, other than taxes on our income.
- **Price changes.** We'll tell you at least 30 days before a price change applies to your subscription. It takes effect at your next renewal after that notice; you can cancel before then.

## 6. Your responsibilities for End Users

You decide which apps use the Service and what data they send. You are the controller (or, if you build apps for someone else, a processor for them) of End Users' data, and you're responsible for:

1. **A lawful basis and notices.** Having a lawful basis under applicable law for the data your apps send through the Service, and giving End Users the notices and obtaining any consents the law requires.
2. **Telling End Users.** Your app's privacy policy must describe the in-app support chat, the data it collects, AI Replies if you use them, push notifications, Telegram if you use it, and that Hire Shelby and its subprocessors process the data on your behalf (including in the United States). Our [End-user privacy template](./end-user-privacy-template.md) is a starting point.
3. **App Store privacy answers.** Your App Store Connect privacy answers must match what your app actually sends, including through our SDK. See the [App Store privacy guide](./app-store-privacy-guide.md).
4. **AI disclosure and permission.** If you turn on AI Replies, make it clear to End Users that some replies may come from an AI, and get any permission the law or Apple requires before their data is shared with a third-party AI provider. Apple's App Review Guidelines require apps to disclose where personal data is shared with third parties, including third-party AI, and to get explicit permission first. The SDK's chat asks each End User for that permission, naming the AI providers, and AI Replies answer only End Users who give it; don't give it on their behalf (for example by calling the SDK's AI switch without the End User choosing).
5. **Messages and push notifications.** Only send messages, offers and push notifications that are related to the person's use of your app and that the law and Apple's rules allow. Apple doesn't allow push notifications for promotions or direct marketing unless the person has opted in through consent language in your app and can opt out. Honour opt-outs. The Service pushes offers and automated messages only to End Users whose app reported their opt-in to promotional notifications; report it only when the End User gave it in your app. Don't send sensitive or confidential information in notification previews (you can turn previews off).
6. **Apple's rules.** Your apps and your use of the Service must comply with Apple's App Review Guidelines and the Apple Developer Program License Agreement, including the rules on in-app purchase, on ratings and reviews (don't offer incentives for reviews; review-request cards show Apple's rating prompt unless you configure the SDK to open the App Store page instead, which is your call under Apple's rules on review prompts) and on account deletion (if your app lets people create an account, let them delete it, and call the SDK's delete function when they do).
7. **Children.** Don't use the Service in apps in Apple's Kids Category or apps directed to children under 13 (or under the age of digital consent where the End User lives) without our prior written agreement.
8. **Deletion and rights requests.** Responding to End Users' requests to access, correct or delete their data. The dashboard and SDK let you delete a person's data; we'll help as the [DPA](./dpa.md) describes.
9. **Your credentials and settings.** Keeping your APNs key, app identity secret, Telegram bot token and subscription-provider secrets safe; keeping the identity secret on your server, never in your app; and controlling who is in any Telegram group you connect, since End Users' messages are posted there.
10. **Data minimisation.** Only sending us the End User data the chat needs. Don't send health data, payment card numbers, passwords, government ID numbers, precise location or other sensitive data as identity fields, custom metadata, help docs or AI instructions.

## 7. AI Replies

AI Replies are optional and off until an admin turns them on for an app.

- **How it works.** When an End User writes, the AI reads your help docs and instructions, the latest messages in the conversation and limited facts about the person, and can reply, send an offer or a rating request (if you allow those), or hand the conversation to your team. A teammate's reply pauses the AI in that conversation until someone hands it back. The [DPA](./dpa.md) lists exactly what is sent to the AI provider.
- **Your instructions.** You're responsible for the docs and instructions you give the AI, and for keeping them accurate and lawful. Messages the AI sends are sent on your behalf.
- **Outputs may be wrong.** AI output can be inaccurate, incomplete or inappropriate. Review what the AI says (the dashboard shows every AI message and recent runs), correct mistakes, and keep a teammate available to take over. Our guardrails, such as offering only paywalls the device reported, limiting rating requests and blocking promises of refunds, reduce risk but don't guarantee correct output.
- **Not professional advice.** Don't use AI Replies to give legal, medical, financial, safety-critical or other professional advice, or to make decisions with legal or similarly significant effects on End Users. Don't instruct the AI to claim to be human.
- **Providers.** AI Replies use Anthropic's Claude, today through OpenRouter. Turning AI Replies on instructs us to send that data to them as the [DPA](./dpa.md) describes. We don't use your data, or let these providers use it under our arrangements with them, to train AI models. You must also follow Anthropic's usage policies when using AI Replies.
- **Limits.** We may limit AI usage to keep the Service reliable and affordable. For example, the AI hands a conversation to your team after 30 AI messages in a day.

## 8. Acceptable use

You and your Team Members must follow the [Acceptable Use Policy](./acceptable-use-policy.md), and make sure your apps' use of the Service does too.

## 9. Customer Data

- **Yours.** As between us, you own Customer Data. You give us a worldwide, non-exclusive licence to host, copy, process, transmit and display Customer Data only as needed to provide, secure and support the Service under the Agreement and your instructions, and as the law requires.
- **Data protection.** We process personal data in Customer Data as your processor under the [DPA](./dpa.md). Our [Privacy Policy](./privacy-policy.md) covers the personal data we control, such as your Team Members' accounts.
- **Service data.** We may collect operational data about how the Service runs (such as counts of messages and requests, error rates, response times and AI token usage) to operate, secure, bill for and improve the Service. We won't disclose it in a way that identifies you, your End Users or your content.
- **No training, no selling.** We don't sell Customer Data, use it for advertising, or use it to train AI models.
- **Your responsibility.** You're responsible for Customer Data's accuracy and legality, and for having the rights to give it to us.

## 10. Our intellectual property

We own the Service, including the SDK, the dashboard and their designs and documentation. We give you a limited, non-exclusive, non-transferable licence, for the term of the Agreement, to use the Service and to include the SDK in your iOS apps to connect them to the Service. If the SDK comes with its own licence (for example, an open-source licence), that licence governs the SDK's code.

You may not: resell or sublicense the Service; use it to build a competing product; copy, modify or reverse engineer it except as the law allows despite this restriction; or remove our notices.

If you send us feedback or suggestions, we may use them without obligation to you.

## 11. Confidentiality

Each party may receive the other's non-public information that is marked confidential or that a reasonable person would understand to be confidential ("Confidential Information"). Customer Data is your Confidential Information. The receiving party will use it only to perform or use the Service under the Agreement, protect it with at least reasonable care, and share it only with its personnel, contractors and subprocessors who need it and are bound by similar obligations. This doesn't cover information that is or becomes public through no fault of the receiving party, was already known to it, was independently developed, or was rightfully received from someone else without a duty of confidence. A party may disclose Confidential Information when the law requires it, after giving the other party notice where allowed.

## 12. Suspension

We may suspend all or part of your access to the Service, or remove specific content, if we reasonably believe that:

- you or your app are breaching the Acceptable Use Policy or section 6;
- your use poses a security risk to the Service, other Customers or End Users, or could expose us to legal liability; or
- the law or a court or authority requires it.

We'll limit a suspension to what's needed, tell you the reason (unless the law or security prevents it) and restore access once the problem is fixed. If your subscription ends for non-payment, paid features stop as section 5 describes; that isn't a suspension.

## 13. Term, termination and your data

- **Term.** The Agreement starts when you first accept it and continues until terminated.
- **By you.** You can stop using the Service at any time: cancel your subscription in the billing portal and ask us to close your workspace at support@hireshelby.com.
- **By us.** We may terminate the Agreement with at least 30 days' notice. We may terminate immediately if you materially breach the Agreement and don't fix it within 15 days of our notice, or immediately for a serious or repeated breach of the Acceptable Use Policy.
- **Refunds.** If we terminate other than for your breach, we'll refund prepaid fees for the remaining period.
- **Exporting your data.** Before your workspace is closed, and for 30 days after the Agreement ends, you can ask at support@hireshelby.com for an export of your conversations and End User records in a common machine-readable format. We'll provide it within 30 days of your request.
- **Deletion.** Within 30 days after your workspace is closed or the Agreement ends (or after we provide a requested export, if later), we delete Customer Data and your workspace's data from our live systems, except where the law requires us to keep it. Deleted data stays in backups until they roll off, within [BACKUP RETENTION]. While you're a Customer, you can delete an End User's data from the dashboard at any time, and deleting an app from the dashboard removes its data from our live systems within minutes.
- **Survival.** Sections 9 to 11 and 13 to 18, and any unpaid fees, survive termination.

## 14. Warranties and disclaimers

Each party confirms it has the authority to enter into the Agreement. We'll provide the Service with reasonable skill and care and in line with the [DPA](./dpa.md) and our [security overview](./security.md).

Except as stated in the Agreement, and to the fullest extent the law allows, the Service, the SDK and AI output are provided "as is" and "as available". We disclaim all other warranties, express or implied, including merchantability, fitness for a particular purpose, non-infringement and accuracy, and we don't promise the Service will be uninterrupted, error-free or that push notifications, Telegram messages or other deliveries through third parties will arrive. You're responsible for your apps and for the messages you, your Team Members, your automations and AI Replies send to End Users.

## 15. Limitation of liability

To the fullest extent the law allows:

- Neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, goodwill or data (other than our obligations to restore data from our backups where possible), however caused, even if advised they were possible.
- Each party's total liability arising out of or relating to the Agreement is limited to the greater of the fees you paid us in the 12 months before the event giving rise to the claim and [MINIMUM LIABILITY CAP].
- These limits don't apply to your obligation to pay fees, to either party's indemnity obligations, to a party's breach of section 11, to your breach of the Acceptable Use Policy, or to liability that can't be limited by law (such as for fraud, or death or personal injury caused by negligence).

## 16. Indemnities

**By you.** You'll defend us against third-party claims, and pay resulting damages, costs and reasonable legal fees, arising from: Customer Data; your apps; messages, offers and notifications sent to your End Users by you, your Team Members, your automations or AI Replies you configured; your failure to give notices or obtain consents section 6 requires; or your breach of the Acceptable Use Policy.

**By us.** For paid subscriptions, we'll defend you against third-party claims that the Service, as we provide it, infringes their intellectual property rights, and pay resulting damages, costs and reasonable legal fees. This doesn't cover claims arising from Customer Data, third-party services, modifications not made by us, or combinations with things we didn't provide. If such a claim is made or likely, we may modify the Service so it doesn't infringe, get you a licence, or terminate and refund prepaid fees for the remaining period.

**Process.** The party seeking defence must tell the other promptly, let it control the defence and settlement (no settlement may admit fault by, or impose obligations on, the defended party without its consent), and give reasonable help at the other party's cost.

## 17. Governing law and disputes

The Agreement is governed by the laws of [GOVERNING LAW], without regard to its conflict-of-laws rules. The courts of [VENUE] have exclusive jurisdiction, except that either party may seek urgent injunctive relief in any competent court. Before starting proceedings, please email legal@hireshelby.com so we can try to resolve the dispute informally within 30 days.

## 18. General

- **Changes to these terms.** We may update the Agreement. For material changes, we'll tell workspace owners by email or in the dashboard at least 30 days before they take effect, unless a change is required by law sooner. If you don't agree, you can cancel before the change takes effect; continuing to use the Service after it means you accept it.
- **Notices.** We send notices to the email address of your workspace's owners, or in the dashboard. Send notices to us at legal@hireshelby.com, with a copy by post to [COMPANY ADDRESS] for notices of breach or termination.
- **Order of precedence.** If documents conflict: the DPA governs personal data processing, then these terms, then the Acceptable Use Policy.
- **Assignment.** Neither party may assign the Agreement without the other's consent, except to a successor in a merger, acquisition or sale of substantially all its relevant assets, with notice.
- **Force majeure.** Neither party is liable for delays or failures caused by events beyond its reasonable control (other than failures to pay).
- **Export and sanctions.** You confirm you're not located in, or owned or controlled by anyone in, a country or on a list subject to applicable sanctions, and you won't use the Service in breach of export or sanctions laws.
- **Publicity.** We won't use your name or logo to promote Hire Shelby without your permission.
- **Independent parties.** The Agreement doesn't create a partnership, agency or employment relationship. There are no third-party beneficiaries.
- **Entire agreement.** The Agreement is the whole agreement between us about the Service and replaces earlier discussions. If a provision is unenforceable, the rest stays in effect. Not enforcing a provision isn't a waiver.

## 19. Contact

Legal notices: legal@hireshelby.com
Support and billing: support@hireshelby.com
Privacy: privacy@hireshelby.com
Security: security@hireshelby.com
HireShelby, [COMPANY ADDRESS]
