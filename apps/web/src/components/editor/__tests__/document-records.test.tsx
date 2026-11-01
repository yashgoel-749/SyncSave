import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import DocumentRecords from "../DocumentRecords";
import { TextEncoder } from "node:util";

Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });

let editor: Editor;
let ydoc: Y.Doc;
const user = { id: "alex", name: "Alex" };
beforeEach(() => {
  ydoc = new Y.Doc();
  editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: ydoc })] });
  editor.commands.setContent("<p>First text</p>");
});
afterEach(() => { cleanup(); editor.destroy(); ydoc.destroy(); });

it("warns all viewers without opening a panel and never captures automatically", () => {
  render(<DocumentRecords editor={editor} ydoc={ydoc} canEdit={false} user={user} />);
  expect(screen.getByText(/Shared records · not private/)).toBeInTheDocument();
  expect(ydoc.getMap("launch.versions.v1").size).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(screen.getByText(/future public link recipients/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save snapshot" })).toBeDisabled();
  expect(screen.getByText(/No automatic copies/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Comments" }));
  expect(screen.getByRole("button", { name: "Post comment" })).toBeDisabled();
});

it("lets a viewer preview saved text without restoring or changing the document", () => {
  const view = render(<DocumentRecords editor={editor} ydoc={ydoc} canEdit user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.change(screen.getByLabelText("Snapshot name"), { target: { value: "First draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
  act(() => { editor.commands.setContent("<p>Changed text</p>"); });
  view.rerender(<DocumentRecords editor={editor} ydoc={ydoc} canEdit={false} user={user} />);
  const before = Y.encodeStateAsUpdate(ydoc);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByText("First text")).toBeInTheDocument();
  expect(editor.getText()).toBe("Changed text");
  expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
});

it("requires explicit shared restore confirmation, with revocation checked at confirmation", () => {
  const view = render(<DocumentRecords editor={editor} ydoc={ydoc} canEdit user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.change(screen.getByLabelText("Snapshot name"), { target: { value: "First draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
  act(() => { editor.commands.setContent("<p>Second text</p>"); });
  fireEvent.click(screen.getByRole("button", { name: "Restore", exact: true }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByText(/Whiteboard, comments, title and sharing are unaffected/)).toBeInTheDocument();
  expect(editor.getText()).toBe("Second text");
  view.rerender(<DocumentRecords editor={editor} ydoc={ydoc} canEdit={false} user={user} />);
  expect(screen.getByRole("button", { name: "Restore shared text" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Restore shared text" }));
  expect(editor.getText()).toBe("Second text");
  view.rerender(<DocumentRecords editor={editor} ydoc={ydoc} canEdit user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore shared text" }));
  expect(editor.getText()).toBe("First text");
  expect(screen.getByText("Before restore")).toBeInTheDocument();
});

it("selects names-only structured mentions, posts plain text, resolves and reopens", () => {
  render(<DocumentRecords editor={editor} ydoc={ydoc} canEdit user={user} participants={[{ id: "pat", name: "Pat" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Comments" }));
  expect(screen.getByText(/no email notification/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "<b>Hello</b>" } });
  fireEvent.change(screen.getByLabelText("Mention a person"), { target: { value: "pat" } });
  fireEvent.click(screen.getByRole("button", { name: "Add mention" }));
  fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
  expect(screen.getByText("<b>Hello</b> @Pat")).toBeInTheDocument();
  expect([...ydoc.getMap("launch.comments.v1").values()][0]).toMatchObject({ mentions: [{ id: "pat", name: "Pat" }] });
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove comment by Alex" }));
  expect(ydoc.getMap("launch.comments.v1").size).toBe(1);
  expect(screen.getByText(/does not reclaim old Yjs bytes or guarantee erasure/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove shared comment" }));
  expect(screen.getByText("No document comments yet.")).toBeInTheDocument();
});

it("confirms snapshot removal and blocks removal after permission revocation", () => {
  const view = render(<DocumentRecords editor={editor} ydoc={ydoc} canEdit user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.change(screen.getByLabelText("Snapshot name"), { target: { value: "Private old text" } });
  fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove snapshot Private old text" }));
  expect(ydoc.getMap("launch.versions.v1").size).toBe(1);
  expect(screen.getByText(/not a privacy or deletion guarantee/)).toBeInTheDocument();
  view.rerender(<DocumentRecords editor={editor} ydoc={ydoc} canEdit={false} user={user} />);
  expect(screen.getByRole("button", { name: "Remove shared snapshot" })).toBeDisabled();
  view.rerender(<DocumentRecords editor={editor} ydoc={ydoc} canEdit user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove shared snapshot" }));
  expect(screen.getByText("No text snapshots yet.")).toBeInTheDocument();
  expect(editor.getText()).toBe("First text");
});
