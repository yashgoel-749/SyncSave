export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "syncspace:theme";
export const DEFAULT_THEME: Theme = "dark";

// Static, validated code only: no preference or other user input enters script source.
export const THEME_INIT_SCRIPT = `(function(){var t="dark";try{var s=localStorage.getItem("syncspace:theme");if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.setAttribute("data-theme",t)})()`;

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

let currentTheme: Theme | undefined;
const listeners = new Set<() => void>();

function readPreference(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(saved) ? saved : DEFAULT_THEME;
  } catch {
    const painted = document.documentElement.getAttribute("data-theme");
    return isTheme(painted) ? painted : DEFAULT_THEME;
  }
}

export function getServerThemeSnapshot(): Theme {
  return DEFAULT_THEME;
}

export function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  currentTheme ??= readPreference();
  return currentTheme;
}

function applyTheme(theme: Theme) {
  currentTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  for (const listener of listeners) listener();
}

export function setTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A blocked or full storage area must not disable the local control.
  }
  applyTheme(theme);
}

function onStorage(event: StorageEvent) {
  if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
  if (event.storageArea !== null) {
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
  }
  applyTheme(isTheme(event.newValue) ? event.newValue : DEFAULT_THEME);
}

export function subscribeTheme(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  // Also restores the attribute if React's development remount clears it.
  applyTheme(getThemeSnapshot());
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}
