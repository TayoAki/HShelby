"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useInView, useReducedMotion } from "@/lib/hooks";
import { topics, type TopicKind } from "@/components/spotlight/topics";
import { ConversionScene, IntegrationsScene, RetentionScene, ReviewsScene } from "@/components/spotlight/Scenes";

const scenes: Record<TopicKind, typeof ConversionScene> = {
  conversion: ConversionScene,
  retention: RetentionScene,
  integrations: IntegrationsScene,
  reviews: ReviewsScene,
};

/** Hero "spotlight": four auto-advancing product scenes (11s each) with a tab bar. */
export function SpotlightGallery() {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const visible = useInView(container, { amount: 0.35 });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState(false);
  const playing = visible && !reduced;
  const topic = topics[active];

  useEffect(() => {
    if (!playing || manual) return;
    const timer = setTimeout(() => setActive((i) => (i + 1) % topics.length), topic.duration);
    return () => clearTimeout(timer);
  }, [playing, manual, topic]);

  const select = (index: number) => {
    setManual(true);
    setActive((index + topics.length) % topics.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") select(active + 1);
    if (event.key === "ArrowLeft") select(active - 1);
  };

  const Scene = scenes[topic.kind];

  return (
    <div ref={container}>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${active}`}
        className="relative isolate h-[480px] overflow-x-visible overflow-y-clip rounded-[var(--landing-radius)] sm:h-[600px] lg:h-[680px]"
      >
        <div
          key={topic.kind}
          className="absolute inset-0 animate-[bubble-in_.6s_cubic-bezier(.32,.72,0,1)_both] [mask-image:linear-gradient(to_bottom,black_calc(100%-56px),transparent)]"
        >
          <Scene playing={playing} reduced={reduced} />
        </div>
      </div>

      <div className="mt-6">
        <div className="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:justify-center sm:px-0">
          <div
            role="tablist"
            aria-label="Ways to support your users"
            onKeyDown={onKeyDown}
            className="inline-flex shrink-0 gap-1 rounded-full bg-[var(--landing-panel)] p-1"
          >
            {topics.map((t, i) => {
              const selected = i === active;
              return (
                <button
                  key={t.kind}
                  id={`${id}-tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${id}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(i)}
                  className={`relative cursor-pointer whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-foreground)] sm:px-5 sm:text-sm ${
                    selected
                      ? "text-[var(--landing-foreground)]"
                      : "text-[var(--landing-secondary)] hover:text-[var(--landing-foreground)]"
                  }`}
                >
                  {selected && (
                    <span className="absolute inset-0 animate-[bubble-in_.3s_ease-out_both] rounded-full bg-[var(--landing-background)] shadow-[var(--hero-shadow)]" />
                  )}
                  <span className="relative">{t.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-5 grid max-w-[640px] text-center">
        {topics.map((t, i) => {
          const selected = i === active;
          return (
            <p
              key={t.kind}
              aria-hidden={!selected}
              className={`text-balance text-[16px] leading-[1.5] tracking-[-.015em] text-[var(--landing-secondary)] transition-[opacity,translate] ease-[cubic-bezier(.32,.72,0,1)] [grid-area:1/1] motion-reduce:transition-none sm:text-[18px] ${
                selected
                  ? "translate-y-0 opacity-100 delay-150 duration-700"
                  : "pointer-events-none translate-y-2 select-none opacity-0 duration-200"
              }`}
            >
              <span className="text-[var(--landing-foreground)]">{t.secondaryTitle}.</span> {t.benefits.join(", ")}.{" "}
              <a
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={selected ? 0 : -1}
                className="whitespace-nowrap text-[var(--landing-foreground)] underline-offset-4 hover:underline"
              >
                docs <span aria-hidden="true">↗</span>
              </a>
            </p>
          );
        })}
      </div>
    </div>
  );
}
