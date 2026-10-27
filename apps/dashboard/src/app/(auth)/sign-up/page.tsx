"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
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
    // Full page load so the onboarding page starts from the new session, not cached client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/onboarding/add");
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Add in-app support to your iOS app in minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="text-fg underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" name="name" autoComplete="name" required maxLength={100} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="At least 10 characters" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </PrimaryButton>
      </form>
    </AuthCard>
  );
}
