import { readFile } from "node:fs/promises";
import path from "node:path";
import { Marked, type Tokens } from "marked";

/*
 * The public legal pages come from the Markdown in docs/legal (the source of truth, reviewed there). They're
 * read and rendered when the dashboard is built, so the pages are static; the dashboard's Railway watch
 * patterns include docs/legal so an edit redeploys them.
 */

export const LEGAL_DOCS = {
  terms: { file: "terms-of-service.md", title: "Terms of Service" },
  privacy: { file: "privacy-policy.md", title: "Privacy Policy" },
  dpa: { file: "dpa.md", title: "Data Processing Addendum" },
  "acceptable-use": { file: "acceptable-use-policy.md", title: "Acceptable Use Policy" },
  cookies: { file: "cookie-notice.md", title: "Cookie Notice" },
  security: { file: "security.md", title: "Security" },
  "app-store-privacy": { file: "app-store-privacy-guide.md", title: "App Store privacy guide" },
  "end-user-privacy": { file: "end-user-privacy-template.md", title: "End-user privacy template" },
} as const;

export type LegalSlug = keyof typeof LEGAL_DOCS;

export const isLegalSlug = (s: string): s is LegalSlug => Object.hasOwn(LEGAL_DOCS, s);

const SLUG_BY_FILE: Record<string, string> = Object.fromEntries(Object.entries(LEGAL_DOCS).map(([slug, d]) => [d.file, slug]));

/** docs/legal, from the dashboard's own directory (where `next build` and `next dev` run). */
const LEGAL_DIR = path.join(process.cwd(), "../../docs/legal");

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** GitHub's heading anchors, so the documents' own `#…` links keep working. */
const anchor = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }: Tokens.Heading) {
      const html = this.parser.parseInline(tokens);
      return `<h${depth} id="${anchor(html)}">${html}</h${depth}>\n`;
    },
    link({ href, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      // another legal document: its page here
      const sibling = href.match(/^\.\/([\w-]+\.md)(#.*)?$/);
      if (sibling && SLUG_BY_FILE[sibling[1]!]) return `<a href="/legal/${SLUG_BY_FILE[sibling[1]!]}${sibling[2] ?? ""}">${text}</a>`;
      // a file elsewhere in the repository isn't public: keep the words, drop the link
      if (href.startsWith("../") || href.startsWith("./") || /\.md(#.*)?$/.test(href)) return text;
      return `<a href="${href}" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export async function renderLegalDoc(slug: LegalSlug) {
  const markdown = await readFile(path.join(LEGAL_DIR, LEGAL_DOCS[slug].file), "utf8");
  return marked.parse(markdown);
}
