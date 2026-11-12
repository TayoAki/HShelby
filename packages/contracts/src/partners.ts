import { z } from "zod";

/*
 * The partner API (/partner/v1): an app builder creates a Hire Shelby app for each project it builds, for the
 * project's owner, and gets the App ID to build into the app. The owner joins with their own account (an
 * invitation, which also lets them in while sign-ups are invite-only) and answers chats in the dashboard.
 */

/** The partner's own ID for the project: letters, digits and `._:-`, up to 128. */
export const PartnerExternalId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, "1–128 letters, digits, '.', '_', ':' or '-'");

/** `PUT /partner/v1/apps/:externalId`: creates the app, or returns the one already created for this ID. */
export const PartnerAppInput = z
  .object({
    /** The app's name, as the owner and their team see it. */
    name: z.string().trim().min(1).max(100),
    owner: z
      .object({
        email: z
          .string()
          .trim()
          .max(254)
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "an email address")
          .transform((e) => e.toLowerCase()),
        name: z.string().trim().min(1).max(100).optional(),
      })
      .strict(),
    bundleId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,155}$/, "a bundle ID like com.example.app")
      .optional(),
  })
  .strict();
export type PartnerAppInput = z.input<typeof PartnerAppInput>;

/** `member`: the owner has joined. `invited`: waiting for them to sign up. `expired`: PUT again for a new invitation. */
export const PartnerOwnerStatus = z.enum(["member", "invited", "expired"]);

export const PartnerApp = z.object({
  externalId: z.string(),
  app: z.object({
    id: z.string(),
    /** The App ID the SDK is configured with. */
    appId: z.string(),
    name: z.string(),
    bundleId: z.string().nullable(),
  }),
  workspace: z.object({ id: z.string(), name: z.string() }),
  owner: z.object({ email: z.string(), status: PartnerOwnerStatus, invitationExpiresAt: z.string().nullable() }),
  urls: z.object({
    /** Where the owner answers chats. */
    inbox: z.string(),
    /** For an owner without an account: sign up with the invited address (it joins the workspace). */
    signUp: z.string().nullable(),
    signIn: z.string(),
  }),
  /** The API the SDK talks to (its default). */
  apiBaseUrl: z.string(),
  push: z.object({ configured: z.boolean(), bundleId: z.string().nullable(), issue: z.string().nullable() }),
  createdAt: z.string(),
});
export type PartnerApp = z.infer<typeof PartnerApp>;
