export type TopicKind = "conversion" | "retention" | "integrations" | "reviews";

/* Copied from reception's bundle (module 492543). Each topic plays for 11s. */
export const topics: {
  kind: TopicKind;
  href: string;
  title: string;
  secondaryTitle: string;
  benefits: string[];
  duration: number;
}[] = [
  {
    kind: "conversion",
    href: "/docs/paywalls",
    title: "upsell your users",
    secondaryTitle: "or give them a deal",
    benefits: ["offer a deal when it helps", "find a plan that actually fits", "switch plans right in the chat"],
    duration: 11000,
  },
  {
    kind: "retention",
    href: "/docs/chat-features",
    title: "in app support chat",
    secondaryTitle: "fix it before they churn",
    benefits: ["help them without leaving your app", "see where they got stuck", "fix it before they leave"],
    duration: 11000,
  },
  {
    kind: "integrations",
    href: "/docs/identity",
    title: "integrate with everyone",
    secondaryTitle: "triage your users",
    benefits: [
      "see the details behind every conversation",
      "add your own data",
      "works with RevenueCat, Superwall, Adapty and more",
    ],
    duration: 11000,
  },
  {
    kind: "reviews",
    href: "/docs/reviews",
    title: "get more reviews",
    secondaryTitle: "ask when you help them",
    benefits: ["ask while they're still smiling", "one tap to the App Store", "say it in your own words"],
    duration: 11000,
  },
];
