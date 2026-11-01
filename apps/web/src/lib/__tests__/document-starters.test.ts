/** @jest-environment node */
import { DOCUMENT_STARTERS } from "../document-starters";
import { parseImportedDocument } from "../document-files";

describe("document templates", () => {
  it("provides distinct, usable starter documents", () => {
    expect(DOCUMENT_STARTERS).toHaveLength(3);
    expect(new Set(DOCUMENT_STARTERS.map((starter) => starter.id)).size).toBe(3);
    for (const starter of DOCUMENT_STARTERS) {
      expect(starter.description).not.toBe("");
      expect(starter.title.length).toBeLessThanOrEqual(100);
      expect(parseImportedDocument(JSON.stringify(starter.content))).toEqual(starter.content);
      expect(starter.content.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 }, content: [{ text: starter.title }] });
    }
  });
});
