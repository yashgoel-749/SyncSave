import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { createDocumentRecords } from "../document-records";
import { TextEncoder } from "node:util";

Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });

const user = { id: "author", name: "Alex" };
const editors: Editor[] = [];
const docs: Y.Doc[] = [];
function setup() {
  const ydoc = new Y.Doc();
  docs.push(ydoc);
  const editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: ydoc })] });
  editors.push(editor);
  editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original text" }] }] });
  let editable = true;
  const records = createDocumentRecords({ editor, ydoc, canWrite: () => editable, user, participants: [{ id: "person", name: "Pat" }] });
  return { editor, ydoc, records, revoke: () => { editable = false; } };
}

afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); docs.splice(0).forEach((doc) => doc.destroy()); jest.useRealTimers(); });

it("restores using collaborative text while keeping whiteboard, comments and an undo-safe pre-image", () => {
  const { records, editor, ydoc } = setup();
  ydoc.getMap("whiteboard").set("shape", { x: 20 });
  expect(records.post("Hello @Pat", [{ id: "person", name: "Pat" }])).toEqual({ ok: true });
  expect(records.save("First draft")).toEqual({ ok: true });
  const selected = records.read().snapshots[0];
  editor.commands.setContent("<p>New shared text</p>");
  const remoteDoc = new Y.Doc();
  docs.push(remoteDoc);
  Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(ydoc));
  const remoteEditor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: remoteDoc })] });
  editors.push(remoteEditor);
  const forward = (update: Uint8Array) => Y.applyUpdate(remoteDoc, update);
  ydoc.on("update", forward);
  expect(records.restore(selected.id)).toEqual({ ok: true });
  expect(editor.getText()).toBe("Original text");
  expect(remoteEditor.getText()).toBe("Original text");
  expect(remoteDoc.getMap("whiteboard").get("shape")).toEqual({ x: 20 });
  expect(records.read().comments[0].body).toBe("Hello @Pat");
  const safety = records.read().snapshots.find((snapshot) => snapshot.kind === "before-restore");
  expect(safety).toBeDefined();
  editor.commands.insertContent("Follow-up edit");
  editor.commands.undo();
  expect(editor.getText()).toBe("Original text");
  editor.commands.undo();
  expect(editor.getText()).toBe("New shared text");
  expect(records.read().snapshots.some((snapshot) => snapshot.id === safety?.id)).toBe(true);
  if (!safety) throw new Error("Safety snapshot missing");
  expect(records.restore(safety.id)).toEqual({ ok: true });
  expect(editor.getText()).toBe("New shared text");
  ydoc.off("update", forward);
});

it("viewers and revoked or noneditable editors cannot mutate any records", () => {
  const { records, editor, ydoc, revoke } = setup();
  records.save("Visible");
  records.post("Visible comment", []);
  const snapshot = records.read().snapshots[0];
  const comment = records.read().comments[0];
  revoke();
  const before = Y.encodeStateAsUpdate(ydoc);
  const unsubscribe = records.subscribe(() => {});
  expect(records.save("Forbidden").ok).toBe(false);
  expect(records.restore(snapshot.id).ok).toBe(false);
  expect(records.post("Forbidden", []).ok).toBe(false);
  expect(records.resolve(comment.id, true).ok).toBe(false);
  expect(records.deleteSnapshot(snapshot.id).ok).toBe(false);
  expect(records.deleteComment(comment.id).ok).toBe(false);
  expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
  unsubscribe();
  const disabled = createDocumentRecords({ editor, ydoc, user, canWrite: () => true });
  editor.setEditable(false);
  expect(disabled.save("Forbidden").ok).toBe(false);
});

