"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { useHydrated, useSearch } from "@/lib/use-search";

/** The emailed link lands here with ?token= (or ?error=INVALID_TOKEN when it's expired or used). */
export default function ResetPasswordPage() {
  const hydrated = useHydrated();
  const params = new URLSearchParams(useSearch());
  const token = params.get("token");
  // the query string is only known once hydrated
  const linkError = hydrated && (params.has("error") || !token);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword, token: token! });
    setBusy(false);
    if (error) return setError(error.message ?? "Couldn't change the password. The link may have expired.");
    setDone(true);
  }

  const backToSignIn = (
    <Link href="/sign-in" className="text-fg underline-offset-4 hover:underline">
      Sign in
    </Link>
  );

  if (done) {
    return (
      <AuthCard title="Password changed" subtitle="You're signed out everywhere else." footer={backToSignIn}>
        <p className="text-[15px]">Sign in with your new password.</p>
      </AuthCard>
    );
  }
  if (linkError) {
    return (
      <AuthCard title="That link doesn't work" subtitle="Reset links work once, for an hour." footer={backToSignIn}>
        <p className="text-[15px]">
          <Link href="/forgot-password" className="underline underline-offset-4">
            Get a new link
          </Link>
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="At least 10 characters." footer={backToSignIn}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <Field label="Repeat it" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton type="submit" disabled={busy || !token}>
          {busy ? "Saving…" : "Save password"}
        </PrimaryButton>
      </form>
    </AuthCard>
  );
}
