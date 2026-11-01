"use client";

import { useEffect, useId, useState } from "react";
import type { Editor } from "@tiptap/react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { documentMatches } from "@/lib/document-navigation";
import { EXPORT_FORMATS, exportDocument, type ExportFormat } from "@/lib/document-export";
import type { OutlineVisibility } from "./DocumentOutline";

export default function DocumentTools({ editor, title, outline }: {
  editor: Editor | null;
  title: string;
  outline?: { visibility: OutlineVisibility; onToggle: () => void; id: string };
}) {
  const [panel, setPanel] = useState<"find" | "export" | null>(null);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!editor || typeof editor.on !== "function") return;
    const update = () => setRevision((value) => value + 1);
    editor.on("update", update);
    return () => { editor.off("update", update); };
  }, [editor]);

  const doc = editor?.state?.doc;
  const matches = doc ? documentMatches(doc, query) : [];
  const selectedMatch = matches.length ? matchIndex % matches.length : 0;

  const jumpTo = (position: number, end = position) => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setTextSelection({ from: position, to: end });
    const dom = editor.view.domAtPos(position).node;
    const element = dom instanceof HTMLElement ? dom : dom.parentElement;
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const moveMatch = (direction: number) => {
    if (!matches.length) return;
    const next = (selectedMatch + direction + matches.length) % matches.length;
    setMatchIndex(next);
    jumpTo(matches[next].from, matches[next].to);
  };

  const download = async (format: ExportFormat) => {
    if (!editor || editor.isDestroyed || exporting) return;
    setError(null);
    setExporting(format);
    try {
      await exportDocument({ editor, title, format });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The download could not be created. Try another format.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {outline && <>
        <button type="button" title="Show or hide heading outline" className="btn btn-ghost hidden lg:inline-flex px-2 py-1.5" onClick={outline.onToggle} aria-expanded={outline.visibility.desktopOpen} aria-controls={outline.id}>Outline</button>
        <button type="button" title="Open heading outline" className="btn btn-ghost lg:hidden px-2 py-1.5" onClick={outline.onToggle} aria-expanded={outline.visibility.mobileOpen} aria-controls={`${outline.id}-mobile`}>Outline</button>
      </>}
      <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => setPanel(panel === "find" ? null : "find")} aria-expanded={panel === "find"}>Find</button>
      <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => { setError(null); setPanel("export"); }} disabled={!editor || editor.isDestroyed}>Export</button>
      <Link href="/help" className="btn btn-ghost px-2 py-1">Help &amp; shortcuts</Link>
      {panel === "find" && (
        <div className="basis-full border-t border-border-subtle pt-2" data-editor-revision={revision}>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`${dialogId}-find`}>Find in document</label>
              <input id={`${dialogId}-find`} type="search" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); } }} placeholder="Find in document…" className="input text-xs py-1 flex-1 min-w-32 max-w-sm" />
              <span role="status" className="text-text-muted">{matches.length ? `${selectedMatch + 1} of ${matches.length}${matches.length === 1000 ? "+" : ""}` : query ? "No matches" : "Enter search text"}</span>
              <button type="button" className="btn btn-ghost px-2 py-1" disabled={!matches.length} onClick={() => moveMatch(-1)} aria-label="Previous match">↑</button>
              <button type="button" className="btn btn-ghost px-2 py-1" disabled={!matches.length} onClick={() => moveMatch(1)} aria-label="Next match">↓</button>
              <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => { const match = matches[selectedMatch]; if (match) jumpTo(match.from, match.to); }} disabled={!matches.length}>Show match</button>
              <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => setPanel(null)} aria-label="Close document search">✕</button>
            </div>
        </div>
      )}
      <Modal open={panel === "export"} onClose={() => setPanel(null)} labelledBy={dialogId}>
        <div className="p-6 space-y-4 text-sm">
          <h2 id={dialogId} className="font-semibold">Export document</h2>
          <p className="text-xs text-text-secondary">Download the current text, including local edits. Comments, version snapshots, and whiteboard drawings are not included. Export your whiteboard separately from its toolbar.</p>
          <p className="text-xs text-text-muted">PDF opens your browser’s print dialog: choose Save as PDF. TXT is plain text; Markdown supports headings, lists, links, and text styles, with inline HTML for underline.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-busy={exporting !== null}>
            {EXPORT_FORMATS.map((format) => <button type="button" className="flex flex-col gap-1 rounded-xl border border-border-normal bg-surface-2 p-3 text-left transition-colors hover:border-brand-400 hover:bg-surface-3 disabled:opacity-50" disabled={exporting !== null} key={format.id} onClick={() => { void download(format.id); }}>
              <span className="font-semibold">{format.label}</span>
              <span className="text-xs text-text-secondary">{format.description}</span>
            </button>)}
          </div>
          {exporting && <p role="status" className="text-xs text-text-secondary">Preparing export…</p>}
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          <button type="button" className="btn btn-ghost text-xs" data-modal-close onClick={() => setPanel(null)}>Close</button>
        </div>
      </Modal>
    </div>
  );
}
