"use client";

import { useId, useState } from "react";
import { PlusIcon } from "@radix-ui/react-icons";

const faqs = [
  {
    q: "Do my users need an account?",
    a: "No. They can open the chat and send you a message without creating a separate support account.",
  },
  {
    q: "Can I use it in more than one app?",
    a: "Yes. Add each app to your organization and connect it with its own App ID. You can manage their conversations in one inbox.",
  },
  {
    q: "What happens when I’m offline?",
    a: "Users can still leave you a message. Reply when you’re back. If you’ve set up push notifications and the user has allowed them, they’ll be notified of your reply.",
  },
  {
    q: "Can I make the chat match my app?",
    a: "Yes. Change the accent color, chat title, and welcome message. You also choose where users open the chat.",
  },
  {
    q: "Which devices and languages are supported?",
    a: "The Reception SDK works on iOS 17 and later, in native iOS and React Native/Expo apps (development builds, not Expo Go). The chat interface supports 48 languages. Custom text is localized by your app; messages are not automatically translated.",
  },
  {
    q: "Does Telegram let me reply to users?",
    a: "Yes. Reply to a new support notification in your connected Telegram chat, and your text is sent to the user. You can also reply from the web inbox.",
  },
];

const ease = "duration-200 ease-[var(--landing-ease-out)] motion-reduce:transition-none";

function Item({ q, a }: { q: string; a: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--feature-border)] first:border-t">
      <h3>
        <button
          id={`${id}-question`}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-answer`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-18 w-full cursor-pointer items-center justify-between gap-6 rounded px-0.5 py-[22px] text-left text-[15px] font-normal normal-case leading-[1.5] hover:text-[var(--landing-secondary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-foreground)] max-[601px]:gap-4 max-[601px]:text-sm"
        >
          {q}
          <PlusIcon width={16} height={16} aria-hidden="true" className={`shrink-0 transition-transform ${ease} ${open ? "rotate-45" : ""}`} />
        </button>
      </h3>
      <div
        id={`${id}-answer`}
        role="region"
        aria-labelledby={`${id}-question`}
        aria-hidden={!open}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] ${ease} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <p className="max-w-160 pb-6 pr-8 text-sm leading-[1.8] text-[var(--landing-secondary)] max-[601px]:pr-2 max-[601px]:text-[13px]">{a}</p>
        </div>
      </div>
    </div>
  );
}

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-190 scroll-mt-28 pt-[calc(var(--landing-section-gap)/2)] max-[601px]:scroll-mt-35">
      <header className="mb-[var(--landing-heading-gap)]">
        <h2 id="faq-title" className="m-0 text-[clamp(32px,4vw,44px)] font-normal leading-[1.15] tracking-[-.035em]">
          Your questions, answered
        </h2>
      </header>
      <div>
        {faqs.map((f) => (
          <Item key={f.q} {...f} />
        ))}
      </div>
    </section>
  );
}
