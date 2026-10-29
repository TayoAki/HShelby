"use client";

import {
  SUBSCRIPTION_EVENTS,
  SUGGESTED_EVENTS,
  type App,
  type AppPaywall,
  type Automation,
  type AutomationInput,
  type AutomationResults,
  type AutomationStep,
  type Me,
} from "@hshelby/contracts";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { secondaryButton, SettingsCard, SwitchRow } from "@/components/settings";
import { AppIcon, ErrorNote, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import { isAdmin, useMe } from "@/lib/use-me";

type Draft = Omit<AutomationInput, "steps"> & { steps: AutomationStep[] };

const NEW: Draft = {
  name: "Win back a declined paywall",
  enabled: false,
  trigger: { event: "paywall_declined", frequency: "once" },
  audience: { segment: "not_paying", rules: [], duringConversation: false },
  wait: { type: "delay", minutes: 60 },
  withPush: true,
  steps: [{ type: "message", text: "Hey! Was anything unclear about the plans? Happy to help." }],
  senderUserId: null,
};

const REASONS: Record<string, string> = {
  ongoing_conversation: "In a conversation",
  audience: "Not in the audience",
  already_ran: "Already got it",
  offer_unavailable: "Offer not available on their device",
  already_asked: "Already asked for a rating",
  no_app_store_id: "No App Store ID set",
  replied: "Replied",
  blocked: "Blocked",
  signed_out: "Signed out",
  disabled: "Automation switched off",
};

/** The editable part of an automation (the API refuses unknown keys). */
const toDraft = (a: Automation): Draft => ({
  name: a.name,
  enabled: a.enabled,
  trigger: a.trigger,
  audience: a.audience,
  wait: a.wait,
  withPush: a.withPush,
  steps: a.steps,
  senderUserId: a.senderUserId,
});

const field = "h-9 rounded-xl border border-[var(--field)] bg-white px-3 text-[14px] text-fg outline-none focus:border-fg/60";
const label = (event: string) => event.replaceAll("_", " ");

function Row({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
      <span className="text-fg">{text}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function StepEditor({ step, paywalls, onChange, onRemove }: { step: AutomationStep; paywalls: AppPaywall[]; onChange: (s: AutomationStep) => void; onRemove: () => void }) {
  return (
    <div className="space-y-2 rounded-2xl bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] tracking-wide text-secondary uppercase">{step.type === "open_chat" ? "Open chat" : step.type}</span>
        <button type="button" onClick={onRemove} className="text-[13px] text-secondary hover:text-[#b42318]">
          Remove
        </button>
      </div>
      {step.type === "message" && (
        <textarea value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} rows={2} className={`${field} h-auto w-full py-2`} aria-label="Message" />
      )}
      {step.type === "offer" && (
        <>
          <select value={step.paywallId} onChange={(e) => onChange({ ...step, paywallId: e.target.value })} className={`${field} w-full`} aria-label="Paywall">
            {!paywalls.some((p) => p.id === step.paywallId) && <option value={step.paywallId}>{step.paywallId}</option>}
            {paywalls.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.id})
              </option>
            ))}
          </select>
          <textarea value={step.text ?? ""} onChange={(e) => onChange({ ...step, text: e.target.value })} rows={2} placeholder="Message (optional)" className={`${field} h-auto w-full py-2`} />
        </>
      )}
      {step.type === "rating" && (
        <textarea value={step.text ?? ""} onChange={(e) => onChange({ ...step, text: e.target.value })} rows={2} placeholder="Enjoying {app}?" className={`${field} h-auto w-full py-2`} />
      )}
      {step.type === "wait" && (
        <label className="flex items-center gap-2 text-[14px]">
          Wait
          <input type="number" min={1} value={step.minutes} onChange={(e) => onChange({ ...step, minutes: Math.max(1, Number(e.target.value)) })} className={`${field} w-24`} />
          minutes, then check they haven&apos;t replied
        </label>
      )}
      {step.type === "open_chat" && <p className="text-[13px] text-secondary">Opens the chat on their screen with the message, if the app is in front.</p>}
    </div>
  );
}

