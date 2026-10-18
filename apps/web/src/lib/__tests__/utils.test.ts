import { resolveDocumentTitle, truncate, relativeTime } from "@/lib/utils";

describe("resolveDocumentTitle", () => {
  it("returns the title when non-empty", () => {
    expect(resolveDocumentTitle("My Doc")).toBe("My Doc");
  });

  it("trims whitespace", () => {
    expect(resolveDocumentTitle("  Hello  ")).toBe("Hello");
  });

  it("returns 'Untitled' for empty string", () => {
    expect(resolveDocumentTitle("")).toBe("Untitled");
  });

  it("returns 'Untitled' for null", () => {
    expect(resolveDocumentTitle(null)).toBe("Untitled");
  });

  it("returns 'Untitled' for undefined", () => {
    expect(resolveDocumentTitle(undefined)).toBe("Untitled");
  });

  it("returns 'Untitled' for whitespace-only string", () => {
    expect(resolveDocumentTitle("   ")).toBe("Untitled");
  });
});

describe("truncate", () => {
  it("returns full string when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and adds ellipsis", () => {
    const result = truncate("hello world", 6);
    expect(result).toHaveLength(6);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles maxLength of 1", () => {
    expect(truncate("abc", 1)).toBe("…");
  });

  it("returns empty string for maxLength < 1", () => {
    expect(truncate("abc", 0)).toBe("");
  });

  it("returns string unchanged if exactly at limit", () => {
    expect(truncate("abcde", 5)).toBe("abcde");
  });
});

describe("relativeTime", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2025-01-01T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "just now" for < 60s', () => {
    const d = new Date("2025-01-01T11:59:30Z");
    expect(relativeTime(d)).toBe("just now");
  });

  it('returns "X min ago" for < 1 hour', () => {
    const d = new Date("2025-01-01T11:45:00Z");
    expect(relativeTime(d)).toBe("15 min ago");
  });

  it('returns "X hr ago" for < 24 hours', () => {
    const d = new Date("2025-01-01T09:00:00Z");
    expect(relativeTime(d)).toBe("3 hr ago");
  });

  it('returns "1 day ago" for singular', () => {
    const d = new Date("2024-12-31T12:00:00Z");
    expect(relativeTime(d)).toBe("1 day ago");
  });

  it('returns "X days ago" for plural', () => {
    const d = new Date("2024-12-28T12:00:00Z");
    expect(relativeTime(d)).toBe("4 days ago");
  });

  it("accepts ISO string input", () => {
    expect(relativeTime("2025-01-01T11:59:30Z")).toBe("just now");
  });
});