it("ignores malformed Yjs values without viewer cleanup and validates target before any restore mutation", () => {
  const { records, editor, ydoc } = setup();
  const map = ydoc.getMap<unknown>("launch.versions.v1");
  map.set("bad", { content: "not json" });
  map.set("null", null);
  ydoc.getMap("launch.comments.v1").set("bad", { body: "<script>" });
  records.save("Good");
  const valid = [...map.values()].find((value) => typeof value === "object" && value !== null && "label" in value);
  if (!valid || typeof valid !== "object") throw new Error("Snapshot missing");
  map.set("invalid-schema", { ...valid, id: "invalid-schema", content: JSON.stringify({ type: "doc", content: [{ type: "unknown-node" }] }) });
  const viewer = createDocumentRecords({ editor, ydoc, user, canWrite: () => false });
  const before = Y.encodeStateAsUpdate(ydoc);
  const unsubscribe = viewer.subscribe(() => {});
  expect(viewer.read().comments).toEqual([]);
  expect(map.has("invalid-schema")).toBe(true);
  expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
  unsubscribe();
  expect(records.restore("invalid-schema").ok).toBe(false);
  expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
  expect(editor.getText()).toBe("Original text");
});

it("bounds named snapshots, safety snapshots, comments, UTF-8 bytes and structured mentions", () => {
  const { records, editor, ydoc } = setup();
  for (let index = 0; index < 25; index++) expect(records.save(`Draft ${index}`).ok).toBe(true);
  expect(records.read().snapshots).toHaveLength(20);
  expect(ydoc.getMap("launch.versions.v1").size).toBe(20);
  for (let index = 0; index < 8; index++) {
    const selected = records.read().snapshots.find((record) => record.kind === "named");
    if (!selected) throw new Error("Named snapshot missing");
    expect(records.restore(selected.id).ok).toBe(true);
  }
  expect(records.read().snapshots.filter((record) => record.kind === "before-restore")).toHaveLength(5);
  for (let index = 0; index < 205; index++) records.post(`Message ${index}`, []);
  expect(records.read().comments).toHaveLength(200);
  expect(ydoc.getMap("launch.comments.v1").size).toBe(200);
  expect(records.post("😀".repeat(1100), []).ok).toBe(false);
  expect(records.post("@Pat", Array.from({ length: 21 }, () => ({ id: "person", name: "Pat" }))).ok).toBe(false);
  expect(records.post("@Pat", [{ id: "stranger", name: "Pat" }]).ok).toBe(false);
  expect(records.post("@Pat", [{ id: "person", name: "Spoofed" }]).ok).toBe(false);
  expect(records.post("Plain @Pat", []).ok).toBe(true);
  editor.commands.setContent(`<p>${"x".repeat(256 * 1024)}</p>`);
  expect(records.save("Too big").ok).toBe(false);
  expect(records.restore(records.read().snapshots[0].id).ok).toBe(false);
});

it("limits live retained snapshot payload to 2 MiB and prunes automatic records deterministically", () => {
  const { records, editor, ydoc } = setup();
  editor.commands.setContent(`<p>${"x".repeat(240 * 1024)}</p>`);
  for (let index = 0; index < 12; index++) records.save(`Large ${index}`);
  expect(records.read().snapshots).toHaveLength(8);
  const map = ydoc.getMap<unknown>("launch.versions.v1");
  const record = [...map.values()][0];
  if (typeof record !== "object" || record === null) throw new Error("Snapshot missing");
  for (let index = 0; index < 8; index++) map.set(`auto-${index}`, { ...record, id: `auto-${index}`, kind: "automatic", content: '{"type":"doc","content":[{"type":"paragraph"}]}', createdAt: index });
  const unsubscribe = records.subscribe(() => {});
  const automatic = records.read().snapshots.filter((snapshot) => snapshot.kind === "automatic");
  expect(automatic.map((snapshot) => snapshot.id)).toEqual(["auto-7", "auto-6", "auto-5", "auto-4", "auto-3"]);
  unsubscribe();
});

it("resolves and reopens shared comments and preserves them across persistence updates", () => {
  const { records, ydoc } = setup();
  records.post("Hello @Pat", [{ id: "person", name: "Pat" }]);
  const id = records.read().comments[0].id;
  expect(records.resolve(id, true)).toEqual({ ok: true });
  expect(records.read().comments[0].resolved).toBe(true);
  records.resolve(id, false);
  const copy = new Y.Doc();
  docs.push(copy);
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
  const reader = createDocumentRecords({ editor: null, ydoc: copy, user, canWrite: () => false });
  expect(reader.read().comments[0]).toMatchObject({ resolved: false, mentions: [{ id: "person", name: "Pat" }] });
});

