"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export const useLandingTheme = () => useContext(ThemeContext);

const STORAGE_KEY = "landing-theme";
const CHANGE_EVENT = "landing-theme-change";

// The theme lives in localStorage; useSyncExternalStore keeps the server render light
// and picks up a stored preference on the client without a setState-in-effect.
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // storage unavailable (private mode)
  }
}

export function LandingShell({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);

  const toggle = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, readTheme() === "dark" ? "light" : "dark");
    } catch {
      // ignore; nothing to persist to
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <div
        data-landing-theme="true"
        data-theme={theme}
        className="group/landing min-h-screen overflow-x-clip antialiased bg-[var(--landing-background)] text-[var(--landing-foreground)]"
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
