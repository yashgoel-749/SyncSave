/** @jest-environment node */

import { renderToString } from "react-dom/server";
import ThemeToggle, { ThemeSync } from "@/components/ThemeToggle";
import { getServerThemeSnapshot, getThemeSnapshot, setTheme, subscribeTheme } from "../theme";

it("imports and server-renders a deterministic dark snapshot without browser globals", () => {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
  expect(getThemeSnapshot()).toBe("dark");
  expect(getServerThemeSnapshot()).toBe("dark");
  expect(() => setTheme("light")).not.toThrow();
  const listener = jest.fn();
  const unsubscribe = subscribeTheme(listener);
  unsubscribe();
  expect(listener).not.toHaveBeenCalled();
  const html = renderToString(<><ThemeSync /><ThemeToggle /></>);
  expect(html).toContain('aria-label="Switch to light mode"');
  expect(html).toContain('aria-pressed="false"');
  expect(getServerThemeSnapshot()).toBe("dark");
});
