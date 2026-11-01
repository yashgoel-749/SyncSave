"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { documentHeadings } from "@/lib/document-navigation";

export type OutlineVisibility = { desktopOpen: boolean; mobileOpen: boolean };

export default function DocumentOutline({ editor, visibility, onClose, id }: {
  editor: Editor | null;
  visibility: OutlineVisibility;
  onClose: () => void;
  id: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [revision, setRevision] = useState(0);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed || typeof editor.on !== "function") return;
    const update = () => setRevision((value) => value + 1);
    editor.on("update", update);
    return () => { editor.off("update", update); };
  }, [editor]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !visibility.mobileOpen) return;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    const wideScreen = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (wideScreen.matches) onClose(); };
    wideScreen.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => {
      wideScreen.removeEventListener("change", closeOnDesktop);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [visibility.mobileOpen, onClose]);

  const headings = editor?.state?.doc ? documentHeadings(editor.state.doc) : [];
  const navigate = (position: number) => {
    if (!editor || editor.isDestroyed) return;
    const heading = documentHeadings(editor.state.doc).find((item) => item.position === position);
    if (!heading) return;
    setSelectedPosition(position);
    if (visibility.mobileOpen) onClose();
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const target = editor.view.nodeDOM(heading.position);
      if (!(target instanceof HTMLElement)) return;
      const headerBottom = document.querySelector("[data-editor-header]")?.getBoundingClientRect().bottom ?? 0;
      window.scrollTo({
        top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - headerBottom - 24),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    });
  };

  const list = (
    <nav aria-label="Document outline" className="space-y-1" data-editor-revision={revision}>
      {headings.length ? headings.map((heading) => (
        <button key={heading.position} type="button" title={heading.text}
          aria-current={selectedPosition === heading.position ? "location" : undefined}
          onClick={() => navigate(heading.position)}
          className={`flex w-full min-w-0 items-start gap-2 rounded-lg py-2 pr-3 text-left text-sm transition-colors ${selectedPosition === heading.position ? "bg-brand-500/10 text-action" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}
          style={{ paddingLeft: `${12 + (heading.level - 1) * 12}px` }}>
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-[10px] font-semibold text-text-muted">H{heading.level}</span>
          <span className="min-w-0 break-words">{heading.text}</span>
        </button>
      )) : <p className="px-3 py-2 text-sm leading-relaxed text-text-muted">Add headings (H1, H2, H3) to build your document outline.</p>}
    </nav>
  );

  return <>
    <aside id={id} aria-label="Outline sidebar" className={visibility.desktopOpen ? "hidden lg:block w-60 shrink-0 self-start sticky rounded-xl border border-border-subtle bg-surface-1 p-3" : "hidden"}
      style={{ top: "calc(var(--editor-header-height, 150px) + 24px)", maxHeight: "calc(100dvh - var(--editor-header-height, 150px) - 48px)" }}>
      <div className="mb-3 flex items-center justify-between px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">On this page</h2>
        <button type="button" onClick={onClose} title="Hide outline" aria-label="Hide outline" className="btn btn-ghost p-1.5 text-xs">✕</button>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: "calc(100dvh - var(--editor-header-height, 150px) - 88px)" }}>{list}</div>
    </aside>
    <dialog ref={dialogRef} id={`${id}-mobile`} aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-dvh w-80 max-w-[85vw] border-r border-border-subtle bg-surface-1 p-0 text-text-primary shadow-2xl backdrop:bg-black/40">
      <div className="flex h-full flex-col p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 id={`${id}-title`} className="text-base font-semibold">Document outline</h2>
          <button type="button" onClick={onClose} aria-label="Close outline" className="btn btn-ghost p-2">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
      </div>
    </dialog>
  </>;
}
