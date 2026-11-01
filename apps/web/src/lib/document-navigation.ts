import type { Node } from "@tiptap/pm/model";

export function documentHeadings(doc: Node) {
  const headings: Array<{ position: number; level: number; text: string }> = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading" && [1, 2, 3].includes(Number(node.attrs.level))) {
      headings.push({ position, level: Number(node.attrs.level), text: node.textContent || "Untitled heading" });
    }
  });
  return headings;
}

export function documentMatches(doc: Node, query: string) {
  const matches: Array<{ from: number; to: number }> = [];
  if (!query.trim()) return matches;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  doc.descendants((node, position) => {
    if (!node.isTextblock || matches.length >= 1000) return;
    const text = node.textBetween(0, node.content.size, "", "\n");
    for (const match of text.matchAll(pattern)) {
      matches.push({ from: position + 1 + match.index, to: position + 1 + match.index + match[0].length });
      if (matches.length >= 1000) break;
    }
    return false;
  });
  return matches;
}

export function exportFilename(title: string, extension: string) {
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 80).trim();
  return `${safeTitle || "document"}.${extension}`;
}
