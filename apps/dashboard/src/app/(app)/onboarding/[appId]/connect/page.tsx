"use client";

import type { App, AppStatus, SetupPrompt } from "@hshelby/contracts";
import { CheckIcon, CopyIcon, Cross2Icon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OnboardingShell, StepTitle } from "@/components/Onboarding";
import { ChatWaitingPreview } from "@/components/Previews";
import { ErrorNote, PrimaryButton, Spinner, TextButton } from "@/components/ui";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/use-copy";

export default function ConnectPage() {
  const { appId } = useParams<{ appId: string }>();
  const [app, setApp] = useState<App | null>(null);
  const [setup, setSetup] = useState<SetupPrompt | null>(null);
  const [firstMessageAt, setFirstMessageAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "preview" | "manual">("none");
  const prompt = useCopy();
  const appIdCopy = useCopy();

  useEffect(() => {
    Promise.all([api<{ app: App }>(`/apps/${appId}`), api<SetupPrompt>(`/apps/${appId}/setup-prompt`)])
      .then(([a, s]) => {
        setApp(a.app);
        setSetup(s);
        setFirstMessageAt(a.app.firstMessageAt);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load this app"));
  }, [appId]);

  // Poll until the SDK reports the app's first message (wired up in phase B1).
  useEffect(() => {
    if (!app || firstMessageAt) return;
    const id = setInterval(() => {
      api<AppStatus>(`/apps/${appId}/status`)
        .then((s) => s.firstMessageAt && setFirstMessageAt(s.firstMessageAt))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [app, appId, firstMessageAt]);

  useEffect(() => {
    if (panel !== "preview") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel("none");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  if (error) {
    return (
      <main className="mx-auto max-w-md px-5 py-24">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/apps" className="mt-4 inline-block text-[15px] underline underline-offset-4">
          Back to your apps
        </Link>
      </main>
    );
  }
  if (!app || !setup) return <Spinner />;

  return (
    <OnboardingShell current={1} appId={appId} previewLabel="In-app view · what your users see" preview={<ChatWaitingPreview received={Boolean(firstMessageAt)} />}>
      <StepTitle title={`Connect ${app.name}`} subtitle="Copy the prompt into your coding agent to add native support to your app." />

      <div className="mt-10">
        <PrimaryButton glow onClick={() => prompt.copy(setup.prompt)}>
          {prompt.copied ? <CheckIcon className="size-5" /> : <CopyIcon className="size-5" />}
          {prompt.copied ? "Copied, paste it into your agent" : "Copy setup prompt"}
        </PrimaryButton>
      </div>
      <div className="mt-6 flex justify-center gap-10">
        <TextButton onClick={() => setPanel(panel === "preview" ? "none" : "preview")}>Preview prompt</TextButton>
        <TextButton onClick={() => setPanel(panel === "manual" ? "none" : "manual")}>Set up manually</TextButton>
      </div>

      {panel === "manual" && (
        <div className="mt-6 rounded-3xl bg-white p-5 text-left text-[14px] shadow-[0_0_0_1px_var(--line)]">
          <p className="text-secondary">Configure the SDK at launch with this App ID:</p>
          <button
            type="button"
            onClick={() => appIdCopy.copy(app.publicId)}
            className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl bg-panel px-4 py-3 font-mono text-[14px]"
          >
            <span className="truncate">{app.publicId}</span>
            {appIdCopy.copied ? <CheckIcon className="shrink-0" /> : <CopyIcon className="shrink-0 text-secondary" />}
          </button>
          <p className="mt-3 text-secondary">The SDK packages aren&apos;t published yet; the setup prompt lists what&apos;s still missing.</p>
        </div>
      )}

      <div className="mt-12 space-y-2" aria-live="polite">
        <p className="flex items-center justify-center gap-3 text-[17px]">
          <span
            className={`size-2 rounded-full ${firstMessageAt ? "bg-[#34c759]" : "animate-[pulse-dot_1.4s_ease-in-out_infinite] bg-secondary"}`}
          />
          {firstMessageAt ? "Your first message arrived" : "Waiting for your first message"}
        </p>
        <p className="text-[15px] text-secondary">
          {firstMessageAt ? "Your app is connected." : "Run your app, open support, and send a message to continue."}
        </p>
      </div>

      <Link
        href={`/onboarding/${appId}/integrations`}
        className="mt-8 inline-block text-[14px] text-secondary underline-offset-4 hover:text-fg hover:underline"
      >
        {firstMessageAt ? "Continue" : "Skip for now"} →
      </Link>

      {panel === "preview" && (
        <div role="dialog" aria-modal="true" aria-label="Setup prompt" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPanel("none")}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-[28px] bg-white text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
              <p className="text-[15px]">
                Setup prompt <span className="text-secondary">· {setup.lines} lines</span>
              </p>
              <div className="flex items-center gap-4">
                <TextButton onClick={() => prompt.copy(setup.prompt)}>{prompt.copied ? "Copied" : "Copy"}</TextButton>
                <button type="button" aria-label="Close" onClick={() => setPanel("none")} className="text-secondary hover:text-fg">
                  <Cross2Icon className="size-5" />
                </button>
              </div>
            </div>
            <pre className="overflow-auto whitespace-pre-wrap px-6 py-5 font-mono text-[13px] leading-relaxed">{setup.prompt}</pre>
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}
