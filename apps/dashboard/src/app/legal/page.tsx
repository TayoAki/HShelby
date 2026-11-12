import { brand } from "@hshelby/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_DOCS } from "./docs";

export const metadata: Metadata = { title: `Legal · ${brand.name}` };

export default function LegalIndexPage() {
  return (
    <main>
      <h1 className="text-[40px] leading-[1.1] tracking-[-.045em]">Legal</h1>
      <p className="mt-2 text-[15px] text-secondary">
        How {brand.name} works with you and handles your app users&apos; data. Questions: legal@{brand.domain}.
      </p>
      <ul className="mt-8 divide-y divide-line">
        {Object.entries(LEGAL_DOCS).map(([slug, d]) => (
          <li key={slug} className="py-3">
            <Link href={`/legal/${slug}`} className="text-[16px] text-fg hover:underline">
              {d.title}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
