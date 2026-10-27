"use client";

import type { App, AppStoreResult, AppStoreSearch } from "@hshelby/contracts";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { OnboardingShell, StepTitle } from "@/components/Onboarding";
import { StoreListingPreview } from "@/components/Previews";
import { ErrorNote, Field, PrimaryButton, TextButton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function AddAppPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AppStoreResult[]>([]);
  const [selected, setSelected] = useState<AppStoreResult | null>(null);
  const [manual, setManual] = useState(false);
  const [manualName, setManualName] = useState("");
  const [error, setError] = useState<{ message: string; existing?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Debounced App Store search; stale responses are dropped.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || selected) return;
    let stale = false;
    const timer = setTimeout(() => {
      api<AppStoreSearch>(`/appstore/search?q=${encodeURIComponent(q)}`)
        .then((r) => !stale && setResults(r.results))
        .catch((e: unknown) => !stale && setError({ message: e instanceof Error ? e.message : "Search failed" }));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, selected]);

  const showResults = !selected && query.trim().length >= 2 && results.length > 0;

  async function create(body: { appStoreId: string } | { name: string }) {
    setBusy(true);
    setError(null);
    try {
      const { app } = await api<{ app: App }>("/apps", { method: "POST", body: JSON.stringify(body) });
      router.push(`/onboarding/${app.id}/connect`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) setError({ message: e.message, existing: e.code === "app_already_added" });
      else setError({ message: "Couldn't add your app" });
    }
  }

  function onManualSubmit(event: FormEvent) {
    event.preventDefault();
    if (manualName.trim()) void create({ name: manualName.trim() });
  }

  const preview = manual ? (
    <StoreListingPreview name={manualName.trim() || undefined} seller="Not on the App Store yet" />
  ) : (
    <StoreListingPreview name={selected?.name} iconUrl={selected?.iconUrl} seller={selected?.sellerName} />
  );

  return (
    <OnboardingShell current={0} previewLabel="Your App Store listing" preview={preview}>
      <StepTitle
        title="Add your app"
        subtitle={manual ? "Give it a name. You can link the App Store listing later." : "Find it on the App Store. We bring in its name and icon."}
      />

      {manual ? (
        <form onSubmit={onManualSubmit} className="mt-10 space-y-6">
          <Field label="App name" value={manualName} onChange={(e) => setManualName(e.target.value)} maxLength={100} autoFocus required />
          {error && <ErrorNote>{error.message}</ErrorNote>}
          <PrimaryButton type="submit" disabled={busy || !manualName.trim()}>
            {busy ? "Adding…" : "Add app"}
          </PrimaryButton>
          <TextButton type="button" onClick={() => setManual(false)}>
            Search the App Store instead
          </TextButton>
        </form>
      ) : (
        <div className="mt-10 space-y-6">
          <div className="relative text-left">
            <label className="flex h-16 items-center gap-3 rounded-full border-2 border-[var(--field)] bg-white px-6 transition-colors focus-within:border-fg/50">
              <MagnifyingGlassIcon aria-hidden="true" className="size-5 shrink-0 text-secondary" />
              <span className="sr-only">App name or App Store link</span>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                  setError(null);
                }}
                placeholder="App name or App Store link"
                autoComplete="off"
                className="h-full w-full bg-transparent text-[18px] outline-none placeholder:text-secondary"
              />
            </label>
            {showResults && (
              <ul role="listbox" aria-label="App Store results" className="absolute inset-x-0 top-[calc(100%+8px)] z-10 max-h-[360px] overflow-y-auto rounded-3xl bg-white p-2 shadow-[0_12px_36px_rgb(0_0_0/12%),0_0_0_1px_rgb(0_0_0/4%)]">
                {results.map((r) => (
                  <li key={r.appStoreId} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(r);
                        setQuery(r.name);
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-panel"
                    >
                      {r.iconUrl ? (
                        <Image src={r.iconUrl} alt="" width={44} height={44} unoptimized loading="eager" className="size-11 rounded-[22%] outline outline-1 -outline-offset-1 outline-black/5" />
                      ) : (
                        <span className="size-11 rounded-[22%] bg-panel" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[15px]">{r.name}</span>
                        <span className="block truncate text-[13px] text-secondary">{[r.sellerName, r.genre].filter(Boolean).join(" · ")}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <ErrorNote>
              {error.message}
              {error.existing && (
                <>
                  {" "}
                  <Link href="/apps" className="underline underline-offset-4">
                    Go to your apps
                  </Link>
                </>
              )}
            </ErrorNote>
          )}

          <div className="pt-10">
            <PrimaryButton type="button" disabled={!selected || busy} onClick={() => selected && create({ appStoreId: selected.appStoreId })}>
              {busy ? "Adding…" : "Choose your app"}
            </PrimaryButton>
          </div>
          <TextButton type="button" onClick={() => setManual(true)}>
            My app isn’t on the App Store yet
          </TextButton>
        </div>
      )}
    </OnboardingShell>
  );
}
