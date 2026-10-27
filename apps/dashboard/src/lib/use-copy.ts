"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Copies text and reports `copied` for a moment afterwards. */
export function useCopy(resetMs = 2500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );
  return { copied, copy };
}
