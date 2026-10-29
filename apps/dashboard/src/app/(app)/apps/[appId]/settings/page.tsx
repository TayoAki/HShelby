"use client";

import { IDENTITY_SECRET_ENV, type App, type IdentitySecret } from "@hshelby/contracts";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { PaywallsCard, ReviewsAndOffersCard } from "@/components/CardSettingsCards";
import { IntegrationsCard } from "@/components/IntegrationsCard";
import { PushSettingsCard } from "@/components/PushSettingsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { CopyBlock, secondaryButton, SettingsCard, SwitchRow } from "@/components/settings";
import { AppIcon, ErrorNote, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import { isAdmin, useMe } from "@/lib/use-me";

const snippet = `import { SignJWT } from "jose";

// Behind your own auth: the user comes from the session, never from the request.
export async function supportToken(user) {
  return new SignJWT({ user_id: user.id, name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(process.env.${IDENTITY_SECRET_ENV}));
}`;

export default function AppSettingsPage() {
  const { appId } = useParams<{ appId: string }>();
  const me = useMe();
  const admin = isAdmin(me);
  const [app, setApp] = useState<App | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [unverifyExisting, setUnverifyExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ app: App }>(`/apps/${appId}`)
      .then((r) => setApp(r.app))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load this app"));
  }, [appId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const reveal = () =>
    run(async () => {
      setSecret((await api<IdentitySecret>(`/apps/${appId}/identity-secret/reveal`, { method: "POST" })).secret);
    });

  const regenerate = () => {
    const warning = unverifyExisting
      ? "Regenerate the secret and mark every user unverified? Tokens signed with the old secret stop working at once."
      : "Regenerate the secret? Tokens signed with the old secret stop working at once, so update your server right away.";
    if (!window.confirm(warning)) return;
    return run(async () => {
      const { secret: next } = await api<IdentitySecret>(`/apps/${appId}/identity-secret/rotate`, {
        method: "POST",
        body: JSON.stringify({ unverifyExisting }),
      });
      setSecret(next);
      setApp((a) => a && { ...a, identitySecretRotatedAt: new Date().toISOString() });
      setUnverifyExisting(false);
    });
  };

  const toggleOnlyVerified = () =>
    run(async () => {
      if (!app) return;
      const { app: updated } = await api<{ app: App }>(`/apps/${appId}`, {
        method: "PATCH",
        body: JSON.stringify({ onlyVerified: !app.onlyVerified }),
      });
      setApp(updated);
    });

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16">
      <AppHeader className="h-20" />
      <Link href="/apps" className="inline-flex items-center gap-1.5 text-[14px] text-secondary hover:text-fg">
        <ArrowLeftIcon /> Apps
      </Link>
      {!app && !error && <Spinner />}
      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {app && (
        <main className="mt-6 space-y-6">
          <div className="flex items-center gap-4">
            <AppIcon app={app} size={56} />
            <div>
              <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">{app.name}</h1>
              <p className="mt-1 font-mono text-[13px] text-secondary">{app.publicId}</p>
            </div>
          </div>

          <SettingsCard title="Chat design">
            <p>
              Colors, texts, icons and card styling for the chat inside the app, set here instead of in code. Edit a
              draft and publish it; apps switch to it the next time their chat opens.
            </p>
            <Link href={`/apps/${app.id}/appearance`} className={`inline-flex items-center ${secondaryButton}`}>
              Open the design editor
            </Link>
          </SettingsCard>

          <SettingsCard title="Identity verification">
            <p>
              Your server signs a short token for the signed-in user, so your team can trust who they&apos;re talking to.
              The app passes it to the SDK; we store the verified claims, never the token. Users with a valid token get
              a verified seal in the inbox.
            </p>
            <p>
              Tokens are <strong>HS256</strong> JWTs signed with this app&apos;s identity secret, used as-is (including
              its <code className="font-mono text-[13px]">ids_</code> prefix). <code className="font-mono text-[13px]">user_id</code> and{" "}
              <code className="font-mono text-[13px]">exp</code> are required (7 days is a good expiry);{" "}
              <code className="font-mono text-[13px]">name</code> and <code className="font-mono text-[13px]">email</code> are optional.
            </p>
            <CopyBlock value={snippet} />

            <div className="border-t border-line pt-4">
              <p className="text-fg">Identity secret</p>
              {admin ? (
                <>
                  <p className="mt-1">
                    Store it on your server as <code className="font-mono text-[13px]">{IDENTITY_SECRET_ENV}</code>. Never put it in the app or share it in chat.
                  </p>
                  {secret ? (
                    <div className="mt-3">
                      <CopyBlock value={secret} />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={reveal}
                      disabled={busy}
                      className={`mt-3 ${secondaryButton}`}
                    >
                      Reveal secret
                    </button>
                  )}
                  <div className="mt-4 rounded-2xl bg-white p-4 outline outline-1 -outline-offset-1 outline-black/5">
                    <p className="text-fg">Regenerate secret</p>
                    <p className="mt-1">
                      Tokens signed with the old secret stop working at once.
                      {app.identitySecretRotatedAt && ` Last regenerated ${relativeTime(app.identitySecretRotatedAt)}.`}
                    </p>
                    <label className="mt-3 flex items-center gap-2 text-[14px]">
                      <input
                        type="checkbox"
                        checked={unverifyExisting}
                        onChange={(e) => setUnverifyExisting(e.target.checked)}
                        className="size-4 accent-[var(--accent)]"
                      />
                      Also mark existing users as unverified (if the secret leaked)
                    </label>
                    <button
                      type="button"
                      onClick={regenerate}
                      disabled={busy}
                      className="mt-3 h-10 rounded-full bg-panel px-4 text-[14px] text-[#b42318] hover:bg-[var(--panel-hover)]"
                    >
                      Regenerate secret
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-1">Only workspace owners and admins can view or change the secret.</p>
              )}
            </div>

            <div className="border-t border-line pt-4">
              <SwitchRow
                label="Only verified users can chat"
                description="Unverified users can read the conversation but can't send; their app asks them to sign in. Turn this on once your app sends tokens."
                checked={app.onlyVerified}
                onChange={toggleOnlyVerified}
                disabled={!admin || busy}
                disabledReason="Only workspace owners and admins can change this"
              />
            </div>
          </SettingsCard>

          <PushSettingsCard app={app} admin={admin} />
          <TelegramSettingsCard app={app} admin={admin} />
          <ReviewsAndOffersCard app={app} admin={admin} onAppChange={setApp} />
          <PaywallsCard app={app} />
          <SettingsCard title="AI replies">
            <p>Claude answers your users from your docs a few seconds after they write, and hands over to your team when it should.</p>
            <Link href={`/apps/${app.id}/ai`} className={`inline-flex items-center ${secondaryButton}`}>
              Open AI replies
            </Link>
          </SettingsCard>
          <SettingsCard title="Automations">
            <p>Messages, offers and rating requests that go out on their own when someone declines a paywall, cancels a subscription and more.</p>
            <Link href={`/apps/${app.id}/automations`} className={`inline-flex items-center ${secondaryButton}`}>
              Open automations
            </Link>
          </SettingsCard>
          <IntegrationsCard app={app} admin={admin} />
        </main>
      )}
    </div>
  );
}
