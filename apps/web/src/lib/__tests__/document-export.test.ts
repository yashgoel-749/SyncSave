import { Editor, Mark, Node, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import JSZip from "jszip";
import { TextEncoder } from "node:util";
import {
  EXPORT_FORMATS, buildExportBlob, captureExportSnapshot, exportDocument,
  type ExportFormat, type ExportSnapshot,
} from "../document-export";

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
// JSDOM omits this browser primitive; use Node's real UTF-8 encoder, not a converter mock.
Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const item = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const fixture: JSONContent = {
  type: "doc",
  content: [
    ...[1, 2, 3].map((level) => ({ type: "heading", attrs: { level }, content: [text(`Heading ${level}`)] })),
    paragraph(text("Hello 世界 😀 café & <script>alert(1)</script> *literal* ", [{ type: "bold" }, { type: "italic" }]),
      text("under", [{ type: "underline" }]), text("strike", [{ type: "strike" }]),
      text("a``b", [{ type: "code" }]), { type: "hardBreak" }, text("next line")),
    paragraph(text("Local link", [{ type: "link", attrs: { href: "/documents/one?x=1&y=2", class: "chrome", target: "_blank" } }]),
      text("Mail", [{ type: "link", attrs: { href: "mailto:team@example.com" } }]),
      text("Web", [{ type: "link", attrs: { href: "https://example.com/a(b)?x=1&y=2" } }])),
    paragraph(text("Unsafe JS", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
      text("Unsafe control", [{ type: "link", attrs: { href: "https://bad.example/\u0001" } }]),
      text("Unsafe protocol relative", [{ type: "link", attrs: { href: "//bad.example" } }])),
    { type: "orderedList", attrs: { start: 7 }, content: [
      item(paragraph(text("Seven")), paragraph(text("Continuation paragraph")),
        { type: "bulletList", content: [item(paragraph(text("Nested bullet")),
          { type: "orderedList", attrs: { start: 3 }, content: [item(paragraph(text("Nested three")))] })] }),
      item(paragraph(text("Eight"))),
    ] },
    { type: "orderedList", attrs: { start: 2 }, content: [item(paragraph(text("Restart two")))] },
    { type: "blockquote", content: [paragraph(text("Quoted Unicode 日本語")), { type: "blockquote", content: [paragraph(text("Nested quote"))] }] },
    { type: "horizontalRule" },
    { type: "codeBlock", attrs: { language: "js" }, content: [text("const x = `one`;\n````\n<script>literal</script>")] },
    paragraph(text("Controls:\u0000\u0001\u000B\uFFFE lone:\uD800 valid:😀")),
  ],
};

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) return reject(new Error("Expected export bytes"));
      resolve(new Uint8Array(reader.result));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Expected export text"));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function unzip(blob: Blob) {
  return JSZip.loadAsync(await readBytes(blob));
}

