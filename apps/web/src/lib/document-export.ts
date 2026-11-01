import type { Editor } from "@tiptap/core";
import { DOMSerializer, type Mark, type Node as PMNode } from "@tiptap/pm/model";

export const EXPORT_FORMATS = [
  { id: "pdf", label: "PDF", description: "Open Print / Save as PDF (choose the destination in your browser)." },
  { id: "docx", label: "Word (DOCX)", description: "Formatted, editable Microsoft Word document." },
  { id: "txt", label: "Plain text (TXT)", description: "UTF-8 text with paragraph and line breaks." },
  { id: "md", label: "Markdown (MD)", description: "Markdown formatting; underline uses inline <u> HTML." },
  { id: "html", label: "HTML", description: "Standalone white-paper document, without editor controls." },
  { id: "json", label: "TipTap JSON", description: "Raw document content for import or backup." },
] satisfies ReadonlyArray<{ id: "pdf" | "docx" | "txt" | "md" | "html" | "json"; label: string; description: string }>;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]["id"];
export type ExportSnapshot = Readonly<{ doc: PMNode; title: string; origin: string }>;

/** ProseMirror nodes are persistent values: later transactions cannot change this document. */
export function captureExportSnapshot({ editor, title }: { editor: Editor; title: string }): ExportSnapshot {
  return Object.freeze({ doc: editor.state.doc, title, origin: window.location.origin });
}

/** Replace XML-invalid controls and isolated surrogates, preserving valid Unicode and newlines. */
export function cleanExportText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, "\uFFFD");
}

