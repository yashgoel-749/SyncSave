/** @jest-environment node */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import postcss from "postcss";

const cssPath = resolve(__dirname, "../../app/globals.css");
const css = readFileSync(cssPath, "utf8");
const parsed = postcss.parse(css);

function themeTokens(theme: "light" | "dark") {
  const tokens = new Map<string, string>();
  parsed.walkRules((rule) => {
    if (rule.selector === ":root" || (theme === "light" && rule.selector === ':root[data-theme="light"]')) {
      rule.walkDecls((decl) => { tokens.set(decl.prop, decl.value); });
    }
  });
  return tokens;
}

function luminance(color: string, tokens: Map<string, string>): number {
  const variable = /^var\((--[\w-]+)\)$/.exec(color);
  if (variable) {
    const resolved = tokens.get(variable[1]);
    if (!resolved) throw new Error(`Missing theme token ${variable[1]}`);
    return luminance(resolved, tokens);
  }
  if (color === "white") return 1;
  const hsl = /^hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)$/.exec(color);
  if (!hsl) throw new Error(`Expected opaque HSL color, got ${color}`);
  const h = Number(hsl[1]) / 30;
  const s = Number(hsl[2]) / 100;
  const l = Number(hsl[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  function channel(n: number) {
    const k = (n + h) % 12;
    const rgb = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return rgb <= 0.04045 ? rgb / 12.92 : ((rgb + 0.055) / 1.055) ** 2.4;
  }
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(foreground: string, background: string, tokens: Map<string, string>) {
  const first = luminance(`var(${foreground})`, tokens);
  const second = luminance(`var(${background})`, tokens);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

it.each(["dark", "light"] satisfies Array<"dark" | "light">)("keeps %s text and primary actions readable without recoloring the palette", (theme) => {
  const tokens = themeTokens(theme);
  for (const text of ["--text-primary", "--text-secondary", "--text-muted"]) {
    for (const surface of ["--surface-0", "--surface-1", "--surface-2", "--surface-3", "--surface-4"]) {
      expect(contrast(text, surface, tokens)).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(contrast("--action-foreground", "--brand-500", tokens)).toBeGreaterThanOrEqual(4.5);
  expect(tokens.get("--brand-500")).toBe("hsl(246 68% 56%)");
  if (theme === "light") {
    for (const status of ["success", "warning", "danger", "info"]) {
      expect(contrast(`--status-${status}`, `--status-${status}-bg`, tokens)).toBeGreaterThanOrEqual(4.5);
    }
    for (const text of ["--brand-foreground", "--brand-foreground-soft", "--accent-foreground", "--violet-foreground"]) {
      expect(contrast(text, "--surface-4", tokens)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("compiles real Tailwind semantic foreground, status, and surface utilities", async () => {
  const compiler = await compile(css, { base: dirname(cssPath), onDependency: () => {} });
  const output = compiler.build([
    "text-action", "text-warning", "text-success", "text-danger", "text-action-foreground",
    "bg-status-warning-bg", "border-status-danger-border", "bg-surface-1", "bg-brand-500", "text-white",
  ]);
  for (const name of ["text-action", "text-warning", "text-success", "text-danger", "bg-status-warning-bg", "border-status-danger-border"]) {
    expect(output).toContain(`.${name}`);
  }
  expect(output).toContain("color: var(--brand-foreground)");
  expect(output).toContain("background-color: var(--brand-500)");
  expect(output).toContain(".text-white");
  expect(output).toContain(".status-warning");
  expect(output).toContain(".status-danger");
  expect(output).not.toContain("filter: invert");
});
