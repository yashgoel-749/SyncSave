import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { z } from "zod";

export const MAX_DOCUMENT_FILE_BYTES = 256 * 1024;
export const MAX_DOCUMENT_DEPTH = 32;
export const MAX_DOCUMENT_NODES = 10_000;

const editorSchema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } })]);
const emptyAttrs = z.object({}).strict();
const invalidUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const safeHref = z.string().min(1).refine((href) => {
  if (/[\s\u0000-\u001f\u007f\\]/u.test(href)) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return false;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}, "Links must use http://, https://, mailto:, or a local /path (not //host).");

const linkAttrs = z.object({
  href: safeHref,
  target: z.enum(["_blank", "_self"]).nullable().optional(),
  rel: z.string().refine((rel) => rel.split(/\s+/).every((token) =>
    ["noopener", "noreferrer", "nofollow"].includes(token)), "Unsupported link rel attribute").nullable().optional(),
  class: z.null().optional(),
}).strict();
const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["bold", "italic", "strike", "code", "underline"]), attrs: emptyAttrs.optional() }).strict(),
  z.object({ type: z.literal("link"), attrs: linkAttrs }).strict(),
]);
const attrsByType: Record<string, z.ZodType> = {
  heading: z.object({ level: z.number().int().min(1).max(3) }).strict(),
  orderedList: z.object({ start: z.number().int().min(1).optional(), type: z.null().optional() }).strict(),
  codeBlock: z.object({ language: z.string().max(100).regex(/^[\w+-]*$/).nullable().optional() }).strict(),
};
const nodeSchema: z.ZodType<JSONContent> = z.lazy(() => z.object({
  type: z.enum(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "horizontalRule"]),
  text: z.string().min(1).refine((text) => !invalidUnicode.test(text), "Text contains invalid Unicode. Save it as UTF-8.").optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  marks: z.array(markSchema).max(6).optional(),
  content: z.array(nodeSchema).optional(),
}).strict().superRefine((node, ctx) => {
  const attrs = (attrsByType[node.type] ?? emptyAttrs).safeParse(node.attrs ?? {});
  if (!attrs.success) {
    for (const issue of attrs.error.issues) ctx.addIssue({ code: "custom", path: ["attrs", ...issue.path], message: issue.message });
  }
  if (node.type === "text") {
    if (!node.text || node.content !== undefined || node.attrs !== undefined) {
      ctx.addIssue({ code: "custom", message: "Text nodes require non-empty text and cannot have content or attrs." });
    }
  } else if (node.text !== undefined || (node.marks !== undefined && node.type !== "hardBreak")) {
    ctx.addIssue({ code: "custom", message: "Only text nodes may contain text; only inline text and hard breaks may have marks." });
  }
  if (["hardBreak", "horizontalRule"].includes(node.type) && node.content !== undefined) {
    ctx.addIssue({ code: "custom", message: "Breaks cannot contain child nodes." });
  }
}));
const documentSchema = z.object({ type: z.literal("doc"), content: z.array(nodeSchema).min(1) }).strict();
export type TipTapDocument = z.infer<typeof documentSchema>;

function checkSize(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > MAX_DOCUMENT_FILE_BYTES) {
    throw new Error("Document exceeds 256 KiB. Choose a smaller file.");
  }
  if (invalidUnicode.test(raw)) {
    throw new Error("Document contains invalid Unicode. Save it as UTF-8 and try again.");
  }
}

function checkComplexity(value: unknown) {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item) break;
    if (item.depth > MAX_DOCUMENT_DEPTH) throw new Error("Document is nested too deeply (maximum depth: 32).");
    if (typeof item.value !== "object" || item.value === null) continue;
    if ("type" in item.value && ++nodes > MAX_DOCUMENT_NODES) throw new Error("Document has too many nodes (maximum: 10,000).");
    for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
  }
}

/** Parse a raw TipTap JSON document, throwing an actionable Error for invalid or unsafe content. */
export function parseImportedDocument(raw: string): TipTapDocument {
  checkSize(raw);
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/u, ""));
  } catch {
    throw new Error("Invalid JSON. Choose a TipTap document JSON export or import a UTF-8 .txt file.");
  }
  checkComplexity(value);
  const result = documentSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Unsupported document at ${issue?.path.join(".") || "root"}: ${issue?.message || "invalid structure"}. Use supported TipTap nodes and headings 1–3 only.`);
  }
  try {
    editorSchema.nodeFromJSON(result.data).check();
  } catch {
    throw new Error("Invalid document structure. Lists require list items; paragraphs and headings accept inline text only.");
  }
  return result.data;
}

/** Convert plain text to paragraphs without interpreting HTML, Markdown, or links. */
export function plainTextDocument(text: string): TipTapDocument {
  checkSize(text);
  if (/\u0000/u.test(text)) throw new Error("This is not a UTF-8 text document. Binary files are not supported.");
  const content = text.replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n").split("\n").map((line): JSONContent => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  }));
  if (content.reduce((total, node) => total + 1 + (node.content?.length ?? 0), 1) > MAX_DOCUMENT_NODES) {
    throw new Error("Document has too many lines (maximum: 10,000 nodes).");
  }
  const document = { type: "doc", content } satisfies TipTapDocument;
  checkSize(JSON.stringify(document));
  return document;
}

export async function readDocumentFile(file: File): Promise<{ title: string; content: TipTapDocument }> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "txt" && extension !== "json") throw new Error("Unsupported file format. Choose a UTF-8 .txt or TipTap .json file.");
  if (file.size > MAX_DOCUMENT_FILE_BYTES) throw new Error("File exceeds 256 KiB. Choose a smaller file.");
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error("Could not read UTF-8 text. Save the file as UTF-8 and try again.");
  }
  return {
    title: file.name.replace(/\.(txt|json)$/i, "").trim().slice(0, 100) || "Imported document",
    content: extension === "txt" ? plainTextDocument(raw) : parseImportedDocument(raw),
  };
}
