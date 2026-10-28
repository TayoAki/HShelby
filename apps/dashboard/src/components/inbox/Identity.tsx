import type { InboxDevice } from "@hshelby/contracts";
import { SealCheckIcon } from "@phosphor-icons/react";

/** Shown next to users whose identity came from a valid token signed by the developer's server. */
export function VerifiedSeal({ size = 15 }: { size?: number }) {
  return (
    <span title="Verified by your server" className="inline-flex shrink-0 text-[var(--accent)]">
      <SealCheckIcon weight="fill" size={size} aria-label="Verified" />
    </span>
  );
}

/** Verified seal, an "Unverified" tag for identify() labels, or nothing for anonymous users. */
export function IdentityBadge({ device }: { device: Pick<InboxDevice, "verified" | "userId" | "name" | "email"> }) {
  if (device.verified) return <VerifiedSeal />;
  if (!device.userId && !device.name && !device.email) return null;
  return <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] text-secondary">Unverified</span>;
}