function Builder({ initial, paywalls, me, onSave, onCancel }: { initial: Draft; paywalls: AppPaywall[]; me: Me | null; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const audience = { segment: "everyone" as const, rules: [], duringConversation: false, ...d.audience };
  const trigger = { frequency: "once" as const, ...d.trigger };
  const wait = d.wait ?? { type: "immediate" as const };
  const add = (type: AutomationStep["type"]) => {
    const step: AutomationStep =
      type === "message"
        ? { type, text: "" }
        : type === "offer"
          ? { type, paywallId: paywalls[0]?.id ?? "", text: "", buttonLabel: null }
          : type === "rating"
            ? { type, text: "", buttonLabel: null }
            : type === "wait"
              ? { type, minutes: 60 * 24 }
              : { type: "open_chat" };
    set({ steps: [...d.steps, step] });
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsCard title="When">
        <Row label="Name">
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} className={`${field} w-72`} />
        </Row>
        <Row label="Event">
          <select
            value={[...SUGGESTED_EVENTS, ...SUBSCRIPTION_EVENTS].includes(trigger.event as never) ? trigger.event : "custom"}
            onChange={(e) => set({ trigger: { ...trigger, event: e.target.value === "custom" ? "" : e.target.value } })}
            className={field}
          >
            <optgroup label="Tracked by your app">
              {SUGGESTED_EVENTS.map((e) => (
                <option key={e} value={e}>
                  {label(e)}
                </option>
              ))}
              <option value="custom">Custom event…</option>
            </optgroup>
            <optgroup label="From your subscription provider">
              {SUBSCRIPTION_EVENTS.map((e) => (
                <option key={e} value={e}>
                  {label(e)}
                </option>
              ))}
            </optgroup>
          </select>
          {![...SUGGESTED_EVENTS, ...SUBSCRIPTION_EVENTS].includes(trigger.event as never) && (
            <input value={trigger.event} onChange={(e) => set({ trigger: { ...trigger, event: e.target.value.trim() } })} placeholder="event_name" className={`${field} w-44 font-mono text-[13px]`} />
          )}
        </Row>
        <Row label="How often">
          <select value={trigger.frequency} onChange={(e) => set({ trigger: { ...trigger, frequency: e.target.value as "once" | "every" } })} className={field}>
            <option value="once">Once per person</option>
            <option value="every">Every time (after the previous run)</option>
          </select>
        </Row>
      </SettingsCard>

      <SettingsCard title="Who">
        <Row label="People">
          <select value={audience.segment} onChange={(e) => set({ audience: { ...audience, segment: e.target.value as typeof audience.segment } })} className={field}>
            <option value="everyone">Everyone</option>
            <option value="not_paying">Without a subscription</option>
            <option value="paying">With a subscription</option>
          </select>
        </Row>
        {audience.rules.map((rule, i) => (
          <Row key={i} label={`Custom field rule ${i + 1}`}>
            <input value={rule.key} onChange={(e) => set({ audience: { ...audience, rules: audience.rules.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)) } })} placeholder="key" className={`${field} w-32 font-mono text-[13px]`} />
            <select value={rule.op} onChange={(e) => set({ audience: { ...audience, rules: audience.rules.map((r, j) => (j === i ? { ...r, op: e.target.value as typeof r.op } : r)) } })} className={field}>
              <option value="equals">is</option>
              <option value="not_equals">is not</option>
              <option value="contains">contains</option>
              <option value="exists">is set</option>
              <option value="not_exists">is not set</option>
            </select>
            {(rule.op === "equals" || rule.op === "not_equals" || rule.op === "contains") && (
              <input value={rule.value ?? ""} onChange={(e) => set({ audience: { ...audience, rules: audience.rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) } })} placeholder="value" className={`${field} w-32`} />
            )}
            <button type="button" onClick={() => set({ audience: { ...audience, rules: audience.rules.filter((_, j) => j !== i) } })} className="text-[13px] text-secondary">
              ×
            </button>
          </Row>
        ))}
        {audience.rules.length < 4 && (
          <button type="button" onClick={() => set({ audience: { ...audience, rules: [...audience.rules, { key: "", op: "equals", value: "" }] } })} className="text-[13px] text-secondary underline underline-offset-2">
            Add a custom field rule
          </button>
        )}
        <SwitchRow
          label="Also during a conversation"
          description="Off: people who talked with you in the last 24 hours are skipped, and caught at a later event."
          checked={audience.duringConversation}
          onChange={(duringConversation) => set({ audience: { ...audience, duringConversation } })}
        />
      </SettingsCard>

      <SettingsCard title="Wait">
        <Row label="Send">
          <select
            value={wait.type}
            onChange={(e) =>
              set({ wait: e.target.value === "immediate" ? { type: "immediate" } : e.target.value === "delay" ? { type: "delay", minutes: 60 } : { type: "local_time", days: 1, time: "10:00" } })
            }
            className={field}
          >
            <option value="immediate">Right away</option>
            <option value="delay">After a delay</option>
            <option value="local_time">At a local time on a later day</option>
          </select>
          {wait.type === "delay" && (
            <label className="flex items-center gap-1.5">
              <input type="number" min={1} value={wait.minutes} onChange={(e) => set({ wait: { type: "delay", minutes: Math.max(1, Number(e.target.value)) } })} className={`${field} w-24`} />
              minutes
            </label>
          )}
          {wait.type === "local_time" && (
            <>
              <input type="number" min={0} max={30} value={wait.days} onChange={(e) => set({ wait: { ...wait, days: Number(e.target.value) } })} className={`${field} w-16`} aria-label="Days later" />
              days later at
              <input type="time" value={wait.time} onChange={(e) => set({ wait: { ...wait, time: e.target.value } })} className={field} aria-label="Local time" />
              their time
            </>
          )}
        </Row>
        <SwitchRow label="Send a push" description="Offers always push." checked={d.withPush ?? true} onChange={(withPush) => set({ withPush })} />
      </SettingsCard>

      <SettingsCard title="Then">
        <Row label="From">
          <select value={d.senderUserId ?? ""} onChange={(e) => set({ senderUserId: e.target.value || null })} className={field}>
            <option value="">The team</option>
            {me && <option value={me.user.id}>{me.user.name}</option>}
          </select>
        </Row>
        <div className="space-y-2">
          {d.steps.map((step, i) => (
            <StepEditor key={i} step={step} paywalls={paywalls} onChange={(s) => set({ steps: d.steps.map((x, j) => (j === i ? s : x)) })} onRemove={() => set({ steps: d.steps.filter((_, j) => j !== i) })} />
          ))}
        </div>
        {d.steps.length < 8 && (
          <div className="flex flex-wrap gap-2">
            {(["message", "offer", "rating", "wait", "open_chat"] as const).map((t) => (
              <button key={t} type="button" onClick={() => add(t)} className="rounded-full bg-white px-3 py-1 text-[13px] hover:bg-[var(--panel-hover)]">
                + {t === "open_chat" ? "Open chat" : t === "rating" ? "Rating" : t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        )}
        <p className="text-[13px] text-secondary">
          An offer goes only to people whose app currently shows that paywall; a rating needs the App Store ID and skips people already asked. If either can&apos;t go, the run waits for their next event.
        </p>
      </SettingsCard>

      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="h-10 rounded-full bg-[var(--accent)] px-5 text-[14px] text-white hover:bg-[var(--accent-hover)] disabled:bg-[var(--accent-disabled)]">
          {busy ? "Saving…" : "Save automation"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Results({ appId, automation }: { appId: string; automation: Automation }) {
  const [results, setResults] = useState<AutomationResults | null>(null);
  useEffect(() => {
    api<AutomationResults>(`/apps/${appId}/automations/${automation.id}/results`)
      .then(setResults)
      .catch(() => setResults(null));
  }, [appId, automation.id]);
  if (!results) return <p className="text-[13px] text-secondary">Loading results…</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ["Got the message", results.sent],
            ["Opened offer or Rate", results.opened],
            ["Replied", results.replied],
            ["Bought within 7 days", results.bought],
          ] as const
        ).map(([text, n]) => (
          <div key={text} className="rounded-2xl bg-white p-3">
            <p className="text-[22px] tracking-[-.02em] text-fg">{n}</p>
            <p className="text-[12px] text-secondary">{text}</p>
          </div>
        ))}
      </div>
      {results.scheduled.length > 0 && (
        <div>
          <p className="text-[13px] text-fg">Scheduled</p>
          {results.scheduled.map((s) => (
            <p key={s.runId} className="text-[13px] text-secondary">
              {s.person} · {new Date(s.nextAt).toLocaleString()}
            </p>
          ))}
        </div>
      )}
      {results.skipped.length > 0 && (
        <div>
          <p className="text-[13px] text-fg">Skipped and stopped</p>
          {results.skipped.map((s) => (
            <p key={s.runId} className="text-[13px] text-secondary">
              {s.person} · {REASONS[s.reason] ?? s.reason} {s.status === "held" && "(waiting for their next event)"} · {relativeTime(s.at)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AutomationsPage() {
  const { appId } = useParams<{ appId: string }>();
  const me = useMe();
  const admin = isAdmin(me);
  const [app, setApp] = useState<App | null>(null);
  const [list, setList] = useState<Automation[] | null>(null);
  const [paywalls, setPaywalls] = useState<AppPaywall[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = () =>
    Promise.all([api<{ app: App }>(`/apps/${appId}`), api<{ automations: Automation[] }>(`/apps/${appId}/automations`), api<{ paywalls: AppPaywall[] }>(`/apps/${appId}/paywalls`)]);
  function apply([a, l, p]: Awaited<ReturnType<typeof fetchAll>>) {
    setApp(a.app);
    setList(l.automations);
    setPaywalls(p.paywalls);
  }
  useEffect(() => {
    fetchAll()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load automations"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per app
  }, [appId]);

  async function save(id: string | null, draft: Draft) {
    await api(id ? `/apps/${appId}/automations/${id}` : `/apps/${appId}/automations`, { method: id ? "PUT" : "POST", body: JSON.stringify(draft) });
    setEditing(null);
    apply(await fetchAll());
  }
  async function toggle(a: Automation) {
    await save(a.id, { ...toDraft(a), enabled: !a.enabled });
  }
  async function remove(a: Automation) {
    if (!window.confirm(`Delete “${a.name}”? Messages it sent stay in the conversations.`)) return;
    await api(`/apps/${appId}/automations/${a.id}`, { method: "DELETE" });
    apply(await fetchAll());
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16">
      <AppHeader className="h-20" />
      <Link href={`/apps/${appId}/settings`} className="inline-flex items-center gap-1.5 text-[14px] text-secondary hover:text-fg">
        <ArrowLeftIcon /> {app?.name ?? "App"} settings
      </Link>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!list || !app ? (
        <Spinner />
      ) : editing ? (
        <main className="mt-6">
          <h1 className="mb-6 text-[32px] leading-[1.1] tracking-[-.04em]">{editing.id ? "Edit automation" : "New automation"}</h1>
          <Builder initial={editing.draft} paywalls={paywalls} me={me} onSave={(d) => save(editing.id, d)} onCancel={() => setEditing(null)} />
        </main>
      ) : (
        <main className="mt-6 space-y-4">
          <div className="flex items-center gap-4">
            <AppIcon app={app} size={48} />
            <div className="flex-1">
              <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">Automations</h1>
              <p className="text-[13px] text-secondary">Messages, offers and rating requests that go out when something happens in the app or the subscription.</p>
            </div>
            {admin && (
              <button type="button" onClick={() => setEditing({ id: null, draft: NEW })} className={secondaryButton}>
                New automation
              </button>
            )}
          </div>
          {list.length === 0 && <p className="rounded-[28px] bg-panel p-6 text-[14px] text-secondary">No automations yet.</p>}
          {list.map((a) => (
            <section key={a.id} className="rounded-[28px] bg-panel p-5 text-[14px]">
              <div className="flex items-start justify-between gap-4">
                <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="text-left">
                  <p className="text-[17px] text-fg">{a.name}</p>
                  <p className="text-[13px] text-secondary">
                    On <span className="font-mono">{a.trigger.event}</span> ·{" "}
                    {a.wait.type === "immediate" ? "right away" : a.wait.type === "delay" ? `after ${a.wait.minutes} min` : `${a.wait.days} day(s) later at ${a.wait.time} their time`} · {a.steps.length} step
                    {a.steps.length === 1 ? "" : "s"}
                  </p>
                </button>
                {admin && (
                  <div className="flex items-center gap-3">
                    <button type="button" role="switch" aria-checked={a.enabled} aria-label={`${a.enabled ? "Disable" : "Enable"} ${a.name}`} onClick={() => void toggle(a)} className={`relative h-7 w-12 rounded-full ${a.enabled ? "bg-[var(--accent)]" : "bg-[var(--field)]"}`}>
                      <span className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${a.enabled ? "translate-x-5" : ""}`} />
                    </button>
                    <button type="button" onClick={() => setEditing({ id: a.id, draft: toDraft(a) })} className="text-[13px] text-secondary hover:text-fg">
                      Edit
                    </button>
                    <button type="button" onClick={() => void remove(a)} className="text-[13px] text-[#b42318]">
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {open === a.id && (
                <div className="mt-4 border-t border-line pt-4">
                  <Results appId={appId} automation={a} />
                </div>
              )}
            </section>
          ))}
        </main>
      )}
    </div>
  );
}
