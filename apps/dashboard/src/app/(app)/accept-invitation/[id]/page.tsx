"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { secondaryButton } from "@/components/settings";
import { AuthCard, ErrorNote, PrimaryButton, Spinner } from "@/components/ui";
import { SignOutButton } from "@/components/AuthGate";
import { authClient } from "@/lib/auth-client";

type Invitation = NonNullable<Awaited<ReturnType<typeof authClient.organization.getInvitation>>["data"]>;

/**
 * The page an invitation email links to. The (app) layout sends signed-out visitors to sign in (or sign up)
 * and back here; the invitation only opens for the address it was sent to.
 */
export default function AcceptInvitationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = authClient.useSession();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void authClient.organization.getInvitation({ query: { id } }).then(({ data, error }) => {
      if (error) setError(error.message ?? "This invitation can't be opened");
      else setInvitation(data);
    });
  }, [id]);

  async function accept() {
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId: id });
    if (error || !data) {
      setBusy(false);
      return setError(error?.message ?? "Couldn't join the workspace");
    }
    await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
    // Full page load: everything after this belongs to the workspace just joined.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/inbox");
  }

  async function decline() {
    setBusy(true);
    await authClient.organization.rejectInvitation({ invitationId: id });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/inbox");
  }

  if (error && !invitation) {
    return (
      <AuthCard
        title="Invitation"
        subtitle="It may have expired, been cancelled, or been sent to another address."
        footer={<SignOutButton />}
      >
        <ErrorNote>{error}</ErrorNote>
        {session && (
          <p className="mt-3 text-[14px] text-secondary">
            You&apos;re signed in as {session.user.email}. If the invitation went to another address, sign out and sign in with that one.
          </p>
        )}
      </AuthCard>
    );
  }
  if (!invitation) return <Spinner />;
  return (
    <AuthCard
      title={`Join ${invitation.organizationName}`}
      subtitle={`${invitation.inviterEmail} invited you as ${invitation.role === "admin" ? "an admin" : "a member"}.`}
      footer={<span className="text-secondary">Signed in as {session?.user.email}</span>}
    >
      <div className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton type="button" onClick={() => void accept()} disabled={busy}>
          {busy ? "Joining…" : "Join workspace"}
        </PrimaryButton>
        <button type="button" onClick={() => void decline()} disabled={busy} className={`${secondaryButton} w-full`}>
          Decline
        </button>
      </div>
    </AuthCard>
  );
}
