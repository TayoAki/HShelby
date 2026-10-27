import { z } from "zod";

/** Working product name. Change it here; every surface reads it from this constant. */
export const brand = { name: "hshelby" } as const;

/* ---------- errors ---------- */

export const errorCodes = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "no_active_organization",
  "app_already_added",
  "app_store_unavailable",
  "billing_not_configured",
  "internal_error",
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export const ErrorBody = z.object({
  error: z.object({ code: z.enum(errorCodes), message: z.string() }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/* ---------- account ---------- */

export const Me = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  organization: z
    .object({ id: z.string(), name: z.string(), slug: z.string(), role: z.string() })
    .nullable(),
});
export type Me = z.infer<typeof Me>;

/* ---------- apps ---------- */

export const PUBLIC_APP_ID = /^app_[0-9A-Za-z]{22}$/;

export const App = z.object({
  id: z.string(),
  publicId: z.string().regex(PUBLIC_APP_ID),
  name: z.string(),
  iconUrl: z.string().nullable(),
  bundleId: z.string().nullable(),
  appStoreId: z.string().nullable(),
  appStoreUrl: z.string().nullable(),
  sellerName: z.string().nullable(),
  firstMessageAt: z.string().nullable(),
  createdAt: z.string(),
});
export type App = z.infer<typeof App>;

/** Either an App Store app (by ID; the server fetches its details) or a manual name. */
export const CreateAppInput = z.union([
  z.object({ appStoreId: z.string().regex(/^\d{5,12}$/) }).strict(),
  z.object({ name: z.string().trim().min(1).max(100) }).strict(),
]);
export type CreateAppInput = z.infer<typeof CreateAppInput>;

export const UpdateAppInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export type UpdateAppInput = z.infer<typeof UpdateAppInput>;

export const AppStatus = z.object({ firstMessageAt: z.string().nullable() });
export type AppStatus = z.infer<typeof AppStatus>;

export const SetupPrompt = z.object({ prompt: z.string(), lines: z.number().int() });
export type SetupPrompt = z.infer<typeof SetupPrompt>;

/* ---------- App Store ---------- */

export const AppStoreResult = z.object({
  appStoreId: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
  bundleId: z.string().nullable(),
  sellerName: z.string().nullable(),
  url: z.string().nullable(),
  genre: z.string().nullable(),
});
export type AppStoreResult = z.infer<typeof AppStoreResult>;

export const AppStoreSearch = z.object({ results: z.array(AppStoreResult) });
export type AppStoreSearch = z.infer<typeof AppStoreSearch>;

/* ---------- billing ---------- */

export const BillingConfig = z.object({
  enabled: z.boolean(),
  plan: z.string(),
  subscription: z
    .object({ status: z.string().nullable(), periodEnd: z.string().nullable(), cancelAtPeriodEnd: z.boolean() })
    .nullable(),
});
export type BillingConfig = z.infer<typeof BillingConfig>;
