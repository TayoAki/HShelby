import { brand, IDENTITY_SECRET_ENV } from "@hshelby/contracts";

export type SetupPromptConfig = {
  appName: string;
  publicId: string;
  apiBaseUrl: string;
  docsUrl?: string | undefined;
  swiftPackageUrl?: string | undefined;
  reactNativePackage?: string | undefined;
};

/**
 * The prompt a developer pastes into their coding agent to integrate the SDK.
 * Draft: the SDK isn't published yet, so missing package locations are called out
 * instead of guessed. Fill SWIFT_PACKAGE_URL / RN_PACKAGE / DOCS_URL when they exist.
 */
export function buildSetupPrompt(c: SetupPromptConfig): string {
  const missing = !c.swiftPackageUrl || !c.reactNativePackage;
  const lines = [
    `Integrate ${brand.name}, a native in-app support chat, into this app ("${c.appName}").`,
    "",
    `App ID: ${c.publicId}`,
    `API: ${c.apiBaseUrl}`,
    c.docsUrl ? `Docs for agents: ${c.docsUrl}` : "Docs for agents: not published yet.",
    ...(missing
      ? ["", "Note: the SDK packages are not published yet. Stop at step 3 and tell the developer which package location is missing."]
      : []),
    "",
    "Work through the steps in order. Keep the app's code, style and flows; change only what the integration needs.",
    "Keep messages to the developer short, one question at a time.",
    "",
    "## 1. Understand the app",
    "Pick the app target. A package.json with react-native or expo means React Native/Expo; otherwise native iOS.",
    "Look at startup code, navigation, theme (colors, fonts, light/dark), sign-in, account deletion, notifications and paywall code.",
    "",
    "## 2. Ask two questions, then wait",
    "a) Where should Support go? Suggest an entry on the home screen plus a row in Settings, copying an existing control.",
    "b) Which user details should the team see next to each chat (for example plan or sign-up date)? Never health data, passwords, precise location or payment details.",
    "",
    "## 3. Add the package and configure",
    `Native iOS: add the Swift package ${c.swiftPackageUrl ?? "<SWIFT_PACKAGE_URL>"} to the app target.`,
    `React Native/Expo: install ${c.reactNativePackage ?? "<RN_PACKAGE>"} and use a development build.`,
    `Configure once at launch with App ID ${c.publicId}. Match the chat's accent, background and font to the app's own theme; never invent colors.`,
    "",
    "## 4. Add the support entry",
    "Build the entry as a copy of an existing control on that screen. Show the unread count as a badge; hide it at zero.",
    "",
    "## 5. Connect what the app already has",
    "Apps with sign-in: identify(userId, name, email) after restoring a session and after sign-in, with what the app already knows. Apps without accounts: identify with just the name the user entered, if any.",
    "Call logout only where a signed-in session really ends (sign-out, account switch), before the next user's identify; never for guests. On account deletion, await deleteData() before discarding the session.",
    "Send the chosen user details with setMetadata: up to 20 string values, and each call replaces all of them, so set them in one place. Names and emails go only through identify.",
    "Forward the APNs device token if the app already has notification permission; never add a permission prompt.",
    "",
    "## 6. Build and check",
    "Build for an iOS simulator, launch the app, open Support and send a test message.",
    "It should appear in the dashboard inbox. Report exactly what you saw; never claim a check passed if you couldn't run it.",
    "",
    "## 7. Offer identity verification",
    "Only if the app has real sign-in and a backend that can sign tokens. Ask the developer whether to set it up now or later.",
    "If now: add an authenticated backend endpoint that returns an HS256 JWT signed with the app's identity secret, used verbatim including its ids_ prefix.",
    "Claims: user_id (required), exp (required; 7 days), name and email (optional). The user comes from the session, never from the request.",
    `The developer reveals the secret in the dashboard (the app's Settings, Identity verification) and stores it on the server as ${IDENTITY_SECRET_ENV}; never in the app or the chat.`,
    "The app passes the token to identify(token:) after sign-in and on every launch.",
    "",
    "## 8. Wrap up",
    "Summarize what changed, what you verified, and what is left for the developer (push credentials, privacy labels, the commit).",
    "Never put secrets or customer data in a message.",
  ];
  return lines.join("\n");
}
