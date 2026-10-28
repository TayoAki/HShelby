"use client";

import {
  DEFAULT_PUSH_BODY,
  DEFAULT_PUSH_TITLE,
  type App,
  type PushConfig,
  type PushSettings,
  type PushTestResults,
} from "@hshelby/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import { secondaryButton, SettingsCard, SwitchRow } from "./settings";
import { AppIcon, ErrorNote, Field } from "./ui";

type Form = Omit<PushConfig, "issue" | "issueAt" | "updatedAt" | "senderName"> & { senderName: string };

const formFrom = (config: PushConfig | null, appBundleId: string | null): Form => ({
  teamId: config?.teamId ?? "",
  keyId: config?.keyId ?? "",
  bundleId: config?.bundleId ?? appBundleId ?? "",
  titleTemplate: config?.titleTemplate ?? DEFAULT_PUSH_TITLE,
  bodyTemplate: config?.bodyTemplate ?? DEFAULT_PUSH_BODY,
  senderName: config?.senderName ?? "",
  showPreview: config?.showPreview ?? true,
  sound: config?.sound ?? true,
});

/** Same single-pass fill as the server's, for the live preview. */
const fill = (template: string, values: Record<"message" | "agent" | "app", string>) =>
  template.replace(/\{(message|agent|app)\}/g, (_, key: keyof typeof values) => values[key]);

function NotificationPreview({ app, form }: { app: App; form: Form }) {
  const values = {
    message: form.showPreview ? "Thanks for waiting! Try pulling down on the list to refresh." : "New message",
    agent: form.senderName.trim() || "Ada",
    app: app.name,
  };
  return (
    <div className="flex items-start gap-3 rounded-[22px] bg-white/90 p-3 shadow-[0_6px_24px_-12px_rgb(0_0_0_/_35%)] outline outline-1 -outline-offset-1 outline-black/5">
      <AppIcon app={app} size={38} />
      <div className="min-w-0 flex-1 text-[13.5px] leading-[1.35]">
        <div className="flex justify-between gap-2">
          <p className="truncate font-semibold text-fg">{fill(form.titleTemplate, values) || " "}</p>
          <span className="shrink-0 text-[12px] text-secondary">now</span>
        </div>
        <p className="line-clamp-2 text-fg">{fill(form.bodyTemplate, values)}</p>
      </div>
    </div>
  );
}

