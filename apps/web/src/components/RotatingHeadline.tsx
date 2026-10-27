"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "@/lib/hooks";

const words = [
  { text: "Increase conversion", emoji: "💸" },
  { text: "Lower churn", emoji: "😍" },
  { text: "Get more reviews", emoji: "⭐️" },
];

/** Hero line 2: rotates every 2.4s while at least half visible. */
export function RotatingHeadline() {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);

  useEffect(() => {
    if (!inView || reduced) return;
    const id = setInterval(() => {
      setIndex((current) => {
        setPrevious(current);
        return (current + 1) % words.length;
      });
    }, 2400);
    return () => clearInterval(id);
  }, [inView, reduced]);

  const render = (i: number) => (
    <>
      {words[i].text}{" "}
      <span className="inline-block not-italic tracking-normal [font-family:'Apple_Color_Emoji','Segoe_UI_Emoji',sans-serif] text-[length:.7em] [vertical-align:.04em]">
        {words[i].emoji}
      </span>
    </>
  );

  return (
    <span ref={ref} className="block min-h-[1.2em]" aria-hidden="true">
      <span className="relative inline-block overflow-y-clip whitespace-nowrap font-serif text-[length:1em] font-normal italic tracking-[-.02em] text-[var(--landing-muted)] [perspective:600px]">
        {previous !== null && (
          <span key={`out-${previous}-${index}`} className="absolute inset-x-0 top-0 inline-block animate-[headline-out_.45s_cubic-bezier(.22,1,.36,1)_both]">
            {render(previous)}
          </span>
        )}
        <span key={`in-${index}`} className={`inline-block ${previous !== null ? "animate-[headline-in_.55s_cubic-bezier(.22,1,.36,1)_both]" : ""}`}>
          {render(index)}
        </span>
      </span>
    </span>
  );
}
