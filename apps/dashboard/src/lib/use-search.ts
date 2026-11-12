"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * The page's query string: empty while rendering on the server and hydrating, the real one after, so
 * links and forms that depend on it don't make the server and client HTML disagree.
 */
export function useSearch() {
  return useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => "",
  );
}

/** False while rendering on the server and hydrating, true after. */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** A same-site path from `?next=`, or the fallback; never another site. */
export function safeNext(search: string, fallback: string) {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
