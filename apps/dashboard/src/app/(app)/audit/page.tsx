"use client";

import { PROVIDER_NAMES, type AuditEvent, type AuditPage, type Provider } from "@hshelby/contracts";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { secondaryButton } from "@/components/settings";
import { ErrorNote, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** What an event says, in words. Unknown actions show as they're stored. */
function describe(e: AuditEvent) {
  const m = e.metadata ?? {};
  const target = e.target?.label ?? "a deleted item";
  const provider = (PROVIDER_NAMES as Record<string, string>)[str(m.provider) as Provider] ?? str(m.provider);
  const lines: Record<string, string> = {
    "app.deleted": `Deleted ${target}`,
    "app.app_store_id.changed": `Changed ${target}'s App Store ID${m.to ? ` to ${str(m.to)}` : ""}`,
    "app.only_verified.enabled": `Turned on “only verified users can chat” for ${target}`,
    "app.only_verified.disabled": `Turned off “only verified users can chat” for ${target}`,
    "app.identity_secret.revealed": `Revealed ${target}'s identity secret`,
    "app.identity_secret.rotated": `Regenerated ${target}'s identity secret`,
    "app.push.key_uploaded": `Uploaded an APNs key for ${target}`,
    "app.push.updated": `Changed push settings for ${target}`,
    "app.push.removed": `Removed push settings from ${target}`,
    "app.appearance.published": `Published ${target}'s chat design${m.version ? ` (version ${str(m.version)})` : ""}`,
    "app.ai.enabled": `Turned on AI replies for ${target}`,
    "app.ai.disabled": `Turned off AI replies for ${target}`,
    "app.ai.knowledge_changed": `Changed what ${target}'s AI knows`,
    "automation.created": `Created the automation “${str(m.name)}” in ${target}`,
    "automation.updated": `Changed the automation “${str(m.name)}” in ${target}`,
    "automation.deleted": `Deleted the automation “${str(m.name)}” from ${target}`,
    "integration.connected": `Connected ${provider} to ${target}`,
    "integration.disconnected": `Disconnected ${provider} from ${target}`,
    "telegram.connected": `Connected Telegram${m.bot ? ` (@${str(m.bot)})` : ""} to ${target}`,
    "telegram.disconnected": `Disconnected Telegram from ${target}`,
    "device.blocked": `Blocked ${target}`,
    "device.unblocked": `Unblocked ${target}`,
    "device.deleted": `Deleted ${e.target?.label ? `${target}'s` : "a user's"} data`,
    "invitation.created": `Invited ${str(m.email)} as ${str(m.role)}`,
    "member.added": `${str(m.name) || str(m.email)} joined as ${str(m.role)}`,
    "member.removed": `${str(m.name) || str(m.email)} was removed`,
    "member.role_changed": `${str(m.name) || str(m.email)} changed from ${str(m.from)} to ${str(m.to)}`,
  };
  return lines[e.action] ?? `${e.action}${e.target ? ` · ${target}` : ""}`;
}

/** The workspace's audit log, for owners and admins. */
export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchPage = (from: string | null) => api<AuditPage>(`/audit${from ? `?cursor=${encodeURIComponent(from)}` : ""}`);
  useEffect(() => {
    fetchPage(null)
      .then((p) => {
        setEvents(p.events);
        setCursor(p.nextCursor);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the audit log"));
  }, []);

  async function more() {
    setBusy(true);
    try {
      const p = await fetchPage(cursor);
      setEvents((list) => [...(list ?? []), ...p.events]);
      setCursor(p.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16">
      <AppHeader className="h-20" />
      <main className="mt-6 space-y-4">
        <div>
          <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">Audit log</h1>
          <p className="mt-1 text-[13px] text-secondary">Changes to the workspace&apos;s apps, users and team, and who made them. Visible to owners and admins.</p>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!events && !error && <Spinner />}
        {events && (
          <section className="rounded-[28px] bg-panel p-6">
            {events.length === 0 ? (
              <p className="text-[14px] text-secondary">Nothing yet.</p>
            ) : (
              <table className="w-full text-[14px]">
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-t border-line align-top first:border-t-0">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-secondary" title={new Date(e.createdAt).toLocaleString()}>
                        {relativeTime(e.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3 text-fg">{describe(e)}</td>
                      <td className="py-2.5 text-right text-secondary">{e.actor?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {cursor && (
              <button type="button" onClick={more} disabled={busy} className={`mt-4 ${secondaryButton}`}>
                {busy ? "Loading…" : "Load older"}
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
