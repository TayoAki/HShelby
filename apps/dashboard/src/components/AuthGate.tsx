"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { Spinner } from "./ui";

/** Client-side gate for the signed-in area; the API enforces auth on every call regardless. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isPending, isRefetching } = authClient.useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isPending && !isRefetching && !data) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [isPending, isRefetching, data, router, pathname]);

  if (isPending || !data) return <Spinner />;
  return <>{children}</>;
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        // Full page load drops every bit of the previous user's client state.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/sign-in");
      }}
      className="text-[14px] text-secondary hover:text-fg"
    >
      Sign out
    </button>
  );
}
