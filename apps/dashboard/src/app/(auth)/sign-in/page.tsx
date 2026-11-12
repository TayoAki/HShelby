"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { safeNext, useSearch } from "@/lib/use-search";

export default function SignInPage() {
  const search = useSearch();
  // a link to join a workspace names the address it was made for
  const invitedEmail = new URLSearchParams(search).get("email") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (error) return setError(error.message ?? "Couldn't sign you in");
    // Full page load: the next page starts from the new session, not cached client state.
    window.location.assign(safeNext(window.location.search, "/apps"));
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your workspace."
      footer={
        <>
          New here?{" "}
          <Link
            href={`/sign-up${search}`}
            className="text-fg underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field key={invitedEmail} label="Email" name="email" type="email" autoComplete="email" required defaultValue={invitedEmail} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <p className="-mt-1 text-right text-[13px]">
          <Link href="/forgot-password" className="text-secondary underline-offset-4 hover:text-fg hover:underline">
            Forgot your password?
          </Link>
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </form>
    </AuthCard>
  );
}
