"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import { Modal } from "@/components/ui/Modal";
import { createDocumentRecords, type RecordOutcome, type RecordPerson } from "@/lib/document-records";

type Panel = { kind: "closed" } | { kind: "history" } | { kind: "comments" }
  | { kind: "preview"; id: string; label: string }
  | { kind: "restore"; id: string; label: string }
  | { kind: "delete"; recordKind: "snapshot" | "comment"; id: string; label: string };
const noParticipants: RecordPerson[] = [];

export default function DocumentRecords({ editor, ydoc, canEdit, user, participants = noParticipants }: {
  editor: Editor | null; ydoc: Y.Doc; canEdit: boolean;
  user: { id: string; name: string; color?: string };
  participants?: RecordPerson[];
}) {
  const [panel, setPanel] = useState<Panel>({ kind: "closed" });
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<RecordPerson[]>([]);
  const [personId, setPersonId] = useState("");
  const [status, setStatus] = useState<RecordOutcome | null>(null);
  const [recordsRevision, setRecordsRevision] = useState(0);
  const [, setEditorRevision] = useState(0);
  const dialogId = useId();
  const records = useMemo(() => createDocumentRecords({
    editor, ydoc, canWrite: () => canEdit, user: { id: user.id, name: user.name }, participants,
  }), [editor, ydoc, canEdit, user.id, user.name, participants]);

  useEffect(() => records.subscribe(() => setRecordsRevision((value) => value + 1)), [records]);
  useEffect(() => {
    if (!editor) return;
    const changed = () => setEditorRevision((value) => value + 1);
    editor.on("transaction", changed);
    return () => { editor.off("transaction", changed); };
  }, [editor]);

  const view = useMemo(() => ({ ...records.read(), revision: recordsRevision }), [records, recordsRevision]);
  const { snapshots, comments } = view;
  const writable = canEdit && !!editor && !editor.isDestroyed && editor.isEditable;
  const close = useCallback(() => { setPanel({ kind: "closed" }); setStatus(null); }, []);
  const open = (kind: "history" | "comments") => { setPanel({ kind }); setStatus(null); };
  const report = (outcome: RecordOutcome) => { setStatus(outcome); return outcome.ok; };

  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs" data-records-revision={view.revision}>
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => open("history")}>History</button>
        <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => open("comments")}>Comments</button>
      </div>
      <p className="text-warning">Shared records · not private</p>
      <Modal open={panel.kind !== "closed"} onClose={close} labelledBy={dialogId} size="lg">
        <div className="p-5 space-y-4 text-sm">
          <h2 id={dialogId} className="font-semibold">{panel.kind === "comments" ? "Document comments" : panel.kind === "preview" ? `Preview: ${panel.label}` : panel.kind === "restore" ? "Restore shared text?" : panel.kind === "delete" ? `Remove shared ${panel.recordKind}?` : "Text history"}</h2>
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-warning">Snapshots and comments are not private: all document viewers, including future public link recipients, can access them. Publishing this document exposes saved previous text.</p>
          <p className="text-xs text-text-secondary">Author names and timestamps are shared editable metadata, not verified or tamper-proof attribution. Changes are applied locally and use normal document sync; this is not a database-save receipt.</p>
          {!writable && <p className="text-xs text-text-muted">Read only: editing is unavailable.</p>}
          {panel.kind === "history" && <>
            <p className="text-xs text-text-secondary">Only named snapshots and pre-restore safety snapshots are captured. No automatic copies of past text. Up to 20 named, 5 automatic (if present), and 5 pre-restore snapshots; 256 KiB each and 2 MiB retained text. Offline concurrency and Yjs metadata mean these are not hard stored-file size guarantees.</p>
            <form className="flex gap-2" onSubmit={(event) => {
              event.preventDefault();
              if (report(records.save(name))) setName("");
            }}>
              <label className="sr-only" htmlFor={`${dialogId}-name`}>Snapshot name</label>
              <input id={`${dialogId}-name`} className="input flex-1 min-w-0" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Name this shared text snapshot" disabled={!writable} />
              <button className="btn btn-secondary px-3" type="submit" disabled={!writable || !name.trim()}>Save snapshot</button>
            </form>
            <ul className="space-y-3">{snapshots.map((snapshot) => <li key={snapshot.id} className="border-t border-border-subtle pt-2 flex justify-between gap-2">
              <div className="min-w-0"><p className="font-medium break-words">{snapshot.label}</p><p className="text-xs text-text-muted break-words">{snapshot.kind} · {snapshot.author.name} · {new Date(snapshot.createdAt).toLocaleString()}</p></div>
              <div className="flex flex-wrap justify-end gap-1"><button type="button" className="btn btn-ghost px-2" onClick={() => { setStatus(null); setPanel({ kind: "preview", id: snapshot.id, label: snapshot.label }); }}>Preview</button><button type="button" className="btn btn-ghost px-2" disabled={!writable} onClick={() => { setStatus(null); setPanel({ kind: "restore", id: snapshot.id, label: snapshot.label }); }}>Restore</button><button type="button" className="btn btn-ghost px-2" aria-label={`Remove snapshot ${snapshot.label}`} disabled={!writable} onClick={() => { setStatus(null); setPanel({ kind: "delete", recordKind: "snapshot", id: snapshot.id, label: snapshot.label }); }}>Remove</button></div>
            </li>)}</ul>
            {!snapshots.length && <p className="text-text-muted">No text snapshots yet.</p>}
          </>}
          {panel.kind === "preview" && (() => {
            const preview = records.preview(panel.id);
            return <>
              {preview.ok ? <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs font-sans">{preview.text || "Empty document"}</pre> : <p role="alert" className="text-red-400 text-xs">{preview.error}</p>}
              <p className="text-xs text-text-muted">Plain-text preview. Restore preserves the saved text formatting.</p>
              <button type="button" className="btn btn-secondary px-3 py-2" onClick={() => setPanel({ kind: "history" })}>Back to history</button>
            </>;
          })()}
          {panel.kind === "restore" && <>
            <p>Replace the current shared text with “{panel.label}”? A shared safety snapshot of the text you currently see will be saved first.</p>
            <p className="text-xs text-text-secondary">This is a shared edit for everyone, not a private rollback. Whiteboard, comments, title and sharing are unaffected. Concurrent or offline edits can merge into restored text; the safety snapshot cannot include edits you have not received.</p>
            <p className="text-xs text-warning">The safety snapshot also exposes the current text to all current and future viewers, including public link recipients.</p>
            <div className="flex gap-2"><button type="button" className="btn btn-primary px-3 py-2" disabled={!writable} onClick={() => { if (report(records.restore(panel.id))) setPanel({ kind: "history" }); }}>Restore shared text</button><button type="button" className="btn btn-ghost px-3" onClick={() => setPanel({ kind: "history" })}>Cancel restore</button></div>
          </>}
          {panel.kind === "delete" && <>
            <p>Remove “{panel.label}” from the live shared {panel.recordKind === "snapshot" ? "history" : "comments"} for everyone?</p>
            <p className="text-xs text-warning">Removal does not reclaim old Yjs bytes or guarantee erasure. Previous updates, cached or offline copies, backups and copies already viewed may still contain this text. Removing live records before sharing is not a privacy or deletion guarantee.</p>
            <div className="flex gap-2"><button type="button" className="btn btn-danger px-3 py-2" disabled={!writable} onClick={() => {
              const outcome = panel.recordKind === "snapshot" ? records.deleteSnapshot(panel.id) : records.deleteComment(panel.id);
              if (report(outcome)) setPanel({ kind: panel.recordKind === "snapshot" ? "history" : "comments" });
            }}>Remove shared {panel.recordKind}</button><button type="button" className="btn btn-ghost px-3" onClick={() => setPanel({ kind: panel.recordKind === "snapshot" ? "history" : "comments" })}>Cancel removal</button></div>
          </>}
          {panel.kind === "comments" && <>
            <p className="text-xs text-text-secondary">Document-level comments, up to 200 retained; 4 KiB each and 20 mention references. Mentions are references only: no email notification, invitation, access grant or delivery guarantee.</p>
            <form className="space-y-2" onSubmit={(event) => {
              event.preventDefault();
              if (report(records.post(body, mentions))) { setBody(""); setMentions([]); }
            }}>
              <label htmlFor={`${dialogId}-body`}>Comment</label>
              <textarea id={`${dialogId}-body`} className="input w-full" rows={3} maxLength={4096} value={body} disabled={!writable} onChange={(event) => { const text = event.target.value; setBody(text); setMentions((current) => current.filter((person) => text.includes(`@${person.name}`))); }} />
              {participants.length > 0 && <div className="flex gap-2">
                <label className="sr-only" htmlFor={`${dialogId}-person`}>Mention a person</label>
                <select id={`${dialogId}-person`} className="input min-w-0" value={personId} disabled={!writable} onChange={(event) => setPersonId(event.target.value)}><option value="">Choose a person</option>{participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
                <button type="button" className="btn btn-ghost px-2" disabled={!writable || !personId || mentions.length >= 20} onClick={() => {
                  const person = participants.find((candidate) => candidate.id === personId);
                  if (person && !mentions.some((mention) => mention.id === person.id)) { setBody((text) => `${text}${text ? " " : ""}@${person.name}`); setMentions((current) => [...current, person]); }
                }}>Add mention</button>
              </div>}
              {mentions.length > 0 && <p className="text-xs text-text-secondary">References: {mentions.map((person) => `@${person.name}`).join(", ")}</p>}
              <button type="submit" className="btn btn-secondary px-3 py-2" disabled={!writable || !body.trim()}>Post comment</button>
            </form>
            <ul className="space-y-3">{comments.map((comment) => <li key={comment.id} className="border-t border-border-subtle pt-2">
              <p className="text-xs text-text-muted">{comment.author.name} · {new Date(comment.createdAt).toLocaleString()} · {comment.resolved ? "Resolved" : "Open"}</p>
              <p className="whitespace-pre-wrap break-words">{comment.body}</p>
              {comment.mentions.length > 0 && <p className="text-xs text-text-secondary">Mention references: {comment.mentions.map((person) => `@${person.name}`).join(", ")}</p>}
              <button type="button" className="btn btn-ghost text-xs px-2 py-1" disabled={!writable} onClick={() => report(records.resolve(comment.id, !comment.resolved))}>{comment.resolved ? "Reopen" : "Resolve"}</button>
              <button type="button" className="btn btn-ghost text-xs px-2 py-1" aria-label={`Remove comment by ${comment.author.name}`} disabled={!writable} onClick={() => { setStatus(null); setPanel({ kind: "delete", recordKind: "comment", id: comment.id, label: comment.body.slice(0, 80) }); }}>Remove</button>
            </li>)}</ul>
            {!comments.length && <p className="text-text-muted">No document comments yet.</p>}
          </>}
          {status && <p role={status.ok ? "status" : "alert"} className={status.ok ? "text-text-secondary text-xs" : "text-red-400 text-xs"}>{status.ok ? "Applied locally; document sync handles these changes." : status.error}</p>}
          <button type="button" className="btn btn-ghost text-xs" data-modal-close onClick={close}>Close</button>
        </div>
      </Modal>
    </div>
  );
}
