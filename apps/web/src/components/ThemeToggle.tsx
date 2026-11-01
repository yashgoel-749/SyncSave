"use client";

import { useSyncExternalStore } from "react";
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setTheme,
  subscribeTheme,
} from "@/lib/theme";

function useTheme() {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
}

export function ThemeSync() {
  useTheme();
  return null;
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${nextTheme} mode`;

  return (
    <button
      type="button"
      className={`btn btn-ghost theme-toggle ${className}`}
      aria-label={label}
      aria-pressed={theme === "light"}
      title={label}
      onClick={() => setTheme(nextTheme)}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
          </>
        ) : (
          <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
        )}
      </svg>
    </button>
  );
}

export { ThemeToggle };
