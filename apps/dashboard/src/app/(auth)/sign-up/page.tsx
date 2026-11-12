"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { safeNext, useSearch } from "@/lib/use-search";

export default function SignUpPage() {
  // a `next` (an invitation being accepted) survives switching to sign-in and wins over onboarding
  const search = useSearch();
  // an invitation link (from a teammate or an app builder) names the address it was sent to
  const invitedEmail = new URLSearchParams(search).get("email") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (error) return setError(error.message ?? "Couldn't create your account");
    // Full page load so the next page starts from the new session, not cached client state.
    window.location.assign(safeNext(window.location.search, "/onboarding/add"));
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Add in-app support to your iOS app in minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/sign-in${search}`} className="text-fg underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" name="name" autoComplete="name" required maxLength={100} />
        <Field key={invitedEmail} label="Email" name="email" type="email" autoComplete="email" required defaultValue={invitedEmail} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="At least 10 characters" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </PrimaryButton>
        <p className="text-center text-[13px] text-secondary">
          By creating an account you agree to the{" "}
          <Link href="/legal/terms" className="underline underline-offset-4 hover:text-fg">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline underline-offset-4 hover:text-fg">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthCard>
  );
}
