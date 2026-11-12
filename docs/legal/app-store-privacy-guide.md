> **Draft for legal review.** Not legal advice. Fill in the bracketed placeholders and have counsel review before publishing.

Effective date: [EFFECTIVE DATE]

# App Store privacy guide

How to answer Apple's App Privacy questions in App Store Connect when your app includes the Hire Shelby SDK. Apple asks you to declare data collected by your app *and* by third-party SDKs in it, so the data the chat collects goes in your answers.

The SDK ships a privacy manifest (`PrivacyInfo.xcprivacy`) with the same declarations as this guide. Xcode combines it with your app's own manifest in the privacy report (Product > Archive, then in the Organizer: Generate Privacy Report), which you can use to check your answers.

This guide covers only what the SDK and Hire Shelby collect. You're responsible for your whole app's answers.

## The answers

In App Store Connect, open your app, then **App Privacy**, and answer **Yes, we collect data from this app**. Then declare these data types:

| Apple category | Data type | When to declare it |
|---|---|---|
| Contact Info | **Name** | If you pass a name to `identify` or in an identity token |
| Contact Info | **Email Address** | If you pass an email address to `identify` or in an identity token |
| Identifiers | **User ID** | If you pass your app's user ID to `identify` or in an identity token |
| Identifiers | **Device ID** | Always: a random identifier for each install (never the IDFA or IDFV), and the push notification token if you forward it |
| User Content | **Customer Support** | Always: the messages people send in the chat |
| User Content | **Photos or Videos** | If people can attach photos in your chat (the SDK's chat UI lets them): the photos they send |
| Purchases | **Purchase History** | Only if you report StoreKit state through the SDK (paying status and original transaction IDs), or connect RevenueCat, Superwall, Adapty or App Store Server Notifications |
| Usage Data | **Product Interaction** | Always: opening the chat, read state, taps on review and offer buttons, and the events you track for automations |
| Other Data | **Other Data Types** | Always: device model, iOS version, app version, SDK version, locale and time zone |

For **each** of these data types, answer:

- **Purpose: App Functionality.** (Customer support is part of App Functionality in Apple's definitions.)
- **Linked to the user's identity: Yes.** The data is tied to the person's conversation, and to their account if you identify them.
- **Used for tracking: No.** Hire Shelby doesn't combine this data with other companies' data for advertising, or share it with data brokers.

## Tracking and App Tracking Transparency

- The SDK doesn't track users as Apple defines it, and its privacy manifest declares no tracking and no tracking domains.
- It doesn't use the advertising identifier (IDFA) or the identifier for vendors (IDFV).
- The SDK doesn't need an App Tracking Transparency prompt. (Your app may need one for other reasons.)

## Things you add yourself

- **Custom metadata.** Anything you send with `setMetadata` is data you collect, so declare it under the matching Apple data type. For example: a plan name is Purchase History; a sign-up date or account type is Other Data Types; a coarse region is Coarse Location. Don't send sensitive data at all (see the [Acceptable Use Policy](./acceptable-use-policy.md)).
- **Marketing.** If you use automations, offers or push notifications to market to people (for example, a discount offer after someone cancels), Apple may treat that as *Developer's Advertising or Marketing*. Add that purpose to the data types you use for it (typically Purchase History, Product Interaction and any metadata used in automation audiences).
- **AI Replies.** If you turn on AI Replies, people's messages and some details go to a third-party AI provider (Anthropic's Claude, through OpenRouter). Apple's App Review Guidelines require you to disclose where personal data is shared with third parties, including third-party AI, and to get explicit permission before doing so. Say so in your privacy policy. The chat asks each person for that permission itself, naming the providers, and the AI answers only people who allow it; they can turn it off in the chat's menu.
- **Custom chat UI.** If you build your own UI instead of the SDK's, re-encode photos before sending them (as the SDK's chat UI does) so metadata such as location isn't uploaded.
- **Push notifications.** Forwarding the APNs token is covered by Device ID; it doesn't need another data type.

## Your privacy policy

Apple requires a privacy policy link for every app. Describe the support chat in it: our [End-user privacy template](./end-user-privacy-template.md) is a starting point. Make sure your App Store answers and your privacy policy say the same thing.

## Keeping it up to date

Update your answers when you start sending new data (a new metadata key, StoreKit reporting, a subscription provider) or turn on a feature such as AI Replies. We'll update this guide and the SDK's privacy manifest if the SDK starts collecting anything new, and say so in the SDK's release notes.

Questions: support@hireshelby.com