async function xmlFile(zip: JSZip, path: string): Promise<XMLDocument> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing OOXML file ${path}`);
  const xml = new DOMParser().parseFromString(await file.async("string"), "application/xml");
  expect(xml.querySelector("parsererror")).toBeNull();
  return xml;
}

function wordElements(xml: Document | Element, tag: string): Element[] {
  return Array.from(xml.getElementsByTagNameNS(wordNamespace, tag));
}

function wordAttribute(element: Element, name: string) {
  return element.getAttributeNS(wordNamespace, name);
}

describe("real document exports", () => {
  const editors: Editor[] = [];
  let editor: Editor;
  let snapshot: ExportSnapshot;
  beforeEach(() => {
    editor = new Editor({ extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })], content: fixture });
    editors.push(editor);
    snapshot = captureExportSnapshot({ editor, title: 'Report <script>"& 世界\u0001' });
  });
  afterEach(() => {
    editors.splice(0).forEach((instance) => instance.destroy());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("defines all six formats from one descriptor and explains PDF and underline", () => {
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual(["pdf", "docx", "txt", "md", "html", "json"]);
    expect(EXPORT_FORMATS.find((format) => format.id === "pdf")?.description).toMatch(/Print \/ Save as PDF/);
    expect(EXPORT_FORMATS.find((format) => format.id === "md")?.description).toContain("<u>");
  });

  it("preserves raw JSON exactly and does not mutate unsafe shared marks", async () => {
    const before = editor.getJSON();
    expect(JSON.parse(await readText(await buildExportBlob(snapshot, "json")))).toEqual(before);
    for (const format of ["txt", "md", "html", "docx"] satisfies ExportFormat[]) await buildExportBlob(snapshot, format);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.doc).toBe(snapshot.doc);
  });

  it("captures persistent content before transactions and does not apply import file limits", async () => {
    const longText = "世界".repeat(140_000);
    editor.commands.setContent({ type: "doc", content: [paragraph(text(longText)), paragraph(text("second"))] });
    const captured = captureExportSnapshot({ editor, title: "Large" });
    const result = buildExportBlob(captured, "txt");
    editor.commands.setContent("<p>Later content</p>");
    expect(await readText(await result)).toBe(`${longText}\n\nsecond`);
  });

  it("keeps TXT hard breaks distinct from paragraph separators and valid Unicode", async () => {
    const value = await readText(await buildExportBlob(snapshot, "txt"));
    expect(value).toContain("Heading 1\n\nHeading 2\n\nHeading 3");
    expect(value).toContain("a``b\nnext line");
    expect(value).toContain("世界 😀 café & <script>alert(1)</script> *literal*");
    expect(value).toContain("Seven\n\nContinuation paragraph\n\nNested bullet");
    expect(value).not.toMatch(/[\u0000\u0001\u000B\uFFFE]/u);
    expect(value).toContain("lone:� valid:😀");
  });

  it("creates UTF-8 schema-derived, isolated white-paper HTML without executable content", async () => {
    const value = await readText(await buildExportBlob(snapshot, "html"));
    expect(value).toMatch(/^<!doctype html>/);
    const html = new DOMParser().parseFromString(value, "text/html");
    expect(html.querySelector('meta[charset="UTF-8"]')).not.toBeNull();
    expect(html.title).toBe('Report <script>"& 世界�');
    expect(html.querySelector("script,iframe,img,link,button,input,canvas")).toBeNull();
    expect(html.querySelector("style")?.textContent).toContain("background:#fff;color:#111");
    expect(html.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'");
    expect(html.querySelector("main")?.textContent).toContain("<script>alert(1)</script>");
    expect(html.querySelector("strong em")?.textContent).toContain("世界 😀");
    expect(html.querySelector("u")?.textContent).toBe("under");
    expect(html.querySelector("s")?.textContent).toBe("strike");
    expect(html.querySelector("ol")?.getAttribute("start")).toBe("7");
    const links = Array.from(html.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `${snapshot.origin}/documents/one?x=1&y=2`, "mailto:team@example.com", "https://example.com/a(b)?x=1&y=2",
    ]);
    expect(html.querySelector("[class],[style],[onclick],[target],.collaboration-cursor")).toBeNull();
    expect(html.querySelector("main")?.textContent).toContain("Unsafe JSUnsafe controlUnsafe protocol relative");
  });

  it("serializes Markdown from PM nodes with literal escaping, nested numbering and safe fences", async () => {
    const value = await readText(await buildExportBlob(snapshot, "md"));
    expect(value).toContain("# Heading 1\n\n## Heading 2\n\n### Heading 3");
    expect(value).toContain("&lt;script&gt;alert\\(1\\)&lt;/script&gt; \\*literal\\*");
    expect(value).toContain("<u>under</u>~~strike~~```a``b```  \nnext line");
    expect(value).toContain("7. Seven\n   \n   Continuation paragraph\n   \n   - Nested bullet\n     \n     3. Nested three\n8. Eight");
    expect(value).toContain("2. Restart two");
    expect(value).toContain("> Quoted Unicode 日本語\n> \n> > Nested quote");
    expect(value).toContain("\n\n---\n\n`````js\nconst x = `one`;\n````\n<script>literal</script>\n`````");
    expect(value).toContain(`[Local link](<${snapshot.origin}/documents/one?x=1&y=2>)`);
    expect(value).not.toContain("javascript:");
  });

  it("groups overlapping marks rather than creating ambiguous adjacent bold delimiters", async () => {
    editor.commands.setContent({ type: "doc", content: [paragraph(
      text("one", [{ type: "bold" }]), text("two", [{ type: "bold" }, { type: "italic" }]), text("three", [{ type: "bold" }]),
      text(" `edge` ", [{ type: "code" }]),
    )] });
    const value = await readText(await buildExportBlob(captureExportSnapshot({ editor, title: "Marks" }), "md"));
    expect(value).toBe("**one*two*three**``  `edge`  ``\n");
  });

  it("packs genuine OOXML with styles, links, nested lists, starts/restarts, and continuation paragraphs", async () => {
    const blob = await buildExportBlob(snapshot, "docx");
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const zip = await unzip(blob);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    const doc = await xmlFile(zip, "word/document.xml");
    const styles = await xmlFile(zip, "word/styles.xml");
    const numbering = await xmlFile(zip, "word/numbering.xml");
    const relationships = await xmlFile(zip, "word/_rels/document.xml.rels");
    const allText = wordElements(doc, "t").map((node) => node.textContent).join("");
    expect(allText).toContain("Hello 世界 😀 café & <script>alert(1)</script> *literal*");
    expect(allText).toContain("lone:� valid:😀");
    expect(wordElements(doc, "pStyle").map((style) => wordAttribute(style, "val"))).toEqual(expect.arrayContaining(["Heading1", "Heading2", "Heading3", "ExportQuote", "ExportCode"]));
    for (const tag of ["b", "i", "u", "strike", "br", "pBdr"]) expect(wordElements(doc, tag).length).toBeGreaterThan(0);
    expect(wordElements(doc, "br").length).toBe(3);
    expect(wordElements(styles, "style").map((style) => wordAttribute(style, "styleId"))).toEqual(expect.arrayContaining(["Heading1", "Heading2", "Heading3", "ExportCode", "ExportQuote"]));
    expect(wordElements(doc, "rFonts").map((font) => wordAttribute(font, "ascii"))).toContain("Consolas");
    const rels = Array.from(relationships.getElementsByTagName("Relationship")).filter((rel) => rel.getAttribute("Type")?.endsWith("/hyperlink"));
    expect(rels.map((rel) => rel.getAttribute("Target"))).toEqual(expect.arrayContaining([`${snapshot.origin}/documents/one?x=1&y=2`, "mailto:team@example.com", "https://example.com/a(b)?x=1&y=2"]));
    expect(rels).toHaveLength(3);
    expect(wordElements(numbering, "start").map((start) => wordAttribute(start, "val"))).toEqual(expect.arrayContaining(["7", "3", "2"]));
    expect(wordElements(numbering, "numFmt").map((format) => wordAttribute(format, "val"))).toEqual(expect.arrayContaining(["decimal", "bullet"]));
    const paragraphByText = (value: string) => {
      const result = wordElements(doc, "p").find((p) => wordElements(p, "t").map((t) => t.textContent).join("") === value);
      if (!result) throw new Error(`Missing paragraph ${value}`);
      return result;
    };
    const numberId = (value: string) => wordAttribute(wordElements(paragraphByText(value), "numId")[0], "val");
    expect(numberId("Seven")).toBe(numberId("Eight"));
    expect(numberId("Restart two")).not.toBe(numberId("Seven"));
    expect(wordElements(paragraphByText("Continuation paragraph"), "numPr")).toHaveLength(0);
    expect(wordAttribute(wordElements(paragraphByText("Continuation paragraph"), "ind")[0], "left")).toBe("720");
    expect(wordAttribute(wordElements(paragraphByText("Nested bullet"), "ilvl")[0], "val")).toBe("1");
    expect(wordAttribute(wordElements(paragraphByText("Nested three"), "ilvl")[0], "val")).toBe("2");
    for (const path of Object.keys(zip.files).filter((path) => path.endsWith(".xml") || path.endsWith(".rels"))) await xmlFile(zip, path);
  });

  it.each(["txt", "md", "html", "docx"] satisfies Exclude<ExportFormat, "pdf" | "json">[])("reports unsupported nodes for %s rather than omitting content", async (format) => {
    const widget = Node.create({ name: "widget", group: "block", atom: true, renderHTML: () => ["div"] });
    const customEditor = new Editor({ extensions: [StarterKit, widget], content: { type: "doc", content: [{ type: "widget" }] } });
    editors.push(customEditor);
    const custom = captureExportSnapshot({ editor: customEditor, title: "Unsupported" });
    await expect(buildExportBlob(custom, format)).rejects.toThrow(/node “widget”.*Replace/);
    expect(JSON.parse(await readText(await buildExportBlob(custom, "json"))).content[0].type).toBe("widget");
  });

  it("reports unknown marks but sanitizes known unsafe links without rejecting shared documents", async () => {
    const annotation = Mark.create({ name: "annotation", renderHTML: () => ["span", 0] });
    const customEditor = new Editor({ extensions: [StarterKit, annotation], content: { type: "doc", content: [paragraph(text("Annotated", [{ type: "annotation" }]))] } });
    editors.push(customEditor);
    await expect(buildExportBlob(captureExportSnapshot({ editor: customEditor, title: "Unsupported" }), "html")).rejects.toThrow(/mark “annotation”/);
  });

  it("downloads captured content with a safe filename and disposes the anchor and Blob URL", async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const blobs: Blob[] = [];
    const create = jest.fn((blob: Blob) => { blobs.push(blob); return "blob:export-test"; });
    const revoke = jest.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const filenames: string[] = [];
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
    jest.useFakeTimers();
    try {
      editor.commands.setContent("<p>Captured</p>");
      const exporting = exportDocument({ editor, title: "Report/unsafe:*?", format: "txt" });
      editor.commands.setContent("<p>Changed while awaiting</p>");
      await exporting;
      expect(filenames).toEqual(["Report-unsafe---.txt"]);
      expect(document.querySelector('a[download]')).toBeNull();
      expect(revoke).not.toHaveBeenCalled();
      jest.advanceTimersByTime(60_000);
      expect(revoke).toHaveBeenCalledWith("blob:export-test");
      jest.useRealTimers();
      expect(await readText(blobs[0])).toBe("Captured");
    } finally {
      if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
      else Reflect.deleteProperty(URL, "createObjectURL");
      if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
      else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it.each(["afterprint", "fallback"])("prints only an isolated white-paper iframe and removes it on %s", async (cleanup) => {
    jest.useFakeTimers();
    const pending = exportDocument({ editor, title: "Print title", format: "pdf" });
    const frame = document.querySelector("iframe");
    if (!frame?.contentWindow || !frame.contentDocument) throw new Error("Expected disposable print iframe");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(frame.srcdoc).toContain("<title>Print title</title>");
    expect(frame.srcdoc).not.toContain("<script>");
    // JSDOM does not load srcdoc or implement a native print dialog. Drive those browser
    // boundaries, keeping the real generated document and iframe lifecycle under test.
    frame.contentDocument.open();
    frame.contentDocument.write(frame.srcdoc);
    frame.contentDocument.close();
    const print = jest.spyOn(frame.contentWindow, "print").mockImplementation(() => {});
    jest.spyOn(frame.contentWindow, "focus").mockImplementation(() => {});
    frame.dispatchEvent(new Event("load"));
    await jest.advanceTimersByTimeAsync(100);
    await pending;
    expect(print).toHaveBeenCalledTimes(1);
    expect(frame.contentDocument.body.textContent).toContain("Hello 世界 😀");
    expect(frame.isConnected).toBe(true);
    if (cleanup === "afterprint") frame.contentWindow.dispatchEvent(new Event("afterprint"));
    else {
      const focus = jest.spyOn(document, "hasFocus").mockReturnValue(false);
      jest.advanceTimersByTime(5 * 60_000);
      expect(frame.isConnected).toBe(true);
      focus.mockReturnValue(true);
      jest.advanceTimersByTime(60_000);
    }
    expect(document.querySelector("iframe")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("reports a blocked native print call without claiming a PDF was saved", async () => {
    jest.useFakeTimers();
    const pending = exportDocument({ editor, title: "Blocked print", format: "pdf" });
    const rejected = expect(pending).rejects.toThrow(/Allow printing.*No PDF was saved automatically/);
    const frame = document.querySelector("iframe");
    if (!frame?.contentWindow) throw new Error("Expected disposable print iframe");
    jest.spyOn(frame.contentWindow, "print").mockImplementation(() => { throw new Error("Blocked"); });
    jest.spyOn(frame.contentWindow, "focus").mockImplementation(() => {});
    frame.dispatchEvent(new Event("load"));
    await jest.advanceTimersByTimeAsync(100);
    await rejected;
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("reports an unsupported print-frame load and cleans up rather than printing a blank page", async () => {
    jest.useFakeTimers();
    const pending = exportDocument({ editor, title: "Load failure", format: "pdf" });
    const rejected = expect(pending).rejects.toThrow(/Could not open Print \/ Save as PDF/);
    const frame = document.querySelector("iframe");
    if (!frame) throw new Error("Expected disposable print iframe");
    frame.dispatchEvent(new Event("error"));
    await rejected;
    expect(document.querySelector("iframe")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
