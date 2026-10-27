"use client";

import { useEffect, useState, type RefObject } from "react";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function useInView(
  ref: RefObject<Element | null>,
  { amount = 0, once = false }: { amount?: number; once?: boolean } = {},
) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) observer.disconnect();
      },
      { threshold: amount },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, amount, once]);
  return inView;
}

/**
 * Steps through a list of timestamps (ms) and loops after `loop` ms,
 * mirroring the `useStepTimeline` hook in reception's bundle.
 * Returns how many steps have been reached so far.
 */
export function useTimeline(steps: number[], loop: number, playing: boolean, reduced = false) {
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!playing || reduced) return;
    const timers = steps.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    timers.push(
      setTimeout(() => {
        setStep(0);
        setCycle((c) => c + 1);
      }, loop),
    );
    return () => timers.forEach(clearTimeout);
  }, [steps, loop, playing, reduced, cycle]);
  return reduced ? steps.length : step;
}
