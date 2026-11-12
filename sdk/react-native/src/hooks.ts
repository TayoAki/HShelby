import { useEffect, useRef, useState } from "react";
import { HireShelby } from "./HireShelby";
import type { HireShelbyEvent } from "./types";

/** Unread team messages, kept up to date: show it as a badge on your Support entry, hidden at zero. */
export function useUnreadCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const subscription = HireShelby.addUnreadCountListener((next) => active && setCount(next));
    HireShelby.getUnreadCount().then(
      (next) => active && setCount(next),
      () => {},
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return count;
}

/** Whether the chat is on screen. */
export function useIsChatOpen(): boolean {
  const [open, setOpen] = useState(HireShelby.isChatOpen());
  useHireShelbyEvent((event) => {
    if (event.type === "chatOpened") setOpen(true);
    if (event.type === "chatClosed") setOpen(false);
  });
  return open;
}

/** Calls `listener` for each SDK event while the component is mounted. */
export function useHireShelbyEvent(listener: (event: HireShelbyEvent) => void): void {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    const subscription = HireShelby.addEventListener((event) => latest.current(event));
    return () => subscription.remove();
  }, []);
}
