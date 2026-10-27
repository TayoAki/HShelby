"use client";

import { useEffect, useState } from "react";
import { ChatBubbleIcon, Cross2Icon } from "@radix-ui/react-icons";
import { Bubble, ChatScreen, TeamBubble, Timestamp } from "@/components/chat/Chat";

/** Floating support button. On reception.sh it opens their own live widget;
    here it opens a static demo of the same chat UI. */
export function ChatLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Contact reception"
          className="fixed bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+4.25rem)] right-4 z-40 h-[min(640px,calc(100svh-8rem))] w-[min(380px,calc(100vw-2rem))] animate-[bubble-in_.3s_cubic-bezier(.22,1,.36,1)_both] overflow-hidden rounded-[28px] shadow-[0_24px_80px_#0000003d,0_0_0_.5px_#0000000a] sm:bottom-[9.5rem] sm:right-8 lg:right-[calc(max(0px,(100%-1600px)/2)+4rem)]"
        >
          <div className="relative size-full [container-type:inline-size]">
            <ChatScreen title="reception support">
              <div className="flex flex-col gap-[3cqw]">
                <Timestamp>Today</Timestamp>
                <TeamBubble name="Team">hey 👋 this is a demo of the chat your users would see. ask us anything.</TeamBubble>
                <Bubble outgoing>does it work with expo?</Bubble>
                <TeamBubble name="Team">yep, dev builds via react-native-reception (not Expo Go).</TeamBubble>
              </div>
            </ChatScreen>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label={open ? "Close chat" : "Contact reception"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 flex size-13 cursor-pointer items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--elevation)] transition-[filter] hover:brightness-[0.92] focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none sm:bottom-[5.5rem] sm:right-8 lg:right-[calc(max(0px,(100%-1600px)/2)+4rem)] group-data-[theme=dark]/landing:bg-[#f1f1f4] group-data-[theme=dark]/landing:text-[#111215]"
      >
        {open ? <Cross2Icon className="size-5" /> : <ChatBubbleIcon className="size-6" />}
      </button>
    </>
  );
}
