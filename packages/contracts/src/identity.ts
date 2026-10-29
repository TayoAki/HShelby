import { z } from "zod";

/* Identity is per device. Labels from identify() are unverified; an identity token signed by the
   developer's server with the app's `ids_…` secret makes the device verified. */

export const IDENTITY_LIMITS = { userId: 255, name: 200, email: 254, token: 4096 } as const;
export const METADATA_LIMITS = { entries: 20, key: 64, value: 512 } as const;

/** Subscription-provider IDs route webhooks (phase B10), so they survive metadata updates that omit them. */
export const STICKY_METADATA_KEYS = ["revenuecat_id", "superwall_id", "adapty_id"] as const;

/** Empty strings count as "not given": a label is only ever set, never cleared, by identify(). */
const label = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** identify(userId:name:email:). Omitted fields keep the server's value. */
export const IdentityLabels = z
  .object({ userId: label(IDENTITY_LIMITS.userId), name: label(IDENTITY_LIMITS.name), email: label(IDENTITY_LIMITS.email) })
  .strict();
export type IdentityLabels = z.infer<typeof IdentityLabels>;

/** The JWT from identify(token:). Validated by the server; this only bounds the size. */
export const IdentityToken = z.string().min(1).max(IDENTITY_LIMITS.token);

/** setMetadata(): replaces the whole dictionary. `{}` clears it (sticky provider IDs aside). */
export const Metadata = z
  .record(z.string().min(1).max(METADATA_LIMITS.key), z.string().max(METADATA_LIMITS.value))
  .refine((m) => Object.keys(m).length <= METADATA_LIMITS.entries, {
    message: `at most ${METADATA_LIMITS.entries} entries`,
  });
export type Metadata = z.infer<typeof Metadata>;

/** Who the device is, as the SDK sees it. */
export const SdkIdentity = z.object({
  userId: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  verified: z.boolean(),
});
export type SdkIdentity = z.infer<typeof SdkIdentity>;

/** How the team names a customer: what the app told us, else the device ID's tail. */
export const customerLabel = (device: { id: string; name: string | null; email: string | null; userId: string | null }) =>
  device.name ?? device.email ?? (device.userId ? `User ${device.userId}` : `Anonymous · ${device.id.slice(-4).toUpperCase()}`);

export const LogoutInput = z.object({ deviceSecret: z.string().min(1).max(200) }).strict();
export type LogoutInput = z.infer<typeof LogoutInput>;

/* ---------- dashboard ---------- */

export const RotateIdentitySecretInput = z.object({ unverifyExisting: z.boolean().default(false) }).strict();
export type RotateIdentitySecretInput = z.infer<typeof RotateIdentitySecretInput>;

export const IdentitySecret = z.object({ secret: z.string() });
export type IdentitySecret = z.infer<typeof IdentitySecret>;
