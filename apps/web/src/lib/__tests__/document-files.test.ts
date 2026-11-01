/** @jest-environment node */
import { File } from "node:buffer";
import { MAX_DOCUMENT_FILE_BYTES, parseImportedDocument, plainTextDocument, readDocumentFile } from "../document-files";
import { createDocumentSchema } from "../document-schemas";

const doc = (content: unknown[]) => JSON.stringify({ type: "doc", content });
const paragraph = { type: "paragraph", content: [{ type: "text", text: "Hello" }] };

describe("document imports", () => {
  it("validates content at the creation API boundary, not only in the file picker", () => {
    expect(createDocumentSchema.safeParse({ title: "Blank" }).success).toBe(true);
    expect(createDocumentSchema.safeParse({ content: "Legacy plain text" }).success).toBe(true);
    expect(createDocumentSchema.safeParse({ content: doc([paragraph]) }).success).toBe(true);
    expect(createDocumentSchema.safeParse({ content: doc([{ type: "image", attrs: { src: "javascript:alert(1)" } }]) }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ content: "x".repeat(MAX_DOCUMENT_FILE_BYTES + 1) }).success).toBe(false);
    expect(() => plainTextDocument("x\n".repeat(4900))).toThrow(/256 KiB/);
  });
  it("preserves Unicode, literal markup, and blank lines in plain text", () => {
    expect(plainTextDocument("\uFEFF<h1>Hi 👋</h1>\r\n\r\nDone")).toEqual({
      type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "<h1>Hi 👋</h1>" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "Done" }] },
      ],
    });
    expect(plainTextDocument("").content).toEqual([{ type: "paragraph" }]);
  });

  it("accepts supported editor nodes, marks, and attributes", () => {
    const raw = doc([
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Title", marks: [{ type: "underline" }, { type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener noreferrer", class: null } }] }] },
      { type: "orderedList", attrs: { start: 2, type: null }, content: [{ type: "listItem", content: [paragraph] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph] }] },
      { type: "blockquote", content: [paragraph] },
      { type: "codeBlock", attrs: { language: "typescript" }, content: [{ type: "text", text: "const x = 1;" }] },
      { type: "paragraph", content: [{ type: "hardBreak", marks: [{ type: "bold" }] }] },
      { type: "horizontalRule" },
    ]);
    expect(parseImportedDocument(raw)).toEqual(JSON.parse(raw));
  });

  it.each(["http://example.com", "https://example.com", "mailto:hello@example.com", "/help"])("accepts safe link %s", (href) => {
    expect(() => parseImportedDocument(doc([{ type: "paragraph", content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: { href } }] }] }]))).not.toThrow();
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "//evil.example", "/\\evil.example", "https:\n//evil.example", "vbscript:bad", "https:missing-slashes"])("rejects unsafe link %s", (href) => {
    expect(() => parseImportedDocument(doc([{ type: "paragraph", content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: { href } }] }] }]))).toThrow(/Links must use/);
  });

  it.each([
    { type: "image", attrs: { src: "https://example.com" } },
    { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Bad" }] },
    { type: "paragraph", attrs: { onclick: "alert(1)" } },
    { type: "paragraph", text: "Wrong place" },
    { type: "text", text: "Outside paragraph" },
    { type: "bulletList", content: [paragraph] },
    { type: "paragraph", content: [paragraph] },
    { type: "paragraph", content: [{ type: "text", text: "Bad", marks: [{ type: "highlight" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "Bad", marks: [{ type: "link", attrs: { href: "/help", style: "color:red" } }] }] },
    { type: "text", text: "", content: [] },
  ])("rejects unsupported or malformed structure %#", (node) => {
    expect(() => parseImportedDocument(doc([node]))).toThrow();
  });

  it.each(["not JSON", "{}", "[]", '{"type":"doc","content":[]}', '{"type":"doc","content":[],"unexpected":1}'])("rejects invalid root %#", (raw) => {
    expect(() => parseImportedDocument(raw)).toThrow();
  });

  it("enforces byte, depth, and node limits before processing", () => {
    expect(() => plainTextDocument("👋".repeat(MAX_DOCUMENT_FILE_BYTES / 4 + 1))).toThrow(/256 KiB/);
    expect(() => parseImportedDocument(" ".repeat(MAX_DOCUMENT_FILE_BYTES + 1))).toThrow(/256 KiB/);
    let nested: unknown = paragraph;
    for (let i = 0; i < 40; i++) nested = { type: "blockquote", content: [nested] };
    expect(() => parseImportedDocument(doc([nested]))).toThrow(/nested too deeply/);
    expect(() => parseImportedDocument(doc(Array.from({ length: 10_001 }, () => ({ type: "paragraph" }))))).toThrow(/too many nodes/);
    expect(() => plainTextDocument("\n".repeat(10_000))).toThrow(/too many lines/);
    expect(() => plainTextDocument("\u0000binary")).toThrow(/Binary/);
    expect(() => plainTextDocument("\uD800")).toThrow(/invalid Unicode/);
    expect(() => parseImportedDocument(doc([{ type: "paragraph", content: [{ type: "text", text: "\uD800" }] }]))).toThrow(/invalid Unicode/);
  });

  it("reads UTF-8 TXT and JSON as new document creation payloads", async () => {
    expect(await readDocumentFile(new File(["hello"], "Notes.TXT"))).toEqual({ title: "Notes", content: plainTextDocument("hello") });
    expect(await readDocumentFile(new File([doc([paragraph])], "notes.json"))).toEqual({ title: "notes", content: { type: "doc", content: [paragraph] } });
  });

  it("rejects unknown formats, invalid UTF-8, and oversized files", async () => {
    await expect(readDocumentFile(new File(["Hello"], "notes.html"))).rejects.toThrow(/Unsupported file format/);
    await expect(readDocumentFile(new File([new Uint8Array([0xff, 0xfe, 0x41])], "notes.txt"))).rejects.toThrow(/UTF-8/);
    await expect(readDocumentFile(new File(["x".repeat(MAX_DOCUMENT_FILE_BYTES + 1)], "notes.txt"))).rejects.toThrow(/256 KiB/);
  });
});
