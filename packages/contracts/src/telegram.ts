import { z } from "zod";

/* Telegram (phase B8): customer messages go to the team's Telegram chat, and replying there answers in the app. */

/** Only plain text up to this length is taken from Telegram. */
export const TELEGRAM_REPLY_MAX = 4000;

/** `PUT /api/apps/:id/telegram`: connect (or reconnect) a bot from BotFather to a chat. */
export const TelegramConnectInput = z
  .object({
    botToken: z
      .string()
      .trim()
      .regex(/^\d{5,20}:[A-Za-z0-9_-]{30,64}$/, "paste the token BotFather gave you (123456:ABC…)"),
    /** A numeric chat ID (negative for groups) or a public @username. */
    chatId: z
      .string()
      .trim()
      .regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/, "a numeric chat ID (groups start with -) or @username"),
  })
  .strict();
export type TelegramConnectInput = z.infer<typeof TelegramConnectInput>;

export const TelegramUpdateInput = z
  .object({ paused: z.boolean(), topics: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });
export type TelegramUpdateInput = z.infer<typeof TelegramUpdateInput>;

export const TelegramSettings = z.object({
  status: z.enum(["not_set_up", "connected", "paused"]),
  bot: z.object({ username: z.string() }).nullable(),
  chat: z.object({ id: z.string(), title: z.string().nullable(), type: z.enum(["private", "group", "supergroup"]) }).nullable(),
  topics: z.boolean(),
  /** The last thing Telegram refused, e.g. the bot was removed from the group. */
  issue: z.string().nullable(),
  issueAt: z.string().nullable(),
  connectedAt: z.string().nullable(),
});
export type TelegramSettings = z.infer<typeof TelegramSettings>;
