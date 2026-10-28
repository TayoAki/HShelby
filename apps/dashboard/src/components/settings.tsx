"use client";

import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { useCopy } from "@/lib/use-copy";

export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] bg-panel p-6">
      <h2 className="text-[19px] tracking-[-.02em]">{title}</h2>
      <div className="mt-3 space-y-4 text-[14px] leading-[1.55] text-fg/80">{children}</div>
    </section>
  );
}

export function CopyBlock({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="relative rounded-2xl bg-white p-4 pr-12 outline outline-1 -outline-offset-1 outline-black/5">
      <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.6] whitespace-pre">{value}</pre>
      <button
        type="button"
        onClick={() => copy(value)}
        aria-label="Copy"
        className="absolute top-3 right-3 rounded-full p-1.5 text-secondary hover:bg-panel hover:text-fg"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

/** A labelled on/off setting with its explanation. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  disabledReason,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-fg">{label}</p>
        <p className="mt-1">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-[var(--accent)]" : "bg-[var(--field)]"
        }`}
      >
        <span className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

export const secondaryButton =
  "h-10 rounded-full bg-white px-4 text-[14px] text-fg outline outline-1 -outline-offset-1 outline-black/10 transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50";
