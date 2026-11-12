import { z } from "zod";

/*
 * The partner API (/partner/v1): App Builder includes Hire Shelby in the apps it builds. It creates a workspace for
 * each of its paying users and an app per project, keeps the workspace's state (active while the plan is paid, AI
 * while credits last), gives the owner a one-time link to claim the workspace, and reads AI reply costs. It never
 * receives message content.
 */

/** The partner's own id for a user (workspace) or a project (app). */
export const PartnerExternalId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, "1–128 letters, digits, '.', '_', ':' or '-'");

const email = z
  .string()
  .trim()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "an email address")
  .transform((e) => e.toLowerCase());

/** `PUT /partner/v1/workspaces/:externalId`: creates the workspace, or renames it. */
export const PartnerWorkspaceInput = z.object({ name: z.string().trim().min(1).max(100), ownerEmail: email }).strict();
export type PartnerWorkspaceInput = z.input<typeof PartnerWorkspaceInput>;

/** `PATCH /partner/v1/workspaces/:externalId`. */
export const PartnerWorkspacePatch = z
  .object({ active: z.boolean().optional(), aiAllowed: z.boolean().optional(), ownerEmail: email.optional() })
  .strict();
export type PartnerWorkspacePatch = z.input<typeof PartnerWorkspacePatch>;

export const PartnerWorkspace = z.object({
  externalId: z.string(),
  /** Counts as subscribed (the owner's plan with the partner is paid). */
  active: z.boolean(),
  /** AI replies may answer (the owner has credits). */
  aiAllowed: z.boolean(),
  /** Someone joined it. */
  claimed: z.boolean(),
  /** The dashboard's origin. */
  dashboardUrl: z.string(),
});
export type PartnerWorkspace = z.infer<typeof PartnerWorkspace>;

/** `PUT /partner/v1/workspaces/:externalId/apps/:appExternalId`: creates the app, or renames it. */
export const PartnerAppInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    bundleId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,155}$/, "a bundle ID like com.example.app")
      .optional(),
  })
  .strict();
export type PartnerAppInput = z.input<typeof PartnerAppInput>;

export const PartnerApp = z.object({
  externalId: z.string(),
  /** The public `app_…` ID the SDK is configured with. */
  appId: z.string(),
  name: z.string(),
});
export type PartnerApp = z.infer<typeof PartnerApp>;

/** `POST /partner/v1/workspaces/:externalId/claim-link`. */
export const PartnerClaimLink = z.object({ url: z.string() });
export type PartnerClaimLink = z.infer<typeof PartnerClaimLink>;

/** `GET /partner/v1/usage?after&limit`. */
export const PartnerUsageQuery = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const PartnerUsageItem = z.object({
  /** The AI run's id: time-ordered, the cursor. */
  id: z.string(),
  workspaceExternalId: z.string(),
  appExternalId: z.string(),
  costUsd: z.number(),
  createdAt: z.string(),
});
export const PartnerUsage = z.object({ items: z.array(PartnerUsageItem), next: z.string().nullable() });
export type PartnerUsage = z.infer<typeof PartnerUsage>;

/** `GET /api/partner-claims/:token`: what the claim page shows before anyone signs in. */
export const PartnerClaimInfo = z.object({
  email: z.string(),
  workspaceName: z.string(),
  partnerName: z.string(),
  status: z.enum(["valid", "used", "expired"]),
});
export type PartnerClaimInfo = z.infer<typeof PartnerClaimInfo>;

/** `POST /api/partner-claims/:token/accept`. */
export const PartnerClaimAccepted = z.object({ organizationId: z.string() });
export type PartnerClaimAccepted = z.infer<typeof PartnerClaimAccepted>;
