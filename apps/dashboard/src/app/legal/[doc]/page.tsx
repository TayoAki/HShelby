import { brand } from "@hshelby/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLegalSlug, LEGAL_DOCS, renderLegalDoc } from "../docs";

// only the documents listed; anything else is a 404
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(LEGAL_DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const { doc } = await params;
  return isLegalSlug(doc) ? { title: `${LEGAL_DOCS[doc].title} · ${brand.name}` } : {};
}

export default async function LegalDocPage({ params }: PageProps<"/legal/[doc]">) {
  const { doc } = await params;
  if (!isLegalSlug(doc)) notFound();
  const html = await renderLegalDoc(doc);
  // our own Markdown from the repository, rendered at build time
  return <article className="legal" dangerouslySetInnerHTML={{ __html: html }} />;
}
