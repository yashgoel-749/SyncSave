import {
  BorderStyle, Document, ExternalHyperlink, HeadingLevel, LevelFormat,
  Packer, Paragraph, TextRun, UnderlineType,
  type INumberingOptions, type IParagraphOptions, type ParagraphChild,
} from "docx";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ExportSnapshot } from "./document-export";

type ListContext = { reference: string; level: number };
type BlockContext = { depth: number; quoteDepth: number; list?: ListContext };

function headingLevel(level: number) {
  switch (level) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    default: throw new Error("Word export supports headings 1–3. Change the heading level and try again.");
  }
}

function inlineRuns(node: PMNode, codeBlock = false): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  node.forEach((child) => {
    if (!child.isText && child.type.name !== "hardBreak") throw new Error(`Word export cannot represent inline node “${child.type.name}”. Replace it with text and try again.`);
    const marks = new Set(child.marks.map((mark) => mark.type.name));
    const link = child.marks.find((mark) => mark.type.name === "link");
    const parts = child.type.name === "hardBreak" ? [""] : (child.text ?? "").split("\n");
    const textRuns = parts.map((text, index) => new TextRun({
      text, break: child.type.name === "hardBreak" || index > 0 ? 1 : undefined,
      bold: marks.has("bold"), italics: marks.has("italic"), strike: marks.has("strike"),
      underline: marks.has("underline") ? { type: UnderlineType.SINGLE } : undefined,
      font: codeBlock || marks.has("code") ? "Consolas" : undefined,
      shading: marks.has("code") ? { fill: "F3F3F3" } : undefined,
    }));
    if (link) runs.push(new ExternalHyperlink({ link: String(link.attrs.href), children: textRuns }));
    else runs.push(...textRuns);
  });
  return runs;
}

/** Accepts the sanitized persistent tree prepared by buildExportBlob. */
export async function buildDocxBlob(snapshot: ExportSnapshot): Promise<Blob> {
  const numbering: INumberingOptions["config"][number][] = [];
  const paragraphs: Paragraph[] = [];
  function addParagraph(node: PMNode, context: BlockContext) {
    const indent = context.depth * 720 + context.quoteDepth * 360;
    const options: IParagraphOptions = {
      children: inlineRuns(node, node.type.name === "codeBlock"),
      heading: node.type.name === "heading" ? headingLevel(node.attrs.level) : undefined,
      style: node.type.name === "codeBlock" ? "ExportCode" : context.quoteDepth ? "ExportQuote" : undefined,
      numbering: context.list ? { reference: context.list.reference, level: context.list.level } : undefined,
      indent: indent ? { left: indent } : undefined,
      spacing: { after: 160 },
    };
    paragraphs.push(new Paragraph(options));
  }

  function visit(node: PMNode, context: BlockContext): void {
    switch (node.type.name) {
      case "doc":
        node.forEach((child) => visit(child, context));
        return;
      case "paragraph": case "heading": case "codeBlock":
        addParagraph(node, context);
        return;
      case "blockquote":
        node.forEach((child, _offset, index) => visit(child, { ...context, quoteDepth: context.quoteDepth + 1, list: index === 0 ? context.list : undefined }));
        return;
      case "horizontalRule":
        paragraphs.push(new Paragraph({
          border: { bottom: { color: "BBBBBB", style: BorderStyle.SINGLE, size: 6 } },
          spacing: { before: 200, after: 200 },
          indent: { left: context.depth * 720 + context.quoteDepth * 360 },
        }));
        return;
      case "bulletList": case "orderedList": {
        const reference = `export-list-${numbering.length + 1}`;
        const depth = context.depth;
        const level = depth < 9 ? depth : 0;
        // Each PM list owns a numbering definition: separate lists restart, siblings continue.
        // OOXML permits only nine levels; beyond that, a fresh level-0 definition + indent
        // represents arbitrary PM depth without truncating content or applying import limits.
        numbering.push({
          reference,
          levels: Array.from({ length: level + 1 }, (_, currentLevel) => ({
            level: currentLevel,
            format: node.type.name === "orderedList" ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: node.type.name === "orderedList" ? `%${currentLevel + 1}.` : "•",
            start: node.type.name === "orderedList" ? node.attrs.start : 1,
            style: { paragraph: { indent: { left: (depth + 1) * 720 + context.quoteDepth * 360, hanging: 360 } } },
          })),
        });
        node.forEach((item) => {
          if (item.type.name !== "listItem") throw new Error("Word export requires list items. Repair the list and try again.");
          item.forEach((child, _offset, index) => visit(child, {
            depth: depth + 1, quoteDepth: context.quoteDepth,
            list: index === 0 ? { reference, level } : undefined,
          }));
        });
        return;
      }
      default: throw new Error(`Word export cannot represent node “${node.type.name}”. Replace it with supported text, lists, quotes, or code and try again.`);
    }
  }

  visit(snapshot.doc, { depth: 0, quoteDepth: 0 });
  const document = new Document({
    title: snapshot.title,
    creator: "SyncSpace",
    styles: {
      default: { document: { run: { font: "Arial", size: 22, color: "111111" }, paragraph: { spacing: { after: 160, line: 276 } } } },
      paragraphStyles: [
        { id: "ExportCode", name: "Code block", basedOn: "Normal", run: { font: "Consolas", size: 20 }, paragraph: { shading: { fill: "F3F3F3" }, spacing: { before: 120, after: 160 } } },
        { id: "ExportQuote", name: "Block quote", basedOn: "Normal", paragraph: { border: { left: { style: BorderStyle.SINGLE, color: "BBBBBB", size: 12, space: 10 } } } },
      ],
    },
    numbering: { config: numbering },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: paragraphs }],
  });
  try {
    return await Packer.toBlob(document);
  } catch (cause) {
    throw new Error("Could not create the Word document. Try exporting HTML or JSON, then retry Word export in a current browser.", { cause });
  }
}
