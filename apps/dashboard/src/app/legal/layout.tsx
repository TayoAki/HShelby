import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui";
import { LEGAL_DOCS } from "./docs";

/** Public: no sign-in needed to read the legal documents. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-20">
      <header className="flex h-20 items-center justify-between">
        <Link href="/legal" className="text-[22px]">
          <BrandMark />
        </Link>
        <Link href="/sign-in" className="text-[14px] text-secondary hover:text-fg">
          Sign in
        </Link>
      </header>
      <nav aria-label="Legal documents" className="mb-8 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-secondary">
        {Object.entries(LEGAL_DOCS).map(([slug, d]) => (
          <Link key={slug} href={`/legal/${slug}`} className="hover:text-fg">
            {d.title}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
