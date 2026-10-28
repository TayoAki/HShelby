"use client";

import Link from "next/link";
import { useInbox } from "@/components/inbox/InboxContext";

export default function InboxIndexPage() {
  const { conversations } = useInbox();
  const empty = conversations?.length === 0;
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <p className="text-[20px] tracking-[-.02em]">{empty ? "No conversations yet" : "Pick a conversation"}</p>
        <p className="mt-2 text-[14px] text-secondary">
          {empty ? (
            <>
              Messages from your app&apos;s users land here. Still setting up?{" "}
              <Link href="/apps" className="text-fg underline underline-offset-4">
                Connect an app
              </Link>
              .
            </>
          ) : (
            "Replies reach the user's app on its next sync."
          )}
        </p>
      </div>
    </div>
  );
}
