"use client";

import type { App, TelegramSettings } from "@hshelby/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { secondaryButton, SettingsCard, SwitchRow } from "@/components/settings";
import { ErrorNote, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const STATUS = {
  connected: { label: "Connected", className: "bg-[#e8f7ee] text-[#14773a]" },
  paused: { label: "Paused", className: "bg-[#fff8e6] text-[#8a5a00]" },
  not_set_up: { label: "Not set up", className: "bg-white text-secondary" },
} as const;

/** Customer messages in the team's Telegram, and replies from there. Admins connect and change it. */
export function TelegramSettingsCard({ app, admin }: { app: App; admin: boolean }) {
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/apps/${app.id}/telegram`;

  useEffect(() => {
    api<TelegramSettings>(base)
      .then(setSettings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the Telegram settings"));
  }, [base]);

  async function run(action: () => Promise<TelegramSettings | void>, done?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await action();
      if (next) setSettings(next);
      if (done) setNote(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const connect = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const next = await api<TelegramSettings>(base, { method: "PUT", body: JSON.stringify({ botToken: botToken.trim(), chatId: chatId.trim() }) });
      setBotToken("");
      return next;
    }, "Connected: the bot posted a confirmation in the chat");
  };
  const patch = (body: Partial<{ paused: boolean; topics: boolean }>) =>
    run(() => api<TelegramSettings>(base, { method: "PATCH", body: JSON.stringify(body) }));
  const test = () => run(() => api<TelegramSettings>(`${base}/test`, { method: "POST" }), "Test sent");
  const disconnect = () => {
    if (!window.confirm("Disconnect Telegram? Customer messages stop going to the chat.")) return;
    return run(async () => {
      await api(base, { method: "DELETE" });
      return (await api<TelegramSettings>(base)) as TelegramSettings;
    });
  };

  if (!settings) return <SettingsCard title="Telegram">{error ? <ErrorNote>{error}</ErrorNote> : <p>Loading…</p>}</SettingsCard>;
  const status = STATUS[settings.status];

  return (
    <SettingsCard title="Telegram">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] ${status.className}`}>{status.label}</span>
        {settings.bot && settings.chat && (
          <span className="text-[13px] text-secondary">
            @{settings.bot.username} → {settings.chat.title ?? settings.chat.id}
          </span>
        )}
      </div>
      <p>
        Each customer message is posted to your Telegram chat as “{app.name} · Name”. Reply to it in Telegram (use
        Reply) and the answer goes to the customer&apos;s app, with a 👍 from the bot once it&apos;s saved. Replies from
        the inbox are mirrored silently. Photos stay in the inbox.
      </p>

      {settings.issue && (
        <p className="rounded-2xl bg-[#fff1ee] px-4 py-3 text-[#b42318]">
          Telegram refused the last post{settings.issueAt && ` ${relativeTime(settings.issueAt)}`}: {settings.issue}
        </p>
      )}

      {settings.status === "not_set_up" || !admin ? null : (
        <div className="space-y-4 border-t border-line pt-4">
          <SwitchRow
            label="Post customer messages"
            description="Paused, nothing is posted, and messages from meanwhile aren't sent later."
            checked={settings.status === "connected"}
            onChange={(on) => patch({ paused: !on })}
            disabled={busy}
          />
          <SwitchRow
            label="A topic per customer"
            description="In a group with Topics turned on, each customer gets a topic, and anything written there is a reply. Make the bot an admin with “Manage topics”."
            checked={settings.topics}
            onChange={(topics) => patch({ topics })}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={test} disabled={busy} className={secondaryButton}>
              Send test
            </button>
            <button type="button" onClick={disconnect} disabled={busy} className={`${secondaryButton} text-[#b42318]`}>
              Disconnect
            </button>
          </div>
        </div>
      )}

      {admin ? (
        <form onSubmit={connect} className="space-y-3 border-t border-line pt-4">
          <p className="text-fg">{settings.status === "not_set_up" ? "Connect a bot" : "Use another bot or chat"}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              In Telegram, message <strong>@BotFather</strong>, send <code className="font-mono text-[13px]">/newbot</code> and copy the token.
            </li>
            <li>Add the bot to your team&apos;s group (or start a private chat with it).</li>
            <li>
              Paste the group&apos;s chat ID: groups start with <code className="font-mono text-[13px]">-</code>; a public group can use its @username.
            </li>
          </ol>
          <p className="text-[13px] text-secondary">Use the bot only here: Telegram allows one webhook per bot, so another service would stop replies.</p>
          <Field label="Bot token" type="password" autoComplete="off" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:AA…" required />
          <Field label="Chat ID" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" required />
          <button type="submit" disabled={busy || !botToken.trim() || !chatId.trim()} className={secondaryButton}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </form>
      ) : (
        <p className="text-[13px]">Only workspace owners and admins can change the Telegram connection.</p>
      )}
      {note && <p className="text-[13px] text-[#14773a]">{note}.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </SettingsCard>
  );
}
