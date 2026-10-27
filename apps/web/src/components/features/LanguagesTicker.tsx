"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "@/lib/hooks";

const greetings = [
  { lang: "en", flag: "🇺🇸", text: "how can we help you?" },
  { lang: "es", flag: "🇪🇸", text: "¿cómo podemos ayudarte?" },
  { lang: "ja", flag: "🇯🇵", text: "どうされましたか？" },
  { lang: "de", flag: "🇩🇪", text: "wie können wir helfen?" },
  { lang: "fr", flag: "🇫🇷", text: "comment pouvons-nous aider ?" },
  { lang: "ko", flag: "🇰🇷", text: "무엇을 도와드릴까요?" },
  { lang: "pt", flag: "🇧🇷", text: "como podemos ajudar?" },
  { lang: "zh", flag: "🇨🇳", text: "有什么可以帮您？" },
  { lang: "it", flag: "🇮🇹", text: "come possiamo aiutarti?" },
  { lang: "tr", flag: "🇹🇷", text: "nasıl yardımcı olabiliriz?" },
];

const rows = [...greetings, ...greetings, ...greetings];
const ROW = 60;
const HEIGHT = 420;
const START = greetings.length; // start on the middle copy so there's room above and below

/** Vertical language ticker behind a glass lens; the centered row is "active". */
export function LanguagesTicker() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(START);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    if (!inView || reduced) return;
    const id = setInterval(() => {
      setAnimate(true);
      setActive((i) => i + 1);
    }, 2000);
    return () => clearInterval(id);
  }, [inView, reduced]);

  // after reaching the third copy, jump back to the same row in the middle copy without animating
  useEffect(() => {
    if (active < START + greetings.length) return;
    const t = setTimeout(() => {
      setAnimate(false);
      setActive(START);
    }, 800);
    return () => clearTimeout(t);
  }, [active]);

  const offset = HEIGHT / 2 - ROW / 2 - active * ROW;

  return (
    <div
      ref={ref}
      className="relative w-[133%] max-w-[524px] shrink-0 origin-center scale-[.75] overflow-hidden px-8 [mask-image:linear-gradient(to_bottom,transparent,black_30%,black_70%,transparent)] sm:w-full sm:scale-100"
      style={{ height: HEIGHT }}
    >
      <div className="absolute inset-x-8 top-1/2 h-[60px] -translate-y-1/2 rounded-full border border-white/70 bg-white/[.06] shadow-[inset_0_1px_1px_rgb(255_255_255_/_95%),inset_0_-1px_1px_rgb(255_255_255_/_40%),inset_0_0_14px_rgb(255_255_255_/_30%),0_10px_30px_rgb(0_0_0_/_10%)] backdrop-blur-[3px] backdrop-brightness-[1.06] backdrop-saturate-[1.8] group-data-[theme=dark]/landing:border-white/15 group-data-[theme=dark]/landing:bg-white/[.04]" />
      <div
        className={`relative ${animate ? "transition-transform duration-700 ease-[cubic-bezier(.32,.72,0,1)]" : ""}`}
        style={{ transform: `translateY(${offset}px)` }}
      >
        {rows.map((g, i) => {
          const on = i === active || (i === active - greetings.length && !animate);
          return (
            <p
              key={i}
              lang={g.lang}
              className={`flex h-[60px] items-center gap-3 whitespace-nowrap px-6 text-[22px] tracking-[-.02em] transition-colors duration-700 ${
                on ? "text-[var(--landing-foreground)]" : "text-[var(--landing-muted)]"
              }`}
            >
              <span className={`transition-[filter,opacity] duration-700 ${on ? "" : "opacity-40 grayscale"}`}>{g.flag}</span>
              {g.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}
