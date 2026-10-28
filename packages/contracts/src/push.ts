import { z } from "zod";

export const PushEnvironment = z.enum(["sandbox", "production"]);
export type PushEnvironment = z.infer<typeof PushEnvironment>;

export const DEFAULT_PUSH_TITLE = "{app}";
export const DEFAULT_PUSH_BODY = "{agent}: {message}";
export const PUSH_TEMPLATE_PLACEHOLDERS = ["{message}", "{agent}", "{app}"] as const;

/**
 * What the SDK reports for push: the raw APNs device token in hex (never an FCM or Expo token), the
 * APNs environment it was issued for, and whether the app lets pushes set its icon badge.
 */
export const PushRegistration = z
  .object({
    token: z
      .string()
      .regex(/^[0-9a-fA-F]{32,200}$/, "must be the raw APNs device token in hex")
      .transform((t) => t.toLowerCase()),
    environment: PushEnvironment,
    updatesAppBadge: z.boolean().default(true),
  })
  .strict();
export type PushRegistration = z.infer<typeof PushRegistration>;

const appleId = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{10}$/, "10 letters and digits, from your Apple Developer account");
const template = z.string().trim().min(1).max(120);

/** `PUT /api/apps/:id/push`. The .p8 is required the first time; leave it out to keep the stored key. */
export const PushConfigInput = z
  .object({
    teamId: appleId,
    keyId: appleId,
    bundleId: z.string().trim().regex(/^[A-Za-z0-9.-]{1,155}$/, "a bundle ID like com.example.app"),
    p8: z.string().trim().max(16 * 1024).optional(),
    titleTemplate: template.default(DEFAULT_PUSH_TITLE),
    bodyTemplate: template.default(DEFAULT_PUSH_BODY),
    senderName: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((v) => v || null),
    showPreview: z.boolean().default(true),
    sound: z.boolean().default(true),
  })
  .strict();
export type PushConfigInput = z.input<typeof PushConfigInput>;

export const PushConfig = z.object({
  teamId: z.string(),
  keyId: z.string(),
  bundleId: z.string(),
  titleTemplate: z.string(),
  bodyTemplate: z.string(),
  senderName: z.string().nullable(),
  showPreview: z.boolean(),
  sound: z.boolean(),
  /** APNs rejected the key itself (e.g. InvalidProviderToken). */
  issue: z.string().nullable(),
  issueAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type PushConfig = z.infer<typeof PushConfig>;

export const PushSettings = z.object({
  config: PushConfig.nullable(),
  /** Devices of this app with a push token, which "Send test" can reach (it sends to at most 10). */
  reachableDevices: z.number().int(),
});
export type PushSettings = z.infer<typeof PushSettings>;

export const PushTestResults = z.object({
  results: z.array(
    z.object({
      deviceId: z.string(),
      label: z.string(),
      environment: PushEnvironment,
      ok: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
});
export type PushTestResults = z.infer<typeof PushTestResults>;

/** A device's push state as the team sees it. */
export const DevicePush = z.object({
  enabled: z.boolean(),
  environment: PushEnvironment.nullable(),
  issue: z.string().nullable(),
  issueAt: z.string().nullable(),
});
export type DevicePush = z.infer<typeof DevicePush>;
