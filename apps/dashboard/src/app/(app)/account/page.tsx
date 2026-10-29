"use client";

import type { Me } from "@hshelby/contracts";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { secondaryButton, SettingsCard } from "@/components/settings";
import { ErrorNote, Spinner } from "@/components/ui";
import { api, apiForm } from "@/lib/api";

/** The teammate's own profile: the photo apps show beside their replies when team photos are on. */
export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Me>("/me")
      .then(setMe)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load your account"));
  }, []);

  async function upload(file: File | undefined) {
    if (!file || !me) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const { photoUrl } = await apiForm<{ photoUrl: string }>("/me/photo", form, "PUT");
      setMe({ ...me, user: { ...me.user, photoUrl } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!me) return;
    setBusy(true);
    try {
      await api("/me/photo", { method: "DELETE" });
      setMe({ ...me, user: { ...me.user, photoUrl: null } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16">
      <AppHeader className="h-20" />
      <main className="mt-4 space-y-6">
        <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">Your account</h1>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!me ? (
          <Spinner />
        ) : (
          <SettingsCard title="Profile photo">
            <div className="flex items-center gap-4">
              {me.user.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed bucket URL
                <img src={me.user.photoUrl} alt="" className="size-16 rounded-full object-cover" />
              ) : (
                <span className="flex size-16 items-center justify-center rounded-full bg-white text-[24px] text-secondary">{me.user.name[0]}</span>
              )}
              <div>
                <p className="text-fg">{me.user.name}</p>
                <p>{me.user.email}</p>
              </div>
            </div>
            <p>Apps with “Show team photos” on show it beside your replies (your initial without one). It&apos;s cropped square and stripped of metadata.</p>
            <div className="flex gap-2">
              <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />
              <button type="button" onClick={() => input.current?.click()} disabled={busy} className={secondaryButton}>
                {busy ? "Uploading…" : me.user.photoUrl ? "Change photo" : "Upload photo"}
              </button>
              {me.user.photoUrl && (
                <button type="button" onClick={() => void remove()} disabled={busy} className={`${secondaryButton} text-[#b42318]`}>
                  Remove
                </button>
              )}
            </div>
          </SettingsCard>
        )}
      </main>
    </div>
  );
}
