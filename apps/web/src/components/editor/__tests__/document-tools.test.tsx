import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DocumentTools from "../DocumentTools";
import { documentHeadings, documentMatches, exportFilename } from "@/lib/document-navigation";

describe("document navigation and export", () => {
  let editor: Editor;
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: jest.fn() });
    editor = new Editor({ extensions: [StarterKit], content: {
      type: "doc", content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Project plan" }] },
        { type: "paragraph", content: [
          { type: "text", text: "Find " },
          { type: "text", text: "this", marks: [{ type: "bold" }] },
          { type: "text", text: " phrase. [a+b]" },
          { type: "hardBreak" },
          { type: "text", text: "Next line" },
        ] },
      ],
    } });
  });
  afterEach(() => editor.destroy());

  it("finds literal phrases across formatting and preserves position after line breaks", () => {
    const doc = editor.state.doc;
    for (const query of ["THIS phrase", "[a+b]", "Next line"]) {
      const matches = documentMatches(doc, query);
      expect(matches).toHaveLength(1);
      expect(doc.textBetween(matches[0].from, matches[0].to).toLowerCase()).toBe(query.toLowerCase());
    }
    expect(documentMatches(doc, " ")).toEqual([]);
    expect(documentHeadings(doc)).toEqual([{ position: 0, level: 2, text: "Project plan" }]);
  });

  it("selects a find result without changing text", () => {
    render(<DocumentTools editor={editor} title="Plan" />);
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in document" }), { target: { value: "this phrase" } });
    const before = editor.getJSON();
    fireEvent.click(screen.getByRole("button", { name: "Show match" }));
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("this phrase");
    expect(editor.getJSON()).toEqual(before);
  });

  it("downloads current JSON and explains the text-only scope", async () => {
    const createObjectURL = jest.fn<string, [Blob]>(() => "blob:export");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<DocumentTools editor={editor} title="Plan / launch" />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByText(/whiteboard drawings are not included/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /JSON/ }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
    expect(click).toHaveBeenCalled();
    const exported = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Expected text export"));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(createObjectURL.mock.calls[0][0]);
    });
    expect(JSON.parse(exported)).toEqual(editor.getJSON());
    click.mockRestore();
    expect(exportFilename("Plan / launch", "json")).toBe("Plan - launch.json");
    expect(exportFilename("... ", "txt")).toBe("document.txt");
  });

  it("keeps help and navigation available while the editor is initializing", () => {
    render(<DocumentTools editor={null} title="Plan" />);
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Help & shortcuts" })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
  });
});
