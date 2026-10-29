"use client";

import { AI_LIMITS, type AiAction, type AiOverview, type AiPreview, type AiRun, type AiSettings, type AiSettingsInput, type App } from "@hshelby/contracts";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { secondaryButton, SettingsCard, SwitchRow } from "@/components/settings";
import { AppIcon, ErrorNote, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import { isAdmin, useMe } from "@/lib/use-me";

const field = "w-full rounded-xl border border-[var(--field)] bg-white px-3 py-2 text-[14px] text-fg outline-none focus:border-fg/60";

const OUTCOMES: Record<AiRun["outcome"], { label: string; tone: string }> = {
  replied: { label: "Replied", tone: "text-[#14773a]" },
  sent_offer: { label: "Sent an offer", tone: "text-[#14773a]" },
  asked_review: { label: "Asked for a rating", tone: "text-[#14773a]" },
  handed_over: { label: "Handed over", tone: "text-[#8a5a00]" },
  stopped: { label: "Stopped (conversation moved on)", tone: "text-secondary" },
  failed: { label: "Failed", tone: "text-[#b42318]" },
};

/** The settings the API takes (it refuses unknown keys). */
const editable = (s: AiSettings | AiSettingsInput): AiSettingsInput => ({
  enabled: s.enabled,
  name: s.name,
  instructions: s.instructions,
  docs: s.docs,
  allowOffers: s.allowOffers,
  allowReviews: s.allowReviews,
});

/** Claude Opus 5.5 list prices per million tokens, for a rough cost; cache writes at the 5-minute rate. */
const cost = (u: AiPreview["usage"]) => (u.inputTokens * 4 + u.outputTokens * 20 + u.cacheReadTokens * 0.2 + u.cacheWriteTokens * 5) / 1e6;
const money = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

function Action({ action }: { action: AiAction }) {
  const what = { reply: "Reply", offer: "Offer", review: "Rating request", handover: "Handover" }[action.type];
  return (
    <div className="rounded-2xl bg-white p-3">
      <p className="text-[12px] tracking-wide text-secondary uppercase">
        {what}
        {action.type === "offer" && ` · ${action.paywallId}`}
      </p>
      {action.type === "handover" ? (
        <>
          <p className="mt-1 text-fg">Reason for the team: {action.reason}</p>
          {action.message && <p className="mt-1 whitespace-pre-wrap">To the person: {action.message}</p>}
        </>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-fg">{action.text}</p>
      )}
    </div>
  );
}

function TryIt({ appId, settings }: { appId: string; settings: AiSettingsInput }) {
  const [text, setText] = useState("How much is Pro?");
  const [result, setResult] = useState<AiPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const { name, instructions, docs, allowOffers, allowReviews } = settings;
      setResult(
        await api<AiPreview>(`/apps/${appId}/ai/preview`, {
          method: "POST",
          body: JSON.stringify({ settings: { name, instructions, docs, allowOffers, allowReviews }, messages: [{ sender: "user", text: text.trim() }] }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the preview");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard title="Try it">
      <p>Write as one of your users. The AI answers with the settings above, saved or not, and nothing is sent to anyone.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={field} aria-label="Message to try" />
      <button type="button" onClick={run} disabled={busy || !text.trim()} className={secondaryButton}>
        {busy ? "Thinking…" : "Ask the AI"}
      </button>
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && (
        <div className="space-y-2">
          {result.actions.map((a, i) => (
            <Action key={i} action={a} />
          ))}
          {result.actions.length === 0 && (
            <p className="rounded-2xl bg-white p-3">{result.refused ? "The model declined to answer; a teammate would get this one." : "No answer chosen; a teammate would get this one."}</p>
          )}
          {result.notes.map((n) => (
            <p key={n} className="text-[13px] text-[#8a5a00]">
              Refused by a guardrail: {n}
            </p>
          ))}
          <p className="text-[12px] text-secondary">
            {(result.latencyMs / 1000).toFixed(1)} s · {result.usage.inputTokens + result.usage.cacheReadTokens} tokens in, {result.usage.outputTokens} out · about {money(cost(result.usage))}
            {result.fallback && " · answered by the fallback model"}
          </p>
        </div>
      )}
    </SettingsCard>
  );
}

export default function AiPage() {
  const { appId } = useParams<{ appId: string }>();
  const me = useMe();
  const admin = isAdmin(me);
  const [app, setApp] = useState<App | null>(null);
  const [overview, setOverview] = useState<AiOverview | null>(null);
  const [draft, setDraft] = useState<AiSettingsInput | null>(null);
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = () =>
    Promise.all([api<{ app: App }>(`/apps/${appId}`), api<AiOverview>(`/apps/${appId}/ai`), api<{ runs: AiRun[] }>(`/apps/${appId}/ai/runs`)]);
  function apply([a, o, r]: Awaited<ReturnType<typeof fetchAll>>) {
    setApp(a.app);
    setOverview(o);
    setDraft(editable(o.settings));
    setRuns(r.runs);
  }
  useEffect(() => {
    fetchAll()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load AI replies"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per app
  }, [appId]);

  const set = (patch: Partial<AiSettingsInput>) => {
    setSaved(false);
    setDraft((d) => d && { ...d, ...patch });
  };

  async function save(next: AiSettingsInput) {
    setBusy(true);
    setError(null);
    try {
      await api(`/apps/${appId}/ai`, { method: "PUT", body: JSON.stringify(next) });
      apply(await fetchAll());
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const last = overview?.last30Days;
  return (
    <div className="mx-auto max-w-3xl px-5 pb-16">
      <AppHeader className="h-20" />
      <Link href={`/apps/${appId}/settings`} className="inline-flex items-center gap-1.5 text-[14px] text-secondary hover:text-fg">
        <ArrowLeftIcon /> {app?.name ?? "App"} settings
      </Link>
      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!app || !overview || !draft ? (
        !error && <Spinner />
      ) : (
        <main className="mt-6 space-y-6">
          <div className="flex items-center gap-4">
            <AppIcon app={app} size={48} />
            <div>
              <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">AI replies</h1>
              <p className="text-[13px] text-secondary">
                Claude answers your users a few seconds after they write: from your docs, with offers and rating requests when they fit, and hands
                over to your team when it should.
              </p>
            </div>
          </div>

          <SettingsCard title="Answering">
            {!overview.available && (
              <ErrorNote>The server has no Anthropic API key yet (ANTHROPIC_API_KEY), so AI replies can&apos;t be turned on.</ErrorNote>
            )}
            <SwitchRow
              label="Answer with AI"
              description="When a teammate replies in a conversation, the AI steps back there until someone hands it back or resolves the conversation."
              checked={overview.settings.enabled}
              onChange={(enabled) => save({ ...draft, enabled })}
              disabled={!admin || busy || (!overview.available && !overview.settings.enabled)}
              disabledReason={admin ? "Needs an Anthropic API key on the server" : "Only workspace owners and admins can change this"}
            />
            {last && last.runs > 0 && (
              <p className="text-[13px]">
                Last 30 days: {last.replied} answered, {last.handedOver} handed over{last.failed > 0 && `, ${last.failed} failed`} · about{" "}
                {money(cost(last.usage))} on {overview.model}
              </p>
            )}
          </SettingsCard>

          <SettingsCard title="What it knows">
            <label className="block">
              <span className="mb-1 block text-fg">Name</span>
              <span className="mb-2 block text-[13px]">Shown as the author of its messages when the app shows team names.</span>
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={AI_LIMITS.name} disabled={!admin} className={`${field} max-w-xs`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-fg">Instructions</span>
              <span className="mb-2 block text-[13px]">Tone, what to always hand over, what never to say.</span>
              <textarea
                value={draft.instructions}
                onChange={(e) => set({ instructions: e.target.value })}
                maxLength={AI_LIMITS.instructions}
                rows={4}
                disabled={!admin}
                placeholder="Keep it short and friendly. Hand over anything about Android."
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-fg">Docs</span>
              <span className="mb-2 block text-[13px]">
                Your help pages, FAQ, prices and policies, pasted as text. The AI answers from these and hands over what they don&apos;t cover.
              </span>
              <textarea
                value={draft.docs}
                onChange={(e) => set({ docs: e.target.value })}
                maxLength={AI_LIMITS.docs}
                rows={12}
                disabled={!admin}
                className={`${field} font-mono text-[12.5px]`}
              />
              <span className="mt-1 block text-[12px] text-secondary">
                {draft.docs.length.toLocaleString()} / {AI_LIMITS.docs.toLocaleString()} characters · about {Math.ceil(draft.docs.length / 4).toLocaleString()} tokens
              </span>
            </label>
            <div className="space-y-4 border-t border-line pt-4">
              <SwitchRow
                label="Send offers"
                description="Only paywalls the person's app reported it can show."
                checked={draft.allowOffers}
                onChange={(allowOffers) => set({ allowOffers })}
                disabled={!admin}
              />
              <SwitchRow
                label="Ask for ratings"
                description="Only after it helped, with the app's App Store ID set, and not if they were asked in the last 120 days."
                checked={draft.allowReviews}
                onChange={(allowReviews) => set({ allowReviews })}
                disabled={!admin}
              />
            </div>
            {admin && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => save(draft)} disabled={busy} className={secondaryButton}>
                  Save
                </button>
                {saved && <span className="text-[13px] text-[#14773a]">Saved</span>}
              </div>
            )}
          </SettingsCard>

          {admin && overview.available && <TryIt appId={appId} settings={draft} />}

          <SettingsCard title="Recent answers">
            {runs.length === 0 ? (
              <p>Nothing yet.</p>
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {runs.map((r) => {
                    const said = r.actions.find((a) => a.type !== "handover");
                    const handover = r.actions.find((a) => a.type === "handover");
                    return (
                      <tr key={r.id} className="border-t border-line align-top">
                        <td className="py-2 pr-2 whitespace-nowrap text-secondary">{relativeTime(r.createdAt)}</td>
                        <td className="py-2 pr-2">
                          <Link href={`/inbox/${r.conversationId}`} className="text-fg hover:underline">
                            {r.person}
                          </Link>
                        </td>
                        <td className="py-2 pr-2">
                          <span className={OUTCOMES[r.outcome].tone}>{OUTCOMES[r.outcome].label}</span>
                          {r.fallback && <span className="text-secondary"> · fallback model</span>}
                          {said && <span className="block text-fg/80">{said.text}</span>}
                          {handover?.type === "handover" && <span className="block text-secondary">{handover.reason}</span>}
                          {r.notes.map((n) => (
                            <span key={n} className="block text-[#8a5a00]">
                              Refused: {n}
                            </span>
                          ))}
                          {r.error && <span className="block text-[#b42318]">{r.error}</span>}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap text-secondary">{(r.latencyMs / 1000).toFixed(1)} s</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SettingsCard>
        </main>
      )}
    </div>
  );
}
