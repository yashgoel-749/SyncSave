import type { Editor } from "@tiptap/react";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { z } from "zod";
import { parseImportedDocument } from "./document-files";

const personSchema = z.object({ id: z.string().min(1).max(200), name: z.string().trim().min(1).max(200) });
const baseSchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(200),
  author: personSchema, createdAt: z.number().finite().nonnegative(),
});
const snapshotSchema = baseSchema.extend({
  kind: z.enum(["named", "automatic", "before-restore"]),
  label: z.string().trim().min(1).max(100), content: z.string().max(256 * 1024),
});
const commentSchema = baseSchema.extend({
  body: z.string().trim().min(1).max(4096),
  mentions: z.array(personSchema).max(20), resolved: z.boolean(),
});
const undoStateSchema = z.object({ undoManager: z.instanceof(Y.UndoManager) });
type Snapshot = z.infer<typeof snapshotSchema>;
export type RecordPerson = z.infer<typeof personSchema>;
export type DocumentComment = z.infer<typeof commentSchema>;
export type TextSnapshot = Omit<Snapshot, "content" | "version">;
export type RecordOutcome = { ok: true } | { ok: false; error: string };

const SNAPSHOT_BYTES = 256 * 1024;
const RETAINED_BYTES = 2 * 1024 * 1024;
const counts = { named: 20, automatic: 5, "before-restore": 5 };
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const newest = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const refused = (error: string): RecordOutcome => ({ ok: false, error });
const newRecordId = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID()
  : [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function parseSnapshots(map: Y.Map<unknown>): Snapshot[] {
  const records: Snapshot[] = [];
  map.forEach((value, key) => {
    const parsed = snapshotSchema.safeParse(value);
    if (parsed.success && parsed.data.id === key && byteLength(parsed.data.content) <= SNAPSHOT_BYTES) {
      try {
        const content: unknown = JSON.parse(parsed.data.content);
        if (z.object({ type: z.literal("doc") }).safeParse(content).success) records.push(parsed.data);
      } catch { /* Ignore malformed shared metadata. */ }
    }
  });
  return records.sort(newest);
}

function retainedSnapshots(records: Snapshot[], reserve?: string): Snapshot[] {
  const used = { named: 0, automatic: 0, "before-restore": 0 };
  let bytes = 0;
  const reserved = records.find((record) => record.id === reserve);
  const ordered = reserved ? [reserved, ...records.filter((record) => record.id !== reserve)] : records;
  return ordered.filter((record) => {
    const size = byteLength(record.content);
    if (used[record.kind] >= counts[record.kind] || bytes + size > RETAINED_BYTES) return false;
    used[record.kind]++;
    bytes += size;
    return true;
  }).sort(newest);
}

function parseComments(map: Y.Map<unknown>): DocumentComment[] {
  const records: DocumentComment[] = [];
  map.forEach((value, key) => {
    const parsed = commentSchema.safeParse(value);
    if (parsed.success && parsed.data.id === key && byteLength(parsed.data.body) <= 4096) records.push(parsed.data);
  });
  return records.sort(newest).slice(0, 200);
}

function validatedContent(editor: Editor, serialized: string) {
  if (byteLength(serialized) > SNAPSHOT_BYTES) throw new Error("Text exceeds the 256 KiB snapshot limit.");
  const input = parseImportedDocument(serialized);
  const node = editor.schema.nodeFromJSON(input);
  if (node.type !== editor.schema.topNodeType) throw new Error("Expected a document.");
  node.check();
  const canonical = node.toJSON();
  if (byteLength(JSON.stringify(canonical)) > SNAPSHOT_BYTES) throw new Error("Text exceeds the snapshot limit.");
  return canonical;
}

/** Auxiliary maps use the existing full-Y.Doc persistence; no separate text write path. */
export function createDocumentRecords({ ydoc, editor, canWrite, user, participants = [] }: {
  ydoc: Y.Doc;
  editor: Editor | null;
  canWrite: () => boolean;
  user: RecordPerson;
  participants?: RecordPerson[];
}) {
  const snapshots = ydoc.getMap<unknown>("launch.versions.v1");
  const comments = ydoc.getMap<unknown>("launch.comments.v1");
  let reservedSnapshot: string | undefined;
  const writable = () => canWrite() && !!editor && !editor.isDestroyed && editor.isEditable;
  const author = () => personSchema.parse(user);

  function prune(reserve = reservedSnapshot) {
    if (!writable()) return;
    const snapshotIds = new Set(retainedSnapshots(parseSnapshots(snapshots), reserve).map((record) => record.id));
    const commentIds = new Set(parseComments(comments).map((record) => record.id));
    const removeSnapshots = [...snapshots.keys()].filter((id) => !snapshotIds.has(id));
    const removeComments = [...comments.keys()].filter((id) => !commentIds.has(id));
    if (!removeSnapshots.length && !removeComments.length) return;
    ydoc.transact(() => {
      removeSnapshots.forEach((id) => snapshots.delete(id));
      removeComments.forEach((id) => comments.delete(id));
    }, "document-records");
  }

  function capture(label: string, kind: Snapshot["kind"]): Snapshot {
    if (!editor) throw new Error("Editor is not ready.");
    const content = JSON.stringify(validatedContent(editor, JSON.stringify(editor.getJSON())));
    return snapshotSchema.parse({ version: 1, id: newRecordId(), author: author(), createdAt: Date.now(), kind, label, content });
  }

  return {
    read(): { snapshots: TextSnapshot[]; comments: DocumentComment[] } {
      return {
        snapshots: retainedSnapshots(parseSnapshots(snapshots)).map(({ id, author, createdAt, kind, label }) => ({ id, author, createdAt, kind, label })),
        comments: parseComments(comments),
      };
    },
    subscribe(listener: () => void) {
      const changed = () => { prune(); listener(); };
      snapshots.observe(changed);
      comments.observe(changed);
      prune();
      return () => { snapshots.unobserve(changed); comments.unobserve(changed); };
    },
    preview(id: string): { ok: true; text: string } | { ok: false; error: string } {
      const selected = retainedSnapshots(parseSnapshots(snapshots)).find((record) => record.id === id);
      if (!selected || !editor || editor.isDestroyed) return { ok: false, error: "This snapshot is unavailable." };
      try {
        const node = editor.schema.nodeFromJSON(validatedContent(editor, selected.content));
        return { ok: true, text: node.textBetween(0, node.content.size, "\n\n", "\n") };
      } catch { return { ok: false, error: "This snapshot cannot be previewed: invalid or oversized text." }; }
    },
    save(label: string): RecordOutcome {
      if (!writable()) return refused("Editing is unavailable. Nothing was saved.");
      if (!label.trim() || label.trim().length > 100) return refused("Use a snapshot name of 1–100 characters.");
      try {
        const record = capture(label.trim(), "named");
        reservedSnapshot = record.id;
        try {
          ydoc.transact(() => { snapshots.set(record.id, record); prune(); }, "document-records");
        } finally { reservedSnapshot = undefined; }
        return { ok: true };
      } catch { return refused("Snapshot could not be captured. Text must be valid and at most 256 KiB."); }
    },
    restore(id: string): RecordOutcome {
      if (!writable() || !editor) return refused("Editing is unavailable. Nothing was restored.");
      const selected = retainedSnapshots(parseSnapshots(snapshots)).find((record) => record.id === id);
      if (!selected) return refused("This snapshot is unavailable.");
      try {
        // Validate the full target before capturing or mutating either text or metadata.
        const content = validatedContent(editor, selected.content);
        const safety = capture("Before restore", "before-restore");
        if (!writable()) return refused("Editing is unavailable. Nothing was restored.");
        reservedSnapshot = safety.id;
        try {
          ydoc.transact(() => { snapshots.set(safety.id, safety); prune(); }, "document-records");
        } finally { reservedSnapshot = undefined; }
        // Do not wrap TipTap dispatch in a metadata-origin transaction: keep normal
        // collaborative text undo tracking separate from the safety record.
        const undoState: unknown = yUndoPluginKey.getState(editor.state);
        const parsedUndoState = undoStateSchema.safeParse(undoState);
        const undoManager = parsedUndoState.success ? parsedUndoState.data.undoManager : undefined;
        undoManager?.stopCapturing();
        try {
          if (!editor.chain().setContent(content, { errorOnInvalidContent: true }).run()) {
            return refused("Restore failed. The safety snapshot was kept.");
          }
        } finally { undoManager?.stopCapturing(); }
        return { ok: true };
      } catch { return refused("Restore refused: invalid or oversized text. Any captured safety snapshot was kept."); }
    },
    post(body: string, mentions: RecordPerson[]): RecordOutcome {
      if (!writable()) return refused("Editing is unavailable. Comment was not posted.");
      const allowed = new Map(participants.map((person) => [person.id, person.name]));
      if (mentions.some((person) => allowed.get(person.id) !== person.name || !body.includes(`@${person.name}`))) {
        return refused("Choose mention references from the available people.");
      }
      const parsed = commentSchema.safeParse({ version: 1, id: newRecordId(), author: user, createdAt: Date.now(), body, mentions, resolved: false });
      if (!parsed.success || byteLength(parsed.data.body) > 4096) return refused("Use a comment up to 4 KiB with at most 20 mention references.");
      ydoc.transact(() => { comments.set(parsed.data.id, parsed.data); prune(); }, "document-records");
      return { ok: true };
    },
    resolve(id: string, resolved: boolean): RecordOutcome {
      if (!writable()) return refused("Editing is unavailable. Comment was not changed.");
      const record = parseComments(comments).find((comment) => comment.id === id);
      if (!record) return refused("Comment is unavailable.");
      comments.set(id, { ...record, resolved });
      return { ok: true };
    },
    deleteSnapshot(id: string): RecordOutcome {
      if (!writable()) return refused("Editing is unavailable. Snapshot was not removed.");
      if (!snapshots.has(id)) return refused("Snapshot is unavailable.");
      ydoc.transact(() => snapshots.delete(id), "document-records");
      return { ok: true };
    },
    deleteComment(id: string): RecordOutcome {
      if (!writable()) return refused("Editing is unavailable. Comment was not removed.");
      if (!comments.has(id)) return refused("Comment is unavailable.");
      ydoc.transact(() => comments.delete(id), "document-records");
      return { ok: true };
    },
  };
}
