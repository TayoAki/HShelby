import { brand } from "@hshelby/contracts";
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[.16em] leading-none tracking-[-.05em] ${className}`}>
      <span aria-hidden="true" className="inline-block size-[1ex] shrink-0 rounded-full bg-[var(--brand-mark)]" />
      {brand.name}
    </span>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full transition-[background-color,transform,box-shadow,opacity] active:scale-[.98] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2";

export function PrimaryButton({ className = "", glow = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { glow?: boolean }) {
  return (
    <button
      {...props}
      className={`${buttonBase} h-14 w-full bg-[var(--accent)] px-6 text-[17px] font-medium text-white hover:bg-[var(--accent-hover)] focus-visible:outline-[var(--accent)] disabled:bg-[var(--accent-disabled)] ${
        glow ? "shadow-[0_8px_28px_-6px_rgb(255_75_43_/_55%)]" : ""
      } ${className}`}
    />
  );
}

export function TextButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`text-[15px] text-fg/80 underline-offset-4 hover:text-fg hover:underline ${className}`} />;
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block text-[13px] text-secondary">{label}</span>
      <input
        {...props}
        className="h-12 w-full rounded-2xl border border-[var(--field)] bg-white px-4 text-[15px] outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-fg/60 focus:shadow-[inset_0_0_0_1px_var(--fg)]"
      />
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl bg-[#fff1ee] px-4 py-3 text-left text-[14px] text-[#b42318]">
      {children}
    </p>
  );
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-[40px] bg-panel ${className}`}>{children}</section>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[50vh] items-center justify-center gap-2 text-[14px] text-secondary">
      <span className="size-2 animate-[pulse-dot_1s_ease-in-out_infinite] rounded-full bg-[var(--accent)]" />
      {label}…
    </div>
  );
}

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-5 py-16">
      <Link href="/" className="mb-10 text-[26px]">
        <BrandMark />
      </Link>
      <div className="w-full max-w-[420px] rounded-[32px] bg-panel px-7 py-9 text-center sm:px-10">
        <h1 className="text-[32px] leading-[1.1] tracking-[-.04em]">{title}</h1>
        <p className="mt-2 text-[15px] text-secondary">{subtitle}</p>
        <div className="mt-8 space-y-4">{children}</div>
      </div>
      <p className="mt-6 text-[14px] text-secondary">{footer}</p>
    </main>
  );
}
