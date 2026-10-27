import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";
import { AccentLink } from "@/components/ui/Buttons";

const links = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "Setup" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-[var(--landing-background)]/70 text-[var(--landing-foreground)] backdrop-blur-xl backdrop-saturate-150">
      <nav
        aria-label="Main navigation"
        className="relative mx-auto flex h-[var(--landing-header-height)] max-w-[var(--landing-content-width)] items-center justify-between gap-3 px-[var(--landing-gutter)]"
      >
        <Link prefetch={false} aria-label="reception home" href="/" className="flex min-h-11 items-center text-[20px] leading-none tracking-[-.05em] sm:text-[23px]">
          <BrandMark />
        </Link>
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-6 text-sm lg:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="inline-flex min-h-11 items-center hover:text-[var(--landing-secondary)]">
              {link.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          <Link prefetch={false} href="/docs" className="inline-flex min-h-11 items-center text-sm hover:text-[var(--landing-secondary)]">
            Docs
          </Link>
          <AccentLink arrow={false}>Log in</AccentLink>
        </div>
      </nav>
    </header>
  );
}
