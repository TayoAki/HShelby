"use client";

import { ASSET_LIMITS, type AssetLibrary } from "@hshelby/contracts";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { secondaryButton } from "@/components/settings";
import { ErrorNote, Spinner } from "@/components/ui";
import { apiForm, api } from "@/lib/api";
import { isAdmin, useMe } from "@/lib/use-me";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

/** The workspace's images for app designs: transparent PNGs of at most 512 px, shared by every app. */
export default function AssetsPage() {
  const admin = isAdmin(useMe());
  const [library, setLibrary] = useState<AssetLibrary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => api<AssetLibrary>("/assets").then(setLibrary);
  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the library"));
  }, []);

  async function upload(files: FileList | null) {
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files ?? [])) {
        if (file.size > ASSET_LIMITS.uploadBytes) throw new Error(`${file.name} is over 2 MB`);
        const form = new FormData();
        form.set("file", file);
        await apiForm("/assets", form);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this image?")) return;
    setError(null);
    try {
      await api(`/assets/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16">
      <AppHeader className="h-20" />
      <main className="mt-4 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">Asset library</h1>
            <p className="mt-1 text-[14px] text-secondary">
              Images for your apps&apos; chat design. SVG, PNG, JPEG or WebP up to 2 MB, stored as a transparent PNG of at most 512 px.
            </p>
          </div>
          {admin && (
            <>
              <input ref={input} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void upload(e.target.files)} />
              <button type="button" onClick={() => input.current?.click()} disabled={busy} className={secondaryButton}>
                {busy ? "Uploading…" : "Upload images"}
              </button>
            </>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!library ? (
          <Spinner />
        ) : (
          <>
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-panel">
                <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, (library.usedBytes / library.quotaBytes) * 100)}%` }} />
              </div>
              <p className="mt-1 text-[12px] text-secondary">
                {mb(library.usedBytes)} of {mb(library.quotaBytes)} used
              </p>
            </div>
            {library.assets.length === 0 ? (
              <p className="rounded-[28px] bg-panel p-6 text-[14px] text-secondary">No images yet. Upload a logo or an icon to use it in an app&apos;s chat design.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {library.assets.map((a) => (
                  <li key={a.id} className="rounded-[20px] bg-panel p-3 text-[13px]">
                    <div className="flex aspect-square items-center justify-center rounded-xl bg-[repeating-conic-gradient(#eee_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed bucket URL */}
                      <img src={a.url} alt={a.name} className="max-h-[80%] max-w-[80%] object-contain" />
                    </div>
                    <p className="mt-2 truncate text-fg" title={a.name}>
                      {a.name}
                    </p>
                    <p className="text-secondary">
                      {a.width}×{a.height} · {Math.ceil(a.bytes / 1024)} KB
                    </p>
                    <p className="truncate text-secondary" title={a.usedBy.map((u) => u.appName).join(", ")}>
                      {a.usedBy.length ? `Used by ${a.usedBy.map((u) => u.appName).join(", ")}` : "Not used"}
                    </p>
                    {admin && (
                      <button
                        type="button"
                        onClick={() => void remove(a.id)}
                        disabled={a.usedBy.length > 0}
                        title={a.usedBy.length ? "Remove it from every design (and publish) first" : undefined}
                        className="mt-1 text-[#b42318] disabled:text-muted"
                      >
                        Delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
