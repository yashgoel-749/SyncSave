import { extractPlainText, countWords } from "../editor-utils";

describe("extractPlainText", () => {
  const doc = {
    type: "doc" as const,
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Q3 Roadmap" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ship the " },
          { type: "text", marks: [{ type: "bold" }], text: "whiteboard" },
          { type: "text", text: " feature." },
        ],
      },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }] },
        ],
      },
    ],
  };

  it("flattens a TipTap document to readable text", () => {
    expect(extractPlainText(doc)).toBe("Q3 Roadmap Ship the whiteboard feature. Alpha Beta");
  });

  it("accepts the raw JSON string stored in the database", () => {
    expect(extractPlainText(JSON.stringify(doc))).toContain("Q3 Roadmap");
  });

  it("returns an empty string for empty or invalid input", () => {
    expect(extractPlainText(null)).toBe("");
    expect(extractPlainText("")).toBe("");
    expect(extractPlainText('{"type":"doc","content":[{"type":"paragraph"}]}')).toBe("");
  });

  it("never leaks raw JSON syntax into the preview", () => {
    const text = extractPlainText(JSON.stringify(doc));
    expect(text).not.toContain("{");
    expect(text).not.toContain("\"type\"");
  });

  it("truncates with an ellipsis at maxLength", () => {
    const text = extractPlainText(doc, { maxLength: 12 });
    expect(text.length).toBeLessThanOrEqual(12);
    expect(text.endsWith("…")).toBe(true);
  });

  it("preserves line breaks when requested", () => {
    const text = extractPlainText(doc, { preserveLineBreaks: true });
    expect(text.split("\n")[0]).toBe("Q3 Roadmap");
  });

  it("treats legacy plain text as paragraphs", () => {
    expect(extractPlainText("hello\nworld")).toBe("hello world");
  });
});

describe("countWords", () => {
  it("counts words ignoring punctuation-only tokens", () => {
    expect(countWords("Hello, world — it's 2026!")).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("well-known term")).toBe(2);
  });
});
