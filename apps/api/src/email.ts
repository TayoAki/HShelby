import { brand } from "@hshelby/contracts";
import type { Logger } from "pino";
import type { Env } from "./env";

/*
 * Account email: password resets and team invitations. Sent through Resend when RESEND_API_KEY is set; without
 * it nothing is sent, and outside production the message (with its link) is logged so the flows work locally.
 * Production logs never carry the link, since it grants access.
 */

export type Email = { to: string; subject: string; text: string; html: string };

export type Mailer = {
  /** Whether messages actually leave (a provider key is set). */
  enabled: boolean;
  send(email: Email): Promise<void>;
};

type MailerEnv = Pick<Env, "NODE_ENV" | "RESEND_API_KEY" | "RESEND_API_URL" | "EMAIL_FROM">;

export function createMailer(env: MailerEnv, logger: Logger, fetchImpl: typeof fetch = fetch): Mailer {
  const key = env.RESEND_API_KEY;
  if (!key) {
    return {
      enabled: false,
      async send(email) {
        if (env.NODE_ENV === "production") {
          // no address in production logs: they're personal data
          logger.warn({ subject: email.subject }, "email not sent: no RESEND_API_KEY");
        } else {
          logger.info({ to: email.to, subject: email.subject, text: email.text }, "email (not sent: no RESEND_API_KEY)");
        }
      },
    };
  }
  return {
    enabled: true,
    async send(email) {
      const res = await fetchImpl(`${env.RESEND_API_URL.replace(/\/$/, "")}/emails`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        logger.error({ status: res.status, detail, subject: email.subject }, "email provider refused a message");
        throw new Error(`Email provider answered ${res.status}`);
      }
    },
  };
}

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** One short paragraph and a button: plain text first, the HTML mirrors it. */
function layout(lines: string[], action: { label: string; url: string }, footer: string): { text: string; html: string } {
  const text = [...lines, "", `${action.label}: ${action.url}`, "", footer].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1f">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-weight:600">${escapeHtml(brand.name)}</p>
${lines.map((l) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(l)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1d1d1f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px">${escapeHtml(action.label)}</a></p>
<p style="margin:0;color:#6e6e73;font-size:13px;line-height:1.5">${escapeHtml(footer)}</p>
</div></body></html>`;
  return { text, html };
}

export function resetPasswordEmail(to: string, name: string, url: string): Email {
  const { text, html } = layout(
    [`Hi ${name.split(" ")[0] || "there"},`, `Someone asked to reset the password for your ${brand.name} account. The link works for an hour.`],
    { label: "Choose a new password", url },
    "If you didn't ask for this, ignore this email: your password stays the same.",
  );
  return { to, subject: `Reset your ${brand.name} password`, text, html };
}

export function invitationEmail(to: string, inviter: string, workspace: string, url: string): Email {
  const { text, html } = layout(
    [`${inviter} invited you to the ${workspace} workspace on ${brand.name}, where the team answers its app's support chat.`],
    { label: "Accept the invitation", url },
    `Sign in or create an account with ${to} to join. If you weren't expecting this, you can ignore it.`,
  );
  return { to, subject: `${inviter} invited you to ${workspace} on ${brand.name}`, text, html };
}