it("deletes live shared records without changing document text or whiteboard", () => {
  const { records, editor, ydoc } = setup();
  records.save("Remove me");
  records.post("Remove me", []);
  ydoc.getMap("whiteboard").set("shape", { x: 10 });
  expect(records.deleteSnapshot(records.read().snapshots[0].id)).toEqual({ ok: true });
  expect(records.deleteComment(records.read().comments[0].id)).toEqual({ ok: true });
  expect(records.read()).toEqual({ snapshots: [], comments: [] });
  expect(editor.getText()).toBe("Original text");
  expect(ydoc.getMap("whiteboard").get("shape")).toEqual({ x: 10 });
  const copy = new Y.Doc();
  docs.push(copy);
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
  expect(createDocumentRecords({ editor: null, ydoc: copy, user, canWrite: () => false }).read()).toEqual({ snapshots: [], comments: [] });
});

it("keeps the current safety snapshot before dispatch even when older records have future timestamps", () => {
  const { records, editor, ydoc } = setup();
  records.save("Target");
  const selected = records.read().snapshots[0];
  const map = ydoc.getMap<unknown>("launch.versions.v1");
  const original = map.get(selected.id);
  if (typeof original !== "object" || original === null) throw new Error("Snapshot missing");
  for (let index = 0; index < 5; index++) map.set(`future-${index}`, { ...original, id: `future-${index}`, kind: "before-restore", createdAt: Date.now() + 100000 + index });
  const unsubscribe = records.subscribe(() => {});
  editor.commands.setContent("<p>Safety text</p>");
  const safetyAlreadyStored: boolean[] = [];
  const onUpdate = () => {
    safetyAlreadyStored.push([...map.values()].some((value) => typeof value === "object" && value !== null && "label" in value && value.label === "Before restore"));
  };
  editor.on("update", onUpdate);
  expect(records.restore(selected.id)).toEqual({ ok: true });
  expect(safetyAlreadyStored).toEqual([true]);
  expect(records.read().snapshots.filter((snapshot) => snapshot.kind === "before-restore")).toHaveLength(5);
  editor.off("update", onUpdate);
  unsubscribe();
});

it("converges after two offline restores while retaining each observed pre-image", () => {
  const { records, editor, ydoc } = setup();
  records.save("Original");
  records.post("Shared conversation", []);
  ydoc.getMap("whiteboard").set("shape", { x: 42 });
  const selected = records.read().snapshots[0];
  const offlineDoc = new Y.Doc();
  docs.push(offlineDoc);
  Y.applyUpdate(offlineDoc, Y.encodeStateAsUpdate(ydoc));
  const offlineEditor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: offlineDoc })] });
  editors.push(offlineEditor);
  const offlineRecords = createDocumentRecords({ editor: offlineEditor, ydoc: offlineDoc, user: { id: "other", name: "Other" }, canWrite: () => true });
  editor.commands.setContent("<p>Local observed text</p>");
  offlineEditor.commands.setContent("<p>Offline observed text</p>");
  expect(records.restore(selected.id)).toEqual({ ok: true });
  expect(offlineRecords.restore(selected.id)).toEqual({ ok: true });
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(offlineDoc));
  Y.applyUpdate(offlineDoc, Y.encodeStateAsUpdate(ydoc));
  expect(editor.getJSON()).toEqual(offlineEditor.getJSON());
  expect(records.read()).toEqual(offlineRecords.read());
  expect(records.read().snapshots.filter((snapshot) => snapshot.kind === "before-restore")).toHaveLength(2);
  expect(records.read().comments[0].body).toBe("Shared conversation");
  expect(offlineDoc.getMap("whiteboard").get("shape")).toEqual({ x: 42 });
});
