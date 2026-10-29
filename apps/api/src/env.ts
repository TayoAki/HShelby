import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8080),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  /** Public origin the browser uses (the dashboard, which proxies /api to this service). */
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** Extra origins allowed to call auth endpoints, comma separated. */
  TRUSTED_ORIGINS: optional,
  /** Encryption keyring for secrets at rest: "v1:<base64 32 bytes>[,v2:…]". */
  ENC_KEYS: z.string().min(1),
  /** Public base URL of this API, as the SDK will see it (used in the setup prompt). */
  PUBLIC_API_URL: optional,
  APP_STORE_COUNTRY: z.string().length(2).default("us"),
  DOCS_URL: optional,
  SWIFT_PACKAGE_URL: optional,
  RN_PACKAGE: optional,
  // S3-compatible bucket for photos. Photos are off unless endpoint, bucket and both keys are set.
  S3_ENDPOINT: optional,
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: optional,
  // Stripe (test mode). Billing is off unless the key, webhook secret and both founder prices are set.
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_MONTHLY: optional,
  STRIPE_PRICE_YEARLY: optional,
  /** Prices after the founder spots are taken. Without both, the founder price stays on sale. */
  STRIPE_PRICE_STANDARD_MONTHLY: optional,
  STRIPE_PRICE_STANDARD_YEARLY: optional,
  FOUNDER_SPOTS: z.coerce.number().int().min(0).default(50),
  /** The Telegram Bot API (tests point it at a fake). */
  TELEGRAM_API_URL: z.string().url().default("https://api.telegram.org"),
  /** Minimum gap between the bot's posts in one chat; Telegram allows about 20 a minute in a group. */
  TELEGRAM_CHAT_INTERVAL_MS: z.coerce.number().int().min(0).default(3000),
  /** Claude, for AI replies (phase B11). Without a key, apps can't turn AI replies on. */
  ANTHROPIC_API_KEY: optional,
  /** The Claude API (tests point it at a fake). */
  ANTHROPIC_BASE_URL: optional,
  /** How long after a person's last message the AI answers, so a burst of messages gets one answer. */
  AI_DEBOUNCE_MS: z.coerce.number().int().min(0).default(8000),
  /** Multiplies every rate limit (src/rate-limit.ts); 0 turns them off. */
  RATE_LIMIT_SCALE: z.coerce.number().min(0).default(1),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.STRIPE_SECRET_KEY?.startsWith("sk_live_")) {
    throw new Error("Refusing to start with a live Stripe key: this deployment runs Stripe in test mode only.");
  }
  return parsed.data;
}

export const aiEnabled = (env: Env) => Boolean(env.ANTHROPIC_API_KEY);

export const billingEnabled = (env: Env) =>
  Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_YEARLY);
