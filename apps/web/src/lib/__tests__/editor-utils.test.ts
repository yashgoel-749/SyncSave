import {
  parseDocumentContent,
  sanitizeUrl,
  EMPTY_DOCUMENT,
} from "../editor-utils";

describe("Editor Utilities (TipTap JSON & URL Sanitization)", () => {
  describe("parseDocumentContent", () => {
    it("should return EMPTY_DOCUMENT for null, undefined, or whitespace", () => {
      expect(parseDocumentContent(null)).toEqual(EMPTY_DOCUMENT);
      expect(parseDocumentContent(undefined)).toEqual(EMPTY_DOCUMENT);
      expect(parseDocumentContent("")).toEqual(EMPTY_DOCUMENT);
      expect(parseDocumentContent("   ")).toEqual(EMPTY_DOCUMENT);
    });

    it("should parse valid TipTap JSON document", () => {
      const validTipTapJson = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Sprint Planning" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Here is our roadmap." }],
          },
        ],
      });

      const parsed = parseDocumentContent(validTipTapJson);
      expect(parsed.type).toBe("doc");
      expect(parsed.content.length).toBe(2);
      expect(parsed.content[0].type).toBe("heading");
      expect(parsed.content[1].type).toBe("paragraph");
    });

    it("should safely convert legacy plain text into TipTap paragraphs", () => {
      const plainText = "First line of text\n\nSecond line of text";
      const parsed = parseDocumentContent(plainText);

      expect(parsed.type).toBe("doc");
      expect(parsed.content.length).toBe(3); // line 1, empty line, line 2
      expect(parsed.content[0].type).toBe("paragraph");
      expect(parsed.content[0].content?.[0].text).toBe("First line of text");
      expect(parsed.content[2].content?.[0].text).toBe("Second line of text");
    });

    it("should handle corrupted JSON string by falling back safely to text nodes", () => {
      const brokenJson = '{"type":"doc", "content": [ broken';
      const parsed = parseDocumentContent(brokenJson);

      expect(parsed.type).toBe("doc");
      expect(parsed.content.length).toBe(1);
      expect(parsed.content[0].content?.[0].text).toBe(brokenJson);
    });
  });

  describe("sanitizeUrl", () => {
    it("should allow valid https and http URLs", () => {
      expect(sanitizeUrl("https://github.com/syncspace")).toBe(
        "https://github.com/syncspace"
      );
      expect(sanitizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
    });

    it("should allow mailto URLs", () => {
      expect(sanitizeUrl("mailto:team@syncspace.dev")).toBe(
        "mailto:team@syncspace.dev"
      );
    });

    it("should allow relative URLs", () => {
      expect(sanitizeUrl("/dashboard?filter=recent")).toBe(
        "/dashboard?filter=recent"
      );
    });

    it("should automatically prepend https:// to bare domains", () => {
      expect(sanitizeUrl("example.com")).toBe("https://example.com");
    });

    it("should reject malicious javascript: and data: schemes", () => {
      expect(sanitizeUrl("javascript:alert('pwned')")).toBeNull();
      expect(sanitizeUrl("JAVASCRIPT:alert(1)")).toBeNull();
      expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
      expect(sanitizeUrl("vbscript:msgbox(1)")).toBeNull();
      expect(sanitizeUrl("   ")).toBeNull();
    });
  });
});
