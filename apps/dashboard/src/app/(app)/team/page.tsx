"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { secondaryButton, SettingsCard } from "@/components/settings";
import { ErrorNote, Field, PrimaryButton, Spinner } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { useCopy } from "@/lib/use-copy";
import { isAdmin, useMe } from "@/lib/use-me";

/** What getFullOrganization returns that this page uses. */
type Organization = {
  name: string;
  members: { id: string; userId: string; role: string; user: { name: string; email: string } }[];
  invitations: { id: string; email: string; role: string | null; status: string; expiresAt: string | Date }[];
};

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** The workspace's people: who's in it, who's invited, and (for owners and admins) inviting and removing. */
export default function TeamPage() {
  const me = useMe();
  const admin = isAdmin(me);
  const [org, setOrg] = useState<Organization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(
    () =>
      authClient.organization.getFullOrganization().then(({ data, error }) => {
        if (error) setError(error.message ?? "Couldn't load the team");
        else setOrg(data as unknown as Organization);
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setError(null);
    const { error } = await authClient.organization.inviteMember({
      email: String(form.get("email")).trim(),
      role: form.get("role") === "admin" ? "admin" : "member",
    });
    setBusy(false);
    if (error) return setError(error.message ?? "Couldn't send the invitation");
    formEl.reset();
    await load();
  }

  async function act(run: () => Promise<{ error: { message?: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await run();
    setBusy(false);
    if (error) setError(error.message ?? "That didn't work");
    await load();
  }

  const pending = org?.invitations.filter((i) => i.status === "pending" && new Date(i.expiresAt) > new Date()) ?? [];
  const inviteLink = (id: string) => `${window.location.origin}/accept-invitation/${id}`;

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16">
      <AppHeader className="h-20" />
      {!org || !me ? (
        error ? <ErrorNote>{error}</ErrorNote> : <Spinner />
      ) : (
        <main className="mt-6 space-y-6">
          <div>
            <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">Team</h1>
            <p className="mt-1 text-[13px] text-secondary">Everyone here answers {org.name}&apos;s chats. Owners and admins manage apps, billing and the team.</p>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}

          <SettingsCard title="People">
            <ul className="divide-y divide-line text-[14px]">
              {org.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-fg">
                      {m.user.name}
                      {m.userId === me.user.id && <span className="text-secondary"> (you)</span>}
                    </p>
                    <p className="truncate text-secondary">{m.user.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-secondary">{ROLE_LABEL[m.role] ?? m.role}</span>
                    {admin && m.role !== "owner" && m.userId !== me.user.id && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Remove ${m.user.name} from ${org.name}? They lose access right away.`)) {
                            void act(() => authClient.organization.removeMember({ memberIdOrEmail: m.id }));
                          }
                        }}
                        className="text-[13px] text-[#b42318] hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </SettingsCard>

          {admin && (
            <SettingsCard title="Invite someone">
              <form onSubmit={invite} className="space-y-3">
                <Field label="Email" name="email" type="email" autoComplete="off" required />
                <label className="block text-[14px]">
                  <span className="mb-1 block text-secondary">Role</span>
                  <select name="role" defaultValue="member" className="h-10 w-full rounded-xl border border-[var(--field)] bg-white px-3">
                    <option value="member">Member: answers chats</option>
                    <option value="admin">Admin: also manages apps, billing and the team</option>
                  </select>
                </label>
                <PrimaryButton type="submit" disabled={busy}>
                  {busy ? "Inviting…" : "Send invitation"}
                </PrimaryButton>
                <p className="text-[13px] text-secondary">
                  They get an email with a link that works for 48 hours. Inviting needs a subscription:{" "}
                  <Link href="/billing" className="underline underline-offset-4">
                    Billing
                  </Link>
                  .
                </p>
              </form>
            </SettingsCard>
          )}

          {pending.length > 0 && (
            <SettingsCard title="Invited">
              <ul className="divide-y divide-line text-[14px]">
                {pending.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-fg">{i.email}</p>
                      <p className="text-secondary">
                        {ROLE_LABEL[i.role ?? "member"] ?? i.role} · until {new Date(i.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    {admin && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCopiedId(i.id);
                            void copy(inviteLink(i.id));
                          }}
                          className={secondaryButton}
                        >
                          {copied && copiedId === i.id ? "Copied" : "Copy link"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(() => authClient.organization.cancelInvitation({ invitationId: i.id }))}
                          className={secondaryButton}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </SettingsCard>
          )}
        </main>
      )}
    </div>
  );
}
