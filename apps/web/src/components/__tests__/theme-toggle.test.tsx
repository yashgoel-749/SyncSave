import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server.node";
import ThemeToggle, { ThemeSync } from "../ThemeToggle";
import {
  getThemeSnapshot,
  setTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

beforeEach(() => {
  setTheme("dark");
  localStorage.clear();
});

afterEach(() => jest.restoreAllMocks());

function storageChange(key: string | null, newValue: string | null, storageArea: Storage | null = localStorage) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea }));
  });
}

describe("theme control", () => {
  it("starts dark, toggles with a native button, persists, and updates every control", () => {
    render(<><ThemeToggle /><ThemeToggle /></>);
    const [first, second] = screen.getAllByRole("button", { name: "Switch to light mode" });
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(first.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(first);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.getAllByRole("button", { name: "Switch to dark mode" })).toHaveLength(2);
    expect(second).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(second);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("retains live DOM identity and input state when the theme changes", () => {
    render(<><ThemeSync /><ThemeToggle /><textarea aria-label="Draft" defaultValue="unsynced writing" /></>);
    const draft = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.change(draft, { target: { value: "still here" } });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
    expect(draft).toHaveValue("still here");
  });

  it("stays usable when preference writes fail, including after remount", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage full", "QuotaExceededError"); });
    const view = render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(getThemeSnapshot()).toBe("light");
    view.unmount();
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("updates from other tabs without writing the preference back", () => {
    render(<ThemeToggle />);
    const write = jest.spyOn(Storage.prototype, "setItem");
    storageChange(THEME_STORAGE_KEY, "light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    storageChange("unrelated", "dark");
    storageChange(THEME_STORAGE_KEY, "dark", sessionStorage);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    storageChange(THEME_STORAGE_KEY, "invalid");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    storageChange(THEME_STORAGE_KEY, "light");
    storageChange(THEME_STORAGE_KEY, null);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    storageChange(THEME_STORAGE_KEY, "light");
    storageChange(null, null);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps cross-tab synchronization running without a visible toggle", () => {
    render(<ThemeSync />);
    storageChange(THEME_STORAGE_KEY, "light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("cleans up the shared listener and restores the attribute on remount", () => {
    const view = render(<><ThemeToggle /><ThemeToggle /></>);
    fireEvent.click(screen.getAllByRole("button")[0]);
    view.unmount();
    storageChange(THEME_STORAGE_KEY, "dark");
    expect(getThemeSnapshot()).toBe("light");
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeSync />);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("hydrates the server snapshot without replacing an existing input", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    setTheme("light");
    const app = <><ThemeToggle /><input aria-label="Draft" defaultValue="saved" /></>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(app);
    document.body.append(container);
    const input = container.querySelector("input");
    const onRecoverableError = jest.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => { root = hydrateRoot(container, app, { onRecoverableError }); });
    expect(container.querySelector("input")).toBe(input);
    expect(container.querySelector("button")).toHaveAttribute("aria-label", "Switch to dark mode");
    expect(onRecoverableError).not.toHaveBeenCalled();
    act(() => root?.unmount());
    container.remove();
  });
});

describe("prepaint and reload", () => {
  it.each(["light", "dark", "invalid", "</script><script>throw Error('injected')</script>"])("validates saved preference %s before paint and on a fresh module load", async (saved) => {
    localStorage.setItem(THEME_STORAGE_KEY, saved);
    window.eval(THEME_INIT_SCRIPT);
    const expected = saved === "light" ? "light" : "dark";
    expect(document.documentElement).toHaveAttribute("data-theme", expected);
    await jest.isolateModulesAsync(async () => {
      const reloaded = await import("@/lib/theme");
      expect(reloaded.getThemeSnapshot()).toBe(expected);
      expect(reloaded.getThemeSnapshot()).toBe(expected);
    });
  });

  it("defaults to dark when storage reads fail without breaking bootstrap or snapshots", async () => {
    document.documentElement.removeAttribute("data-theme");
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(() => window.eval(THEME_INIT_SCRIPT)).not.toThrow();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await jest.isolateModulesAsync(async () => {
      const reloaded = await import("@/lib/theme");
      expect(reloaded.getThemeSnapshot()).toBe("dark");
      reloaded.setTheme("light");
      expect(reloaded.getThemeSnapshot()).toBe("light");
    });
  });
});
