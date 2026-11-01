import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import DocumentOutline from "../DocumentOutline";
import EditorToolbar from "../EditorToolbar";

let editor: Editor;
let ydoc: Y.Doc;
beforeEach(() => {
  ydoc = new Y.Doc();
  editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: ydoc })] });
  editor.commands.setContent("<h1>Overview</h1><h2>Decisions</h2><h3>Next steps</h3><p>Editable text</p>");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
  Object.defineProperty(window, "scrollTo", { configurable: true, value: jest.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); editor.destroy(); ydoc.destroy(); });

it("renders a vertical heading navigation and updates from the shared document", () => {
  render(<DocumentOutline editor={editor} visibility={{ desktopOpen: true, mobileOpen: false }} onClose={() => {}} id="outline" />);
  const nav = screen.getByRole("navigation", { name: "Document outline" });
  expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["H1Overview", "H2Decisions", "H3Next steps"]);
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
  const remoteEditor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: remote })] });
  remoteEditor.commands.insertContentAt(remoteEditor.state.doc.content.size, "<h2>Remote section</h2>");
  act(() => { Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remote)); });
  expect(within(nav).getByRole("button", { name: "Remote section" })).toBeInTheDocument();
  remoteEditor.destroy(); remote.destroy();
});

it("heading navigation does not alter text, undo history, or shared state", async () => {
  render(<DocumentOutline editor={editor} visibility={{ desktopOpen: true, mobileOpen: false }} onClose={() => {}} id="outline" />);
  const before = Y.encodeStateAsUpdate(ydoc);
  const selection = editor.state.selection;
  fireEvent.click(screen.getByRole("button", { name: "Next steps" }));
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  expect(window.scrollTo).toHaveBeenCalled();
  expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
  expect(editor.state.selection.eq(selection)).toBe(true);
});

it("opens an accessible mobile dialog and restores scroll state on close", () => {
  const onClose = jest.fn();
  const view = render(<DocumentOutline editor={editor} visibility={{ desktopOpen: true, mobileOpen: true }} onClose={onClose} id="outline" />);
  const dialog = screen.getByRole("dialog", { name: "Document outline" });
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close outline" }));
  expect(onClose).toHaveBeenCalled();
  view.rerender(<DocumentOutline editor={editor} visibility={{ desktopOpen: true, mobileOpen: false }} onClose={onClose} id="outline" />);
  expect(document.body.style.overflow).toBe("");
  expect(dialog).not.toHaveAttribute("open");
});

it("toolbar active states follow actual selections and formatting transactions", () => {
  render(<EditorToolbar editor={editor} />);
  act(() => { editor.commands.setTextSelection({ from: editor.state.doc.content.size - 13, to: editor.state.doc.content.size - 1 }); });
  const bold = screen.getByRole("button", { name: "Bold (Ctrl+B)" });
  expect(bold).toHaveAttribute("aria-pressed", "false");
  act(() => { editor.commands.toggleBold(); });
  expect(bold).toHaveAttribute("aria-pressed", "true");
  act(() => { editor.commands.toggleBold(); });
  expect(bold).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("group", { name: "Lists and blocks" })).toBeInTheDocument();
});