/** APNs key upload, notification content and "Send test" for one app. */
export function PushSettingsCard({ app, admin }: { app: App; admin: boolean }) {
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [form, setForm] = useState<Form>(() => formFrom(null, app.bundleId));
  const [p8, setP8] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<PushTestResults["results"] | null>(null);

  // keyed on the app's identity, so edits elsewhere on the page don't reset an unsaved form
  useEffect(() => {
    api<PushSettings>(`/apps/${app.id}/push`)
      .then((s) => {
        setSettings(s);
        setForm(formFrom(s.config, app.bundleId));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load push settings"));
  }, [app.id, app.bundleId]);

  const config = settings?.config ?? null;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function pickKey(file: File | undefined) {
    if (!file) return setP8(null);
    setP8({ name: file.name, text: await file.text() });
    // Apple names the download AuthKey_<KEY ID>.p8
    const keyId = /AuthKey_([A-Z0-9]{10})\.p8$/.exec(file.name)?.[1];
    if (keyId && !form.keyId) set("keyId", keyId);
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const { config: next } = await api<{ config: PushConfig }>(`/apps/${app.id}/push`, {
        method: "PUT",
        body: JSON.stringify({ ...form, ...(p8 && { p8: p8.text }) }),
      });
      setSettings((s) => s && { ...s, config: next });
      setP8(null);
      setNotice("Saved.");
    });
  };

  const sendTest = () =>
    run(async () => {
      setResults((await api<PushTestResults>(`/apps/${app.id}/push/test`, { method: "POST" })).results);
      // rejections update the settings' issue
      setSettings(await api<PushSettings>(`/apps/${app.id}/push`));
    });

  const remove = () => {
    if (!window.confirm("Remove push settings? Users stop getting notifications for replies.")) return;
    return run(async () => {
      await api(`/apps/${app.id}/push`, { method: "DELETE" });
      setSettings((s) => s && { ...s, config: null });
      setForm(formFrom(null, app.bundleId));
      setResults(null);
    });
  };

  return (
    <SettingsCard title="Push notifications">
      <p>
        Lets replies reach users who&apos;ve left the app. Create an APNs auth key in your Apple Developer account
        (Certificates, IDs &amp; Profiles → Keys, with Apple Push Notifications service enabled) and upload the{" "}
        <code className="font-mono text-[13px]">.p8</code> file here. One key covers sandbox and production builds; each
        device is sent to the environment it registered from.
      </p>
      {config?.issue && (
        <ErrorNote>
          Apple rejected this key ({config.issue}
          {config.issueAt && `, ${relativeTime(config.issueAt)}`}). Check the Key ID and Team ID, or upload the key again.
        </ErrorNote>
      )}
      {settings && (
        <p className="text-fg">
          {config
            ? `Set up. ${settings.reachableDevices === 1 ? "1 device" : `${settings.reachableDevices} devices`} can receive notifications.`
            : "Not set up yet."}
        </p>
      )}

      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={!admin || busy} className="space-y-4">
          <div>
            <label htmlFor="push-key" className="mb-1.5 block text-[13px] text-secondary">
              APNs key (.p8)
            </label>
            <input
              id="push-key"
              type="file"
              accept=".p8"
              aria-describedby="push-key-hint"
              onChange={(e) => void pickKey(e.target.files?.[0])}
              className="block w-full text-[14px] file:mr-3 file:h-10 file:rounded-full file:border-0 file:bg-white file:px-4 file:text-[14px] file:text-fg file:outline file:outline-1 file:-outline-offset-1 file:outline-black/10"
            />
            <p id="push-key-hint" className="mt-1 text-[12px] text-secondary">
              {p8 ? `${p8.name} will be uploaded when you save.` : config ? `A key is stored (updated ${relativeTime(config.updatedAt)}). Choose a file only to replace it.` : "Required."}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Key ID" value={form.keyId} onChange={(e) => set("keyId", e.target.value.toUpperCase())} placeholder="ABC123DEFG" required />
            <Field label="Team ID" value={form.teamId} onChange={(e) => set("teamId", e.target.value.toUpperCase())} placeholder="DEF456GHIJ" required />
            <Field label="Bundle ID" value={form.bundleId} onChange={(e) => set("bundleId", e.target.value)} placeholder="com.example.app" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" value={form.titleTemplate} onChange={(e) => set("titleTemplate", e.target.value)} maxLength={120} required />
            <Field label="Message" value={form.bodyTemplate} onChange={(e) => set("bodyTemplate", e.target.value)} maxLength={120} required />
          </div>
          <p className="-mt-2 text-[12px] text-secondary">
            Use {"{message}"}, {"{agent}"} (the teammate&apos;s first name) and {"{app}"}.
          </p>
          <Field
            label="Sender name (optional)"
            value={form.senderName}
            onChange={(e) => set("senderName", e.target.value)}
            maxLength={60}
            placeholder="Shown as {agent} instead of each teammate's name"
          />
          <SwitchRow
            label="Show the message"
            description="Off: notifications say “New message” instead of showing the reply on the lock screen."
            checked={form.showPreview}
            onChange={(v) => set("showPreview", v)}
            disabled={!admin || busy}
          />
          <SwitchRow
            label="Play a sound"
            description="The default notification sound."
            checked={form.sound}
            onChange={(v) => set("sound", v)}
            disabled={!admin || busy}
          />
          <div>
            <p className="mb-2 text-[13px] text-secondary">Preview</p>
            <NotificationPreview app={app} form={form} />
          </div>
        </fieldset>

        {error && <ErrorNote>{error}</ErrorNote>}
        {admin ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="h-10 rounded-full bg-[var(--accent)] px-5 text-[14px] text-white transition-colors hover:bg-[var(--accent-hover)] disabled:bg-[var(--accent-disabled)]"
            >
              Save
            </button>
            {config && (
              <>
                <button type="button" onClick={sendTest} disabled={busy} className={secondaryButton}>
                  Send test
                </button>
                <button type="button" onClick={remove} disabled={busy} className="text-[14px] text-[#b42318] underline-offset-4 hover:underline">
                  Remove
                </button>
              </>
            )}
            {notice && <span className="text-[13px] text-secondary">{notice}</span>}
          </div>
        ) : (
          <p>Only workspace owners and admins can change push settings.</p>
        )}
      </form>

      {results && (
        <div className="rounded-2xl bg-white p-4 outline outline-1 -outline-offset-1 outline-black/5">
          <p className="text-fg">Test notification</p>
          {results.length === 0 ? (
            <p className="mt-1">No devices have registered for notifications yet. Open the app on a device with notifications allowed, then try again.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {results.map((r) => (
                <li key={r.deviceId} className="flex items-center justify-between gap-4 py-2 text-[13px]">
                  <span className="truncate text-fg">
                    {r.label} <span className="text-secondary">· {r.environment === "sandbox" ? "Sandbox" : "Production"}</span>
                  </span>
                  <span className={r.ok ? "text-[#067647]" : "text-[#b42318]"}>{r.ok ? "Delivered to Apple" : r.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
