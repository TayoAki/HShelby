"use client";

import { ReviewScenario, type App, type AppPaywall, type CardSettings, type CardStats } from "@hshelby/contracts";
import { useEffect, useState } from "react";
import { secondaryButton, SettingsCard } from "@/components/settings";
import { ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const SCENARIOS: { key: ReviewScenario; label: string }[] = [
  { key: "general", label: "General" },
  { key: "after_helping", label: "After helping" },
  { key: "after_feedback", label: "After feedback" },
];

const fieldClass = "w-full rounded-xl border border-[var(--field)] bg-white px-3 py-2 text-[14px] text-fg outline-none focus:border-fg/60";

const linesOf = (value: string) =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const SOURCE_NAME = { revenuecat: "RevenueCat", superwall: "Superwall", adapty: "Adapty", app: "Your app" } as const;

const rate = (s: { sent: number; opened: number }) => (s.sent ? `${Math.round((s.opened / s.sent) * 100)}%` : "—");

/** The App Store ID, review templates and button labels; then what was sent and opened. */
export function ReviewsAndOffersCard({ app, admin, onAppChange }: { app: App; admin: boolean; onAppChange: (app: App) => void }) {
  const [settings, setSettings] = useState<CardSettings | null>(null);
  const [appStoreId, setAppStoreId] = useState(app.appStoreId ?? "");
  const [templates, setTemplates] = useState<Record<ReviewScenario, string> | null>(null);
  const [reviewLabels, setReviewLabels] = useState("");
  const [offerLabels, setOfferLabels] = useState("");
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [stats, setStats] = useState<CardStats | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CardSettings>(`/apps/${app.id}/cards/settings`)
      .then((s) => {
        setSettings(s);
        setTemplates(s.reviewTemplates);
        setReviewLabels(s.reviewButtonLabels.join("\n"));
        setOfferLabels(s.offerButtonLabels.join("\n"));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the card settings"));
  }, [app.id]);

  useEffect(() => {
    api<CardStats>(`/apps/${app.id}/cards/stats?days=${days}`)
      .then(setStats)
      .catch(() => setStats(null));
  }, [app.id, days]);

  async function run(what: string, action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await action();
      setSaved(what);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const saveAppStoreId = () =>
    run("App Store ID saved", async () => {
      const { app: updated } = await api<{ app: App }>(`/apps/${app.id}`, {
        method: "PATCH",
        body: JSON.stringify({ appStoreId: appStoreId.trim() || null }),
      });
      onAppChange(updated);
    });

  const saveCards = () =>
    run("Templates and labels saved", async () => {
      const next = await api<CardSettings>(`/apps/${app.id}/cards/settings`, {
        method: "PUT",
        body: JSON.stringify({ reviewTemplates: templates, reviewButtonLabels: linesOf(reviewLabels), offerButtonLabels: linesOf(offerLabels) }),
      });
      setSettings(next);
    });

  return (
    <SettingsCard title="Reviews and offers">
      <p>
        Teammates send review requests and offers from a conversation. A review card opens the App Store&apos;s review
        page; an offer opens one of the paywalls the user&apos;s app reported, and the dashboard shows when they tap it.
      </p>

      <div className="border-t border-line pt-4">
        <p className="text-fg">App Store ID</p>
        <p className="mt-1">The number in the app&apos;s App Store link (…/id123456789). Review cards need it.</p>
        <div className="mt-3 flex gap-2">
          <input
            value={appStoreId}
            onChange={(e) => setAppStoreId(e.target.value.replace(/\D/g, ""))}
            disabled={!admin}
            inputMode="numeric"
            placeholder="123456789"
            aria-label="App Store ID"
            className={`${fieldClass} h-10 max-w-48 font-mono`}
          />
          {admin && (
            <button type="button" onClick={saveAppStoreId} disabled={busy || appStoreId === (app.appStoreId ?? "")} className={secondaryButton}>
              Save
            </button>
          )}
        </div>
      </div>

      {templates && settings && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-fg">Review templates</p>
          <p>Teammates start from these and can edit before sending. {"{app}"} becomes the app&apos;s name.</p>
          {SCENARIOS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="mb-1 block text-[13px] text-secondary">{label}</span>
              <textarea
                value={templates[key]}
                onChange={(e) => setTemplates({ ...templates, [key]: e.target.value })}
                disabled={!admin}
                maxLength={500}
                rows={2}
                className={`${fieldClass} resize-none`}
              />
            </label>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[13px] text-secondary">Review button labels (one per line)</span>
              <textarea
                value={reviewLabels}
                onChange={(e) => setReviewLabels(e.target.value)}
                disabled={!admin}
                rows={3}
                placeholder="Rate on the App Store"
                className={`${fieldClass} resize-none`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] text-secondary">Offer button labels (one per line)</span>
              <textarea
                value={offerLabels}
                onChange={(e) => setOfferLabels(e.target.value)}
                disabled={!admin}
                rows={3}
                placeholder="View offer"
                className={`${fieldClass} resize-none`}
              />
            </label>
          </div>
          <p className="text-[13px] text-secondary">Without a custom label, the app shows its default, translated into the user&apos;s language.</p>
          {admin ? (
            <button type="button" onClick={saveCards} disabled={busy} className={secondaryButton}>
              Save templates and labels
            </button>
          ) : (
            <p className="text-[13px]">Only workspace owners and admins can change these.</p>
          )}
        </div>
      )}
      {saved && <p className="text-[13px] text-[#14773a]">{saved}.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <p className="text-fg">Activity</p>
          <div className="flex gap-1">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`h-7 rounded-full px-3 text-[12px] ${days === d ? "bg-fg text-white" : "bg-white text-secondary hover:text-fg"}`}
              >
                {d} days
              </button>
            ))}
          </div>
        </div>
        {stats && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(
                [
                  ["Review requests", stats.review],
                  ["Offers", stats.offer],
                ] as const
              ).map(([label, s]) => (
                <div key={label} className="rounded-2xl bg-white p-4">
                  <p className="text-[13px] text-secondary">{label}</p>
                  <p className="mt-1 text-[22px] tracking-[-.02em] text-fg">
                    {s.sent} <span className="text-[13px] text-secondary">sent</span>
                  </p>
                  <p className="text-[13px] text-secondary">
                    {s.opened} opened · {rate(s)}
                  </p>
                </div>
              ))}
            </div>
            {stats.bySender.length > 0 && (
              <table className="mt-3 w-full text-[13px]">
                <thead className="text-left text-secondary">
                  <tr>
                    <th className="py-1 font-normal">Sent by</th>
                    <th className="py-1 font-normal">Reviews</th>
                    <th className="py-1 font-normal">Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.bySender.map((s) => (
                    <tr key={`${s.source}:${s.author?.id ?? ""}`} className="border-t border-line">
                      <td className="py-1.5">{s.author?.name ?? (s.source === "ai" ? "AI" : s.source === "automation" ? "Automations" : "Team")}</td>
                      <td className="py-1.5">
                        {s.review.sent} · {rate(s.review)} opened
                      </td>
                      <td className="py-1.5">
                        {s.offer.sent} · {rate(s.offer)} opened
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {stats.byPaywall.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13px]">
                {stats.byPaywall.map((p) => (
                  <li key={p.paywallId} className="flex justify-between">
                    <span>{p.title}</span>
                    <span className="text-secondary">
                      {p.sent} sent · {rate(p)} opened
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </SettingsCard>
  );
}

/** What the app's devices report they can show; offers and automations pick from these. */
export function PaywallsCard({ app }: { app: App }) {
  const [paywalls, setPaywalls] = useState<AppPaywall[] | null>(null);
  useEffect(() => {
    api<{ paywalls: AppPaywall[] }>(`/apps/${app.id}/paywalls`)
      .then((r) => setPaywalls(r.paywalls))
      .catch(() => setPaywalls([]));
  }, [app.id]);

  return (
    <SettingsCard title="Paywalls">
      <p>
        The app reports the paywalls it can show (from RevenueCat, Superwall, Adapty or your own screen). An offer can
        only name a paywall the user&apos;s own app reported as available.
      </p>
      {paywalls?.length === 0 && <p className="rounded-2xl bg-white px-4 py-3">No paywalls reported yet. They appear once the app registers them with the SDK.</p>}
      {paywalls && paywalls.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl bg-white px-4">
          {paywalls.map((p) => (
            <li key={p.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-fg">
                  {p.title} {!p.presentable && <span className="text-[12px] text-secondary">· not presentable</span>}
                </p>
                <p className="font-mono text-[12px] text-secondary">{p.id}</p>
              </div>
              <p className="text-[13px] text-secondary">
                {SOURCE_NAME[p.source]} · reported {relativeTime(p.lastReportedAt)}
                {p.products.length > 0 && ` · ${p.products.map((x) => [x.price, x.period].filter(Boolean).join("/") || x.id).join(", ")}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
