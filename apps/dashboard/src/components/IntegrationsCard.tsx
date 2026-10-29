"use client";

import { PROVIDER_NAMES, type App, type IntegrationState, type Provider, type ProviderEventLog } from "@hshelby/contracts";
import { useEffect, useState } from "react";
import { CopyBlock, secondaryButton, SettingsCard } from "@/components/settings";
import { ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const HOW: Record<Provider, string> = {
  revenuecat: "In RevenueCat: Integrations → Webhooks → Add. Paste the URL and the Authorization header value.",
  superwall: "In Superwall: Integrations → Webhooks. Paste the URL here and copy its signing secret (whsec_…) below.",
  adapty: "In Adapty: Integrations → Webhooks. Paste the URL and the Authorization header value, then Save.",
  appstore:
    "In App Store Connect: your app → App Information → App Store Server Notifications, Version 2, for production and sandbox. Apple signs every notification; the SDK reports transaction IDs so they find the person.",
};

const STATUS_TONE: Record<ProviderEventLog["status"], string> = {
  accepted: "text-[#14773a]",
  unmatched: "text-[#8a5a00]",
  ignored: "text-secondary",
  test: "text-secondary",
  duplicate: "text-secondary",
  refused: "text-[#b42318]",
};

/** Subscription providers' webhooks for one app, and the Recent events log. */
export function IntegrationsCard({ app, admin }: { app: App; admin: boolean }) {
  const [integrations, setIntegrations] = useState<IntegrationState[] | null>(null);
  const [events, setEvents] = useState<ProviderEventLog[]>([]);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      api<{ integrations: IntegrationState[] }>(`/apps/${app.id}/integrations`),
      api<{ events: ProviderEventLog[] }>(`/apps/${app.id}/provider-events`),
    ]).then(([i, e]) => {
      setIntegrations(i.integrations);
      setEvents(e.events);
    });
  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load integrations"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per app
  }, [app.id]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  const connect = (provider: Provider) =>
    run(() => api(`/apps/${app.id}/integrations/${provider}`, { method: "PUT", body: JSON.stringify(provider === "superwall" ? { signingSecret: secret.trim() } : {}) }));
  const disconnect = (provider: Provider) => {
    if (!window.confirm(`Disconnect ${PROVIDER_NAMES[provider]}? Its webhooks will be refused.`)) return;
    return run(() => api(`/apps/${app.id}/integrations/${provider}`, { method: "DELETE" }));
  };

  return (
    <SettingsCard title="Subscription providers">
      <p>
        Your subscription provider tells us about trials, renewals, cancellations, billing issues and refunds. They show
        on the person in the inbox, decide who counts as paying, and can start automations.
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {integrations?.map((i) => (
        <div key={i.provider} className="space-y-2 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-fg">
              {PROVIDER_NAMES[i.provider]}{" "}
              <span className={`ml-1 rounded-full px-2 py-0.5 text-[12px] ${i.connected ? "bg-[#e8f7ee] text-[#14773a]" : "bg-white text-secondary"}`}>
                {i.connected ? (i.lastEventAt ? `Last event ${relativeTime(i.lastEventAt)}` : "Connected, no events yet") : "Not connected"}
              </span>
            </p>
            {admin && i.connected && (
              <button type="button" onClick={() => disconnect(i.provider)} disabled={busy} className="text-[13px] text-[#b42318]">
                Disconnect
              </button>
            )}
          </div>
          {i.connected ? (
            <>
              <p className="text-[13px]">{HOW[i.provider]}</p>
              <CopyBlock value={i.webhookUrl} />
              {i.authorization && <CopyBlock value={i.authorization} />}
            </>
          ) : (
            admin && (
              <div className="flex flex-wrap items-center gap-2">
                {i.provider === "superwall" && (
                  <input
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="whsec_…"
                    aria-label="Superwall signing secret"
                    className="h-10 min-w-64 flex-1 rounded-xl border border-[var(--field)] bg-white px-3 font-mono text-[13px] outline-none"
                  />
                )}
                <button
                  type="button"
                  onClick={() => connect(i.provider)}
                  disabled={busy || (i.provider === "superwall" && !secret.trim())}
                  className={secondaryButton}
                >
                  Connect
                </button>
              </div>
            )
          )}
        </div>
      ))}

      <div className="border-t border-line pt-4">
        <p className="text-fg">Recent events</p>
        {events.length === 0 ? (
          <p className="mt-1 text-[13px]">Nothing received yet. Most providers can send a test event from their webhook settings.</p>
        ) : (
          <table className="mt-2 w-full text-[13px]">
            <tbody>
              {events.slice(0, 20).map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 text-secondary">{relativeTime(e.receivedAt)}</td>
                  <td className="py-1.5 pr-2">{PROVIDER_NAMES[e.provider].split(" ")[0]}</td>
                  <td className="py-1.5 pr-2">
                    <span className="font-mono text-[12px]">{e.rawType ?? "—"}</span>
                    {e.event && <span className="text-secondary"> → {e.event.replaceAll("_", " ")}</span>}
                    {e.environment === "sandbox" && <span className="text-secondary"> · sandbox</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-secondary">{e.person ?? ""}</td>
                  <td className={`py-1.5 text-right ${STATUS_TONE[e.status]}`}>
                    {e.status === "accepted" ? `${e.devicesReached} device${e.devicesReached === 1 ? "" : "s"}` : e.status}
                    {e.reason && <span className="block text-[12px] text-secondary">{e.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SettingsCard>
  );
}
