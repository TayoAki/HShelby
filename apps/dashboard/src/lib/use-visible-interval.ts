import { useEffect, useEffectEvent } from "react";

/** Calls `callback` every `ms` while the tab is visible, and right away when it becomes visible again. */
export function useVisibleInterval(callback: () => void, ms: number) {
  const onTick = useEffectEvent(callback);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") onTick();
    };
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
}