export function safeExportHref(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value || /[\s\u0000-\u001F\u007F-\u009F\\\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value)) return null;
  if (!(value.startsWith("/") && !value.startsWith("//")) && !/^(https?:\/\/|mailto:)/i.test(value)) return null;
  try {
    const url = new URL(value, origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function unsupported(kind: string, name: string): never {
  throw new Error(`Cannot export ${kind} “${name}”. Replace it with supported text, headings 1–3, lists, quotes, or code and try again. JSON can preserve raw document content.`);
}

/** Rebuild only schema-supported content, stripping shared presentation attrs and unsafe links. */
function cleanDocument(node: PMNode, origin: string): PMNode {
  const marks: Mark[] = [];
  for (const mark of node.marks) {
    switch (mark.type.name) {
      case "bold": case "italic": case "underline": case "strike": case "code":
        marks.push(mark.type.create());
        break;
      case "link": {
        const href = safeExportHref(mark.attrs.href, origin);
        if (href) marks.push(mark.type.create({ href, target: null, rel: "noopener noreferrer", class: null }));
        break;
      }
      default: unsupported("mark", mark.type.name);
    }
  }
  if (node.isText) return node.type.schema.text(cleanExportText(node.text ?? ""), marks);
  const children: PMNode[] = [];
  node.forEach((child) => children.push(cleanDocument(child, origin)));
  switch (node.type.name) {
    case "heading":
      if (![1, 2, 3].includes(node.attrs.level)) unsupported("heading level", String(node.attrs.level));
      return node.type.create({ level: node.attrs.level }, children, marks);
    case "orderedList": {
      const start: unknown = node.attrs.start;
      if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 1) unsupported("ordered-list start", String(start));
      return node.type.create({ start }, children, marks);
    }
    case "codeBlock": {
      const language: unknown = node.attrs.language;
      return node.type.create({ language: typeof language === "string" && /^[\w+-]*$/.test(language) ? language : null }, children, marks);
    }
    case "doc": case "paragraph": case "bulletList": case "listItem": case "blockquote": case "hardBreak": case "horizontalRule":
      return node.type.create(null, children, marks);
    default: return unsupported("node", node.type.name);
  }
}

function childrenOf(node: PMNode): PMNode[] {
  const children: PMNode[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

function plainText(node: PMNode): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === "hardBreak") return "\n";
  if (node.type.name === "horizontalRule") return "---";
  const separator = node.inlineContent ? "" : "\n\n";
  return childrenOf(node).map(plainText).join(separator);
}

function escapeHTML(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeMarkdown(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()#+.!|~\-]/g, "\\$&");
}

function ticksFor(text: string, minimum: number): string {
  const lengths = Array.from(text.matchAll(/`+/g), (match) => match[0].length);
  return "`".repeat(Math.max(minimum, ...lengths.map((length) => length + 1)));
}

function markDelimiters(mark: Mark): [string, string] {
  switch (mark.type.name) {
    case "bold": return ["**", "**"];
    case "italic": return ["*", "*"];
    case "strike": return ["~~", "~~"];
    case "underline": return ["<u>", "</u>"];
    case "link": return ["[", `](<${String(mark.attrs.href).replace(/</g, "%3C").replace(/>/g, "%3E")}>)`];
    default: return unsupported("Markdown mark", mark.type.name);
  }
}

// Group adjacent shared marks, so overlapping formatting never emits ambiguous **** boundaries.
function markdownInline(nodes: PMNode[], markDepth = 0): string {
  let output = "";
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index];
    const mark = node.marks[markDepth];
    if (!mark) {
      output += node.type.name === "hardBreak" ? "  \n" : escapeMarkdown(node.text ?? "");
      index++;
      continue;
    }
    const group: PMNode[] = [];
    while (index < nodes.length && nodes[index].marks[markDepth]?.eq(mark)) group.push(nodes[index++]);
    if (mark.type.name === "code") {
      const text = group.map((child) => child.type.name === "hardBreak" ? "\n" : child.text ?? "").join("").replace(/\n/g, " ");
      const fence = ticksFor(text, 1);
      const padding = /^`|`$|^ .* $/.test(text) && !/^ +$/.test(text) ? " " : "";
      output += `${fence}${padding}${text}${padding}${fence}`;
    } else {
      const [open, close] = markDelimiters(mark);
      const content = markdownInline(group, markDepth + 1);
      // Markdown emphasis cannot begin/end with whitespace.
      const leading = content.match(/^\s*/)?.[0] ?? "";
      const trailing = content.slice(leading.length).match(/\s*$/)?.[0] ?? "";
      const inner = content.slice(leading.length, content.length - trailing.length);
      output += inner ? `${leading}${open}${inner}${close}${trailing}` : content;
    }
  }
  return output;
}

function markdown(node: PMNode): string {
  switch (node.type.name) {
    case "paragraph": return markdownInline(childrenOf(node));
    case "heading": return `${"#".repeat(node.attrs.level)} ${markdownInline(childrenOf(node))}`;
    case "codeBlock": {
      const text = plainText(node);
      const fence = ticksFor(text, 3);
      return `${fence}${node.attrs.language ?? ""}\n${text}\n${fence}`;
    }
    case "horizontalRule": return "---";
    case "blockquote": return childrenOf(node).map(markdown).join("\n\n").split("\n").map((line) => `> ${line}`).join("\n");
    case "bulletList": case "orderedList":
      return childrenOf(node).map((item, index) => {
        const marker = node.type.name === "bulletList" ? "- " : `${node.attrs.start + index}. `;
        const lines = markdown(item).split("\n");
        return lines.map((line, lineIndex) => lineIndex === 0 ? marker + line : " ".repeat(marker.length) + line).join("\n");
      }).join("\n");
    case "doc": case "listItem": return childrenOf(node).map(markdown).join("\n\n");
    default: return unsupported("Markdown node", node.type.name);
  }
}

const PAPER_CSS = `@page{margin:20mm}*{box-sizing:border-box}html,body{background:#fff;color:#111}body{margin:0 auto;padding:32px;max-width:820px;font:11pt/1.6 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.25;break-after:avoid}h1{font-size:26pt}h2{font-size:20pt}h3{font-size:15pt}p{margin:0 0 12pt}li>p{margin-bottom:6pt}blockquote{margin:16pt 0;padding-left:16pt;border-left:3px solid #bbb}pre{white-space:pre-wrap;padding:12pt;background:#f3f3f3}code{font-family:Consolas,monospace;font-size:.9em}a{color:#0645ad;text-decoration:underline}hr{border:0;border-top:1px solid #bbb;margin:20pt 0}@media print{body{max-width:none;padding:0}pre,blockquote{break-inside:avoid}}`;

function fullHTML(doc: PMNode, title: string, origin: string): string {
  const container = document.createElement("main");
  container.appendChild(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content, { document }));
  const allowedTags = new Set(["P", "H1", "H2", "H3", "STRONG", "B", "EM", "I", "U", "S", "DEL", "CODE", "PRE", "A", "BR", "UL", "OL", "LI", "BLOCKQUOTE", "HR"]);
  for (const element of container.querySelectorAll("*")) {
    if (!allowedTags.has(element.tagName)) unsupported("HTML element", element.tagName);
    for (const attribute of Array.from(element.attributes)) {
      if (!(element.tagName === "A" && attribute.name === "href") && !(element.tagName === "OL" && attribute.name === "start")) element.removeAttribute(attribute.name);
    }
    if (element.tagName === "A") {
      const href = safeExportHref(element.getAttribute("href"), origin);
      if (href) element.setAttribute("href", href);
      else element.removeAttribute("href");
    }
  }
  return `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(cleanExportText(title))}</title><style>${PAPER_CSS}</style></head><body>${container.outerHTML}</body></html>`;
}

export async function buildExportBlob(snapshot: ExportSnapshot, format: Exclude<ExportFormat, "pdf">): Promise<Blob> {
  if (format === "json") return new Blob([JSON.stringify(snapshot.doc.toJSON(), null, 2)], { type: "application/json;charset=utf-8" });
  const doc = cleanDocument(snapshot.doc, snapshot.origin);
  switch (format) {
    case "txt": return new Blob([plainText(doc)], { type: "text/plain;charset=utf-8" });
    case "md": return new Blob([markdown(doc) + "\n"], { type: "text/markdown;charset=utf-8" });
    case "html": return new Blob([fullHTML(doc, snapshot.title, snapshot.origin)], { type: "text/html;charset=utf-8" });
    case "docx": {
      const { buildDocxBlob } = await import("./document-docx");
      return buildDocxBlob({ ...snapshot, doc, title: cleanExportText(snapshot.title) });
    }
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported export format: ${exhaustive}`);
    }
  }
}

const PRINT_ERROR = "Could not open Print / Save as PDF. Allow printing in your browser and try again, or export HTML and print that file. No PDF was saved automatically.";

async function printSnapshot(snapshot: ExportSnapshot): Promise<void> {
  const html = fullHTML(cleanDocument(snapshot.doc, snapshot.origin), snapshot.title, snapshot.origin);
  const frame = document.createElement("iframe");
  frame.title = "Document Print / Save as PDF";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText = "position:fixed;bottom:0;right:0;width:1px;height:1px;border:0;pointer-events:none";
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(readinessTimer);
    clearTimeout(cleanupTimer);
    frame.remove();
  };
  const fallbackCleanup = () => {
    // Do not dispose a document while the browser's native print dialog owns focus.
    if (!document.hasFocus()) {
      cleanupTimer = setTimeout(fallbackCleanup, 60_000);
      return;
    }
    cleanup();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error(PRINT_ERROR));
      readinessTimer = setTimeout(() => reject(new Error(PRINT_ERROR)), 10_000);
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
    const target = frame.contentWindow;
    const content = frame.contentDocument;
    if (!target || !content || typeof target.print !== "function") throw new Error(PRINT_ERROR);
    await Promise.race([
      (async () => {
        await content.fonts?.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      })(),
      new Promise<never>((_, reject) => {
        clearTimeout(readinessTimer);
        readinessTimer = setTimeout(() => reject(new Error(PRINT_ERROR)), 10_000);
      }),
    ]);
    clearTimeout(readinessTimer);
    target.addEventListener("afterprint", cleanup, { once: true });
    // Some browsers omit afterprint, especially on cancellation. Never remove during print().
    target.focus();
    target.print();
    if (frame.isConnected) cleanupTimer = setTimeout(fallbackCleanup, 5 * 60_000);
  } catch {
    cleanup();
    throw new Error(PRINT_ERROR);
  }
}

function downloadBlob(blob: Blob, title: string, format: Exclude<ExportFormat, "pdf">): void {
  if (typeof URL.createObjectURL !== "function") throw new Error("Your browser cannot download this export. Try a current browser or use Print / Save as PDF.");
  const filename = cleanExportText(title).replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 120) || "Untitled document";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = `${filename}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    // Give the browser time to consume the URL, including large DOCX files.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("The export download was blocked. Allow downloads in your browser and try again.");
  } finally {
    anchor.remove();
  }
}

export async function exportDocument({ editor, title, format }: { editor: Editor; title: string; format: ExportFormat }): Promise<void> {
  const snapshot = captureExportSnapshot({ editor, title });
  if (format === "pdf") return printSnapshot(snapshot);
  const blob = await buildExportBlob(snapshot, format);
  downloadBlob(blob, snapshot.title, format);
}
