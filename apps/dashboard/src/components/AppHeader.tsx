"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { SignOutButton } from "./AuthGate";
import { BrandMark } from "./ui";

const links = [
  { href: "/inbox", label: "Inbox" },
  { href: "/apps", label: "Apps" },
  { href: "/billing", label: "Billing" },
] as const;

export function AppHeader({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const { data } = authClient.useSession();
  return (
    <header className={`flex h-16 shrink-0 items-center justify-between gap-6 ${className}`}>
      <div className="flex items-center gap-6">
        <Link href="/inbox" className="text-[22px]">
          <BrandMark />
        </Link>
        <nav className="flex gap-1 text-[14px]">
          {links.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 transition-colors ${active ? "bg-panel text-fg" : "text-secondary hover:text-fg"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-6">
        {data && <span className="hidden text-[14px] text-secondary sm:inline">{data.user.email}</span>}
        <SignOutButton />
      </div>
    </header>
  );
}
