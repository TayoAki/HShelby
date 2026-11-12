"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard, ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setBusy(true);
    setError(null);
    // the answer is the same whether or not the address has an account, so it can't be used to look one up
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    if (error) return setError(error.message ?? "Couldn't send the email. Try again in a minute.");
    setSentTo(email);
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle={sentTo ? "Check your inbox." : "We'll email you a link to choose a new one."}
      footer={
        <Link href="/sign-in" className="text-fg underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <p className="text-[15px]">
          If {sentTo} has an account, a link is on its way. It works for an hour. Nothing there? Check spam, or try again.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          {error && <ErrorNote>{error}</ErrorNote>}
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Sending…" : "Email me a link"}
          </PrimaryButton>
        </form>
      )}
    </AuthCard>
  );
}
