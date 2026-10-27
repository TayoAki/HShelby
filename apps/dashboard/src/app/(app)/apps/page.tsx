"use client";

import type { App, Me } from "@hshelby/contracts";
import { CheckIcon, CopyIcon, PlusIcon } from "@radix-ui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignOutButton } from "@/components/AuthGate";
import { BrandMark, ErrorNote, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/use-copy";

function AppIdButton({ publicId }: { publicId: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" onClick={() => copy(publicId)} className="flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 font-mono text-[12px] text-secondary hover:text-fg">
      {publicId}
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

export default function AppsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<App[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<{ apps: App[] }>("/apps"), api<Me>("/me")])
      .then(([a, m]) => {
        // First visit: go straight into onboarding.
        if (a.apps.length === 0) return router.replace("/onboarding/add");
        setApps(a.apps);
        setMe(m);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load your apps"));
  }, [router]);

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16">
      <header className="flex h-20 items-center justify-between">
        <Link href="/apps" className="text-[22px]">
          <BrandMark />
        </Link>
        <div className="flex items-center gap-6">
          {me && <span className="hidden text-[14px] text-secondary sm:inline">{me.user.email}</span>}
          <SignOutButton />
        </div>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!apps && !error && <Spinner />}

      {apps && (
        <main className="pt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[14px] text-secondary">{me?.organization?.name}</p>
              <h1 className="text-[40px] leading-[1.1] tracking-[-.045em]">Your apps</h1>
            </div>
            <Link href="/onboarding/add" className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[14px] text-white hover:bg-[var(--accent-hover)]">
              <PlusIcon /> Add app
            </Link>
          </div>
          <ul className="mt-8 space-y-3">
            {apps.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center gap-4 rounded-[28px] bg-panel p-4 pr-6">
                {app.iconUrl ? (
                  <Image src={app.iconUrl} alt="" width={56} height={56} unoptimized className="size-14 rounded-[22%] outline outline-1 -outline-offset-1 outline-black/5" />
                ) : (
                  <span className="flex size-14 items-center justify-center rounded-[22%] bg-white text-[22px] text-secondary">{app.name[0]}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px]">{app.name}</p>
                  <p className="text-[13px] text-secondary">{app.firstMessageAt ? "Connected" : "Waiting for the first message"}</p>
                </div>
                <AppIdButton publicId={app.publicId} />
                <Link href={`/onboarding/${app.id}/connect`} className="text-[14px] underline-offset-4 hover:underline">
                  Setup
                </Link>
              </li>
            ))}
          </ul>
        </main>
      )}
    </div>
  );
}
