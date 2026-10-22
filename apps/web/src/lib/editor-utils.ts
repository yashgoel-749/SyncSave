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
