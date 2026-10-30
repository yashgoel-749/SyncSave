/**
 * Utility functions for TipTap document parsing, validation, and sanitization
 */

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface TipTapDocument {
  type: "doc";
  content: TipTapNode[];
}

export const EMPTY_DOCUMENT: TipTapDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
};

/**
 * Safely parses document content string from the database.
 * If raw is valid TipTap JSON, returns parsed JSON object.
 * If raw is legacy plain text or markdown, safely converts to valid TipTap doc.
 * If raw is null/empty, returns empty paragraph document.
 */
export function parseDocumentContent(
  raw: string | null | undefined
): TipTapDocument {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return EMPTY_DOCUMENT;
  }

  const trimmed = raw.trim();

  // 1. Attempt parsing as TipTap JSON
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.type === "doc" &&
        Array.isArray(parsed.content)
      ) {
        return parsed as TipTapDocument;
      }
    } catch {
      // Fallback to text parsing below
    }
  }

  // 2. Fallback: Parse plain text lines into TipTap paragraphs
  const lines = raw.split(/\r?\n/);
  const contentNodes: TipTapNode[] = lines.map((line) => {
    if (!line) {
      return { type: "paragraph" };
    }
    return {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: line,
        },
      ],
    };
  });

  return {
    type: "doc",
    content: contentNodes.length > 0 ? contentNodes : [{ type: "paragraph" }],
  };
}

const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "bulletList",
  "orderedList",
  "taskItem",
  "horizontalRule",
  "hardBreak",
]);

/**
 * Walks a TipTap/ProseMirror JSON tree and returns its plain-text content.
 * Block boundaries become single spaces (or newlines when `preserveLineBreaks`),
 * runs of whitespace are collapsed, and the result is trimmed.
 *
 * Accepts either a parsed document or the raw string stored in the database.
 */
export function extractPlainText(
  source: string | TipTapDocument | TipTapNode | null | undefined,
  options: { preserveLineBreaks?: boolean; maxLength?: number } = {}
): string {
  if (!source) return "";

  const root: TipTapNode | TipTapDocument =
    typeof source === "string" ? parseDocumentContent(source) : source;

  const separator = options.preserveLineBreaks ? "\n" : " ";
  const parts: string[] = [];

  const walk = (node: TipTapNode | TipTapDocument): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "text" && typeof (node as TipTapNode).text === "string") {
      parts.push((node as TipTapNode).text as string);
      return;
    }
    if (node.type === "hardBreak") {
      parts.push(separator);
      return;
    }
    const children = node.content;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    }
    if (BLOCK_NODE_TYPES.has(node.type)) {
      parts.push(separator);
    }
  };

  walk(root);

  let text = parts.join("");
  text = options.preserveLineBreaks
    ? text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim()
    : text.replace(/\s+/g, " ").trim();

  if (options.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength - 1).trimEnd() + "…";
  }
  return text;
}

/**
 * Counts words in a plain-text string (unicode aware, ignores punctuation-only tokens).
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const matches = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

/**
 * Sanitizes and validates a URL to prevent javascript: or unsafe schemes.
 * Only allows http://, https://, mailto:, and relative URLs.
 */
export function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Disallow javascript: or data: schemes
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return null;
  }

  // Allow mailto:
  if (/^mailto:/i.test(trimmed)) {
    return trimmed;
  }

  // If starts with http:// or https:// or /
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return trimmed;
  }

  // Default to https:// if scheme is missing
  return `https://${trimmed}`;
}
