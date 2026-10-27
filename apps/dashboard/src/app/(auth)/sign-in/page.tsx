"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/** Only same-site paths are allowed as a post-sign-in destination. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/apps";
}

export default function SignInPage() {
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
    window.location.assign(nextPath());
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your workspace."
      footer={
        <>
          New here?{" "}
          <Link href="/sign-up" className="text-fg underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </form>
    </AuthCard>
  );
}
