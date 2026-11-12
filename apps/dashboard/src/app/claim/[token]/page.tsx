"use client";

import type { PartnerClaimInfo } from "@hshelby/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignOutButton } from "@/components/AuthGate";
import { secondaryButton } from "@/components/settings";
import { AuthCard, ErrorNote, PrimaryButton, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

/**
 * A partner's one-time link (App Builder's "Open support inbox"): the owner signs up or in with the address it was
 * made for, then joins the workspace as its owner and lands in the inbox. Public: it starts signed out.
 */
export default function ClaimPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [claim, setClaim] = useState<PartnerClaimInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PartnerClaimInfo>(`/partner-claims/${encodeURIComponent(token)}`).then(setClaim, () => setMissing(true));
  }, [token]);

  const signedInAs = session?.user.email.toLowerCase() ?? null;
  const ready = claim?.status === "valid" && signedInAs === claim.email;

  // signed in with the right address: join, then the inbox
  useEffect(() => {
    if (!ready) return;
    api(`/partner-claims/${encodeURIComponent(token)}/accept`, { method: "POST" }).then(
      // Full page load: everything after this belongs to the workspace just joined.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      () => window.location.assign("/inbox"),
      (err: unknown) => setError(err instanceof ApiError ? err.message : "Couldn't join the workspace"),
    );
  }, [ready, token]);

  const here = `/claim/${encodeURIComponent(token)}`;
  const withEmail = (path: string) => `${path}?email=${encodeURIComponent(claim?.email ?? "")}&next=${encodeURIComponent(here)}`;

  if (missing || claim?.status === "used" || claim?.status === "expired") {
    return (
      <AuthCard
        title={claim?.status === "used" ? "This link was already used" : claim?.status === "expired" ? "This link has expired" : "This link doesn't work"}
        subtitle={`Links to join are one-time and last a week. Open the support inbox from ${claim?.partnerName ?? "App Builder"} again for a new one, or sign in if you've joined before.`}
        footer={<span />}
      >
        <Link href="/sign-in?next=%2Finbox" className={`${secondaryButton} block w-full text-center`}>
          Sign in
        </Link>
      </AuthCard>
    );
  }
  if (!claim || isPending) return <Spinner />;

  if (signedInAs && signedInAs !== claim.email) {
    return (
      <AuthCard
        title={`Join ${claim.workspaceName}`}
        subtitle={`This link is for ${claim.email}, and you're signed in as ${session!.user.email}. Sign out, then open the link again.`}
        footer={<SignOutButton />}
      >
        <span />
      </AuthCard>
    );
  }
  if (signedInAs) {
    return (
      <AuthCard title={`Joining ${claim.workspaceName}…`} subtitle="Taking you to your inbox." footer={<span />}>
        {error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Join ${claim.workspaceName}`}
      subtitle={`${claim.partnerName} set up Hire Shelby for your apps. Continue with ${claim.email} to answer your users.`}
      footer={<span className="text-secondary">Your users&apos; messages are already waiting here.</span>}
    >
      <div className="space-y-3">
        <PrimaryButton type="button" onClick={() => router.push(withEmail("/sign-up"))}>
          Create your account
        </PrimaryButton>
        <Link href={withEmail("/sign-in")} className={`${secondaryButton} block w-full text-center`}>
          I already have an account
        </Link>
      </div>
    </AuthCard>
  );
}
