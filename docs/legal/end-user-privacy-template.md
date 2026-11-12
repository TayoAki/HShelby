> **Draft for legal review.** Not legal advice. Fill in the bracketed placeholders and have counsel review before publishing.

Effective date: [EFFECTIVE DATE]

# Privacy policy text for your app's support chat

A template Hire Shelby Customers can adapt for their own app's privacy policy, describing the in-app support chat. It's a starting point, not legal advice: you're responsible for your privacy policy, so check it against what your app actually does and have it reviewed.

## How to use it

1. Copy the text under [Text to paste](#text-to-paste) into your app's privacy policy.
2. Replace every `{…}` field with your details. (The `[…]` placeholders are ours, and we fill them in before publishing this template.)
3. Delete the optional sections you don't use: they're marked *Optional*. Keep the rest.
4. Make your App Store privacy answers match: see the [App Store privacy guide](./app-store-privacy-guide.md).
5. If you turn on AI Replies, Apple's App Review Guidelines require you to disclose that personal data is shared with a third-party AI and to get the person's explicit permission first. This text covers the disclosure, and the chat asks for the permission itself, naming the providers, before any message goes to the AI. Never turn it on for someone.
6. Make deletion real: when someone deletes their account in your app, call the SDK's delete function. It deletes the chat data for that install. If the person also used the chat on another device, or signed out and back in, find their other conversations in the dashboard (search by user ID or email) and delete those too. If you connected a subscription provider, the subscription events that name the person's user ID stay until the app is deleted; ask support@hireshelby.com to delete them.

## Text to paste

### In-app support chat

{App name} has a support chat so you can message our team from inside the app. The chat is provided by Hire Shelby, a service that hosts it on our behalf and processes this data only on our instructions.

**What the chat collects**

- **Your messages and photos.** What you write in the chat and any photos you attach (up to 4 per message). Please don't send passwords, payment card numbers, health information or other sensitive details in the chat.
- **Who you are, if you're signed in.** {Your user ID, name and email address from your {App name} account}, so our team knows who they're helping.
- **Device and app details.** Your device model, iOS version, {App name} version, the chat's software version, your language and region setting, and your time zone.
- **Identifiers.** A random identifier for this installation of the app and, if you allow notifications, a push notification token. The chat doesn't use Apple's advertising identifier (IDFA).
- **How you use the chat.** When you last opened it, whether you've read our replies, and taps on buttons in our messages (for example to view an offer or rate the app).
- *Optional, if you set custom metadata:* **Account details.** {Details we attach to help support you, for example your plan and the date you signed up.}
- *Optional, if you report purchases or connect a subscription provider:* **Subscription.** Whether you have a subscription, its status, product and renewal or expiry date, from {the App Store on your device / RevenueCat / Superwall / Adapty / Apple's App Store Server Notifications}, and the offers the app can show you.
- *Optional, if you use automations based on in-app events:* **App events.** Events in the app that can trigger a message from us, such as {closing an offer without subscribing}.

The chat doesn't collect your precise location or your contacts, and it doesn't track you across other companies' apps or websites.

**How we use it**

To answer your questions, show you the conversation, notify you of replies, keep the chat secure (for example by blocking abuse), {and, optional: send you messages, offers and rating requests related to your use of {App name}}.

**AI replies** *(Optional, if you turn on AI Replies)*

If you allow it when the chat asks, some replies may be written by an AI assistant, {assistant name}, using Anthropic's Claude model, accessed through OpenRouter. Until you allow it, and after you turn it off in the chat's menu, nothing you write goes to the assistant. To answer you, the assistant receives our help articles and instructions, the latest messages in your conversation (up to 30; photos aren't included), and a few details: your name and email address if we have them, your language, local time, app and iOS version, device model, subscription status and the offers the app can show you. The assistant can make mistakes, and it hands the conversation to a person when it can't help or when you ask for one. Our providers don't use this data to train AI models.

**Notifications** *(Optional, if you send push notifications)*

If you allow notifications, we notify you when we reply. The notification shows {the sender's name and a preview of the reply} and is delivered through Apple's push notification service. {Optional, if you send offers or automated messages: Offers and automated messages reach your notifications only if you opted in to promotional notifications in the app; otherwise they wait in the chat.} You can turn notifications off in iOS Settings at any time.

**Our team chat** *(Optional, if you connect Telegram)*

Our team may receive new messages in a private group on Telegram: the text of your message, your name (or your user ID if we don't have your name) and the app's name. Photos aren't sent there.

**Who processes this data**

Hire Shelby processes the chat data for us, with its own service providers: Railway (hosting and storage, United States){, and, optional: OpenRouter and Anthropic (AI replies, United States)}. Notifications are delivered by Apple. The current list of Hire Shelby's service providers is in its [subprocessor list]([SUBPROCESSOR LIST URL]). Your data is stored in the United States. {Describe the safeguards you rely on for international transfers, for example the European Commission's Standard Contractual Clauses.}

**How long we keep it**

We keep your conversation {until you delete it or for as long as you use the app / for {retention period} after your last message}. Photos you choose but don't send are deleted after about a day. When you {delete your account in the app / ask us to delete your data}, your chat data on this device is deleted from Hire Shelby's systems straight away, and from its backups within [BACKUP RETENTION]. Copies that have already left those systems, such as notifications on your device{ or messages in our team's Telegram group}, aren't affected.

**Your choices and rights**

- To delete your chat data, {go to Settings > Delete account in the app / email us at {contact email}}.
- To see, correct or get a copy of your data, or for any other privacy request, email us at {contact email}.
- Signing out ends the chat on this device; signing in again starts a new conversation, and we keep the earlier one unless you ask us to delete it.
- {Add the rights that apply to your users, such as rights under the GDPR, UK GDPR or US state laws, and how to complain to a data protection authority.}

{Your company name} is responsible for this data. Contact: {contact email}, {postal address}.
