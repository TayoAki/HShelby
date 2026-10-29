import { z } from "zod";

/*
 * Remote appearance (phase B9): what the dashboard's "Chat design" editor saves per app. Teams edit a draft and
 * publish it; the SDK fetches only the published document, by App ID, without registering. Every property is
 * optional: absent means "use the app's own value" (then the SDK default). Colors are per mode and 6-digit
 * hex only; texts are per language. The SDK switches to a new snapshot the next time the chat opens.
 */

export const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "a 6-digit hex color like #FF4B2B");

/** A color for light mode, dark mode, or both. A missing mode falls back to the app's own color. */
export const ModeColor = z
  .object({ light: Hex.optional(), dark: Hex.optional() })
  .strict()
  .refine((c) => c.light || c.dark, { message: "set light, dark or both" });
export type ModeColor = z.infer<typeof ModeColor>;

/** BCP 47 language tags: `en`, `pt-BR`, `zh-Hans`. */
export const LanguageTag = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "a language tag like en or pt-BR");

/** Text per language: the SDK uses the user's exact tag, then their base language, then the app's own text. */
const localized = (max: number) =>
  z
    .record(LanguageTag, z.string().trim().min(1).max(max))
    .refine((t) => Object.keys(t).length >= 1 && Object.keys(t).length <= 48, { message: "1 to 48 languages" });

/** An image: an SF Symbol, an image from the workspace's asset library, or (welcome icon only) none. */
export const AppearanceImage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("symbol"), name: z.string().regex(/^[a-z0-9.]{1,80}$/, "an SF Symbol name like bubble.left.fill") }).strict(),
  z.object({ type: z.literal("asset"), assetId: z.uuid() }).strict(),
]);
export type AppearanceImage = z.infer<typeof AppearanceImage>;

export const AppearanceColors = z
  .object({
    accent: ModeColor,
    onAccent: ModeColor,
    chatBackground: ModeColor,
    incomingBackground: ModeColor,
    incomingForeground: ModeColor,
    welcomeIcon: ModeColor,
  })
  .partial()
  .strict();

/** Review and offer card styling. */
export const CardStyle = z
  .object({
    buttonIcon: AppearanceImage,
    /** Hidden: no chevron after the label. */
    trailingIcon: z.union([AppearanceImage, z.object({ type: z.literal("hidden") }).strict()]),
    iconSize: z.number().int().min(8).max(28),
    buttonColor: ModeColor,
    buttonTextColor: ModeColor,
  })
  .partial()
  .strict();

/** Every option of the SDK's Appearance except the font family (a font has to ship in the app). */
export const AppearanceDocument = z
  .object({
    colors: AppearanceColors,
    /** "app" follows the host app's color scheme. */
    colorScheme: z.enum(["app", "light", "dark"]),
    title: localized(40),
    welcomeTitle: localized(80),
    welcomeText: localized(300),
    hidesTitle: z.boolean(),
    hidesWelcomeTitle: z.boolean(),
    hidesWelcomeText: z.boolean(),
    welcomeIcon: z.union([AppearanceImage, z.object({ type: z.literal("hidden") }).strict()]),
    welcomeIconSize: z.number().int().min(16).max(120),
    welcomeIconCornerRadius: z.number().int().min(0).max(60),
    welcomeIconOffset: z.object({ x: z.number().int().min(-100).max(100), y: z.number().int().min(-100).max(100) }).strict(),
    fontDesign: z.enum(["default", "rounded", "serif", "monospaced"]),
    showsCloseButton: z.boolean(),
    closeIcon: AppearanceImage,
    /** Older outgoing bubbles fade toward white. */
    fadesOlderMessages: z.boolean(),
    cards: CardStyle,
  })
  .partial()
  .strict();
export type AppearanceDocument = z.infer<typeof AppearanceDocument>;

/** Asset IDs a document uses (they can't be deleted while it does, and are public once published). */
export function appearanceAssetIds(doc: AppearanceDocument): string[] {
  const images = [doc.welcomeIcon, doc.closeIcon, doc.cards?.buttonIcon, doc.cards?.trailingIcon];
  return [...new Set(images.flatMap((i) => (i?.type === "asset" ? [i.assetId] : [])))];
}

/* ---------- dashboard ---------- */

/** The editor's state: the draft (what's being edited) and the published document (what apps get). */
export const AppearanceState = z.object({
  draft: AppearanceDocument,
  /** Increases with every save; a save must name the version it started from. */
  draftVersion: z.number().int(),
  published: AppearanceDocument.nullable(),
  publishedVersion: z.number().int(),
  publishedAt: z.string().nullable(),
  /** The draft differs from what's published. */
  unpublishedChanges: z.boolean(),
  /** What the app's own code sets, as its SDK last reported it: where the editor starts. */
  reportedLocal: AppearanceDocument.nullable(),
  reportedAt: z.string().nullable(),
  team: z.object({ showPhotos: z.boolean(), showNames: z.boolean() }),
});
export type AppearanceState = z.infer<typeof AppearanceState>;

/** `PUT /api/apps/:id/appearance/draft`: optimistic concurrency on `baseVersion`. */
export const SaveDraftInput = z.object({ document: AppearanceDocument, baseVersion: z.number().int().min(0) }).strict();
export type SaveDraftInput = z.infer<typeof SaveDraftInput>;

/** `POST …/publish`: publishes the draft as of `draftVersion` (so nobody publishes changes they haven't seen). */
export const PublishInput = z.object({ draftVersion: z.number().int().min(0) }).strict();
export type PublishInput = z.infer<typeof PublishInput>;

/** Team photos and names: these switches apply right away, without publishing. */
export const TeamDisplayInput = z.object({ showPhotos: z.boolean(), showNames: z.boolean() }).partial().strict();
export type TeamDisplayInput = z.infer<typeof TeamDisplayInput>;

/* ---------- SDK ---------- */

/** What an app's SDK reports about its own code's appearance; bundled images are present but never uploaded. */
export const LocalAppearance = AppearanceDocument.extend({
  welcomeIcon: z.union([AppearanceImage, z.object({ type: z.enum(["hidden", "bundled"]) }).strict()]),
  closeIcon: z.union([AppearanceImage, z.object({ type: z.literal("bundled") }).strict()]),
}).partial();
export type LocalAppearance = z.infer<typeof LocalAppearance>;

/**
 * `GET /v1/apps/:appId/appearance`: public and cacheable (ETag = version). Asset images come as URLs. `appearance`
 * is null until the team publishes; `team` applies either way.
 */
export const PublicAppearance = z.object({
  version: z.number().int(),
  appearance: z.record(z.string(), z.unknown()).nullable(),
  team: z.object({ showPhotos: z.boolean(), showNames: z.boolean() }),
});
export type PublicAppearance = z.infer<typeof PublicAppearance>;

/* ---------- asset library ---------- */

export const ASSET_LIMITS = {
  /** Uploads: SVG, PNG, JPEG or WebP up to 2 MB. */
  uploadBytes: 2 * 1024 * 1024,
  /** Stored as a transparent PNG at most this many pixels on its longest side. */
  maxSide: 512,
  /** Per workspace, counting the stored PNGs. */
  quotaBytes: 50 * 1024 * 1024,
} as const;

export const Asset = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
  /** Apps whose draft or published appearance uses it; an asset in use can't be deleted. */
  usedBy: z.array(z.object({ appId: z.string(), appName: z.string() })),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

export const AssetLibrary = z.object({ assets: z.array(Asset), usedBytes: z.number().int(), quotaBytes: z.number().int() });
export type AssetLibrary = z.infer<typeof AssetLibrary>;
