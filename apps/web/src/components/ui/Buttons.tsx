import Link from "next/link";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";

const accent =
  "inline-flex min-h-10 sm:min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--landing-accent)] px-4 py-2 text-xs sm:px-6 sm:py-3 sm:text-sm font-normal text-[var(--landing-on-accent)] transition-[background-color,transform,translate,scale,rotate] hover:bg-[var(--landing-accent-hover)] active:scale-96 focus-visible:outline-[var(--landing-accent)]";

const panel =
  "inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--landing-panel)] px-4 py-2 text-xs text-[var(--landing-foreground)] transition-[background-color,transform,translate,scale,rotate] hover:bg-[var(--landing-panel-hover)] active:scale-96 sm:min-h-11 sm:px-6 sm:py-3 sm:text-sm";

export function AccentLink({
  href = "/login",
  children = "Connect my app",
  arrow = true,
  className = "",
}: {
  href?: string;
  children?: ReactNode;
  arrow?: boolean;
  className?: string;
}) {
  return (
    <Link prefetch={false} href={href} className={`${accent} ${className}`}>
      {children}
      {arrow && <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0" />}
    </Link>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link prefetch={false} href={href} target="_blank" className={panel}>
      {children}
    </Link>
  );
}
