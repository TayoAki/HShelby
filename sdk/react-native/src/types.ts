/** A color string: `#RRGGBB`, `#RRGGBBAA` or a CSS color name. */
export type ColorValue = string;

/** The chat's look. Match it to your app's own theme: its accent, backgrounds and font; never invented colors. */
export type Theme = {
  /** Buttons, links and the user's own bubbles. Defaults to the app's accent color. */
  accentColor?: ColorValue;
  /** Text and icons on the accent color. Defaults to white. */
  onAccentColor?: ColorValue;
  /** The chat's background. Defaults to the system background. */
  backgroundColor?: ColorValue;
  /** The team's bubbles. */
  incomingBubbleColor?: ColorValue;
  /** Text in the team's bubbles. */
  incomingTextColor?: ColorValue;
  /** The PostScript name of a font your app bundles (for example "Avenir-Book"); it scales with Dynamic Type. */
  fontName?: string;
  /** Force light or dark; unset follows the app. */
  colorScheme?: "light" | "dark";
  /** The navigation title. Defaults to "Support". */
  title?: string;
  /** Shown above an empty conversation. Defaults to "How can we help?". */
  welcomeTitle?: string;
  welcomeText?: string;
  /** An SF Symbol name for the welcome icon; an empty string hides it. */
  welcomeIcon?: string;
  /** The close button on the chat's sheet. Defaults to true. */
  showsCloseButton?: boolean;
};

export type Options = {
  theme?: Theme;
  /** The API to talk to. Defaults to https://api.hireshelby.com. */
  apiBaseUrl?: string;
  /** How much the SDK logs to the Xcode console. Defaults to "error". Logs never contain message text or secrets. */
  logLevel?: "off" | "error" | "info" | "debug";
  /** Keep the app icon's badge at the unread count. Turn off if your app manages its badge. Defaults to true. */
  updatesAppBadge?: boolean;
  /** Apply the chat design the team publishes in the dashboard (it wins over `theme`). Defaults to true. */
  usesRemoteAppearance?: boolean;
  /**
   * What a review card's button does: "inApp" shows Apple's rating prompt (the default, as App Review guideline
   * 5.6.1 asks); "appStorePage" opens the App Store's write-review page.
   */
  reviewPrompt?: "inApp" | "appStorePage";
  /**
   * Close the chat before calling your paywall handler, so a React Native paywall screen isn't hidden under the
   * chat's sheet. Defaults to true; turn off if your paywall SDK presents natively on top.
   */
  dismissesChatForPaywall?: boolean;
};

/** Who the user is, as your app knows them. These labels are unverified; `{ token }` verifies them. */
export type UserLabels = { userId?: string; name?: string; email?: string };

/** A paywall your app can show; the team can send offers for it. */
export type Paywall = {
  /** 1–64 letters, digits, `_`, `.` or `-`. */
  id: string;
  /** 1–60 characters, shown to the team. */
  title: string;
  source?: "revenuecat" | "superwall" | "adapty" | "app";
  /** False when it exists but can't be shown on this device right now. Defaults to true. */
  isPresentable?: boolean;
  /** At most 10 per paywall. */
  products?: { id: string; price?: string; period?: string; trial?: string }[];
};

/** AI replies in the chat, as of its last load. */
export type AIReplies = {
  /** The team turned AI replies on (the chat asks the person before the AI answers them). */
  isEnabled: boolean;
  /** The person's choice; null until they make one. */
  consent: "granted" | "declined" | null;
  /** Who receives the person's messages to write AI replies, for example ["OpenRouter", "Anthropic"]. */
  processors: string[];
  /** The AI answers this person. */
  isAllowed: boolean;
  /** AI replies are on and the person hasn't chosen yet. */
  needsConsent: boolean;
};

export type HireShelbyEvent =
  | { type: "chatOpened" }
  | { type: "chatClosed" }
  | { type: "messageSent" }
  | { type: "reviewOpened" }
  | { type: "paywallOpened"; paywallId: string }
  | { type: "dataDeleted" }
  /** Your server's identity token was refused: get a fresh one and call identify({ token }) again. */
  | { type: "identityRejected"; code: string; message: string }
  | { type: "aiRepliesChanged"; allowed: boolean };

export type Subscription = { remove(): void };
