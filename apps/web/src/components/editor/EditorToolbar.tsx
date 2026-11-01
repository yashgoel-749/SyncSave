"use client";

import React, { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { sanitizeUrl } from "@/lib/editor-utils";
import { Modal } from "@/components/ui/Modal";
import VoiceDictation from "./VoiceDictation";

interface EditorToolbarProps {
  editor: Editor | null;
  readOnly?: boolean;
  documentId?: string;
  dictationEnabled?: boolean;
}

function ToolbarButton({
  active = false,
  disabled = false,
  title,
  onClick,
  children,
  className = "",
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault() /* keep editor selection */}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`h-9 min-w-9 px-2 rounded-lg inline-flex items-center justify-center text-sm transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${
        active
          ? "bg-brand-500/15 text-action shadow-[inset_0_0_0_1px_var(--border-normal)]"
          : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-6 bg-border-normal mx-1 hidden sm:block" aria-hidden="true" />;
}

export default function EditorToolbar({
  editor,
  readOnly = false,
  documentId,
  dictationEnabled = false,
}: EditorToolbarProps) {
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!editor || editor.isDestroyed || typeof editor.on !== "function") return;
    const update = () => setRevision((value) => value + 1);
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);

  if (!editor || readOnly || editor.isEditable === false) {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-surface-2 rounded-xl text-xs text-text-muted select-none">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-11a4 4 0 00-8 0v4h8V6z" />
          </svg>
          <span className="font-medium text-text-secondary">{readOnly ? "Read-only view" : !editor ? "Loading editor…" : "Preparing editor…"}</span>
          {readOnly && <span>— Editing is disabled for your permission level</span>}
        </div>
      </div>
    );
  }

  const handleOpenLinkModal = () => {
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setIsLinkModalOpen(true);
  };

  const handleApplyLink = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeUrl(linkUrl);
    if (!sanitized) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: sanitized })
        .run();
    }
    setIsLinkModalOpen(false);
  };

  const handleRemoveLink = () => {
    editor.chain().focus().unsetLink().run();
    setIsLinkModalOpen(false);
  };

  const isLinkActive = editor.isActive("link");

  return (
    <div role="toolbar" aria-label="Document formatting" data-toolbar-revision={revision}
      className="flex flex-wrap items-center gap-x-1 gap-y-1 p-1.5 border border-border-subtle bg-surface-1 rounded-xl text-xs shadow-sm"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLButtonElement) || event.target.closest('[role="dialog"]')) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter((button) => button.getBoundingClientRect().width > 0 && !button.closest('[role="dialog"]'));
        const current = buttons.indexOf(event.target);
        if (current < 0 || !buttons.length) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}>
      {/* History */}
      <div role="group" aria-label="Undo and redo" className="flex items-center gap-0.5">
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l6-6m-6 6l6 6" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Y)"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2m15-7l-6-6m6 6l-6 6" />
        </svg>
      </ToolbarButton>

      </div>
      <Divider />

      {/* Block type */}
      <div role="group" aria-label="Paragraph and headings" className="flex items-center gap-0.5">
      <ToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        active={editor.isActive("paragraph")}
        title="Paragraph"
        className="font-medium px-2"
      >
        Text
      </ToolbarButton>
      {([1, 2, 3] as const).map((level) => (
        <ToolbarButton
          key={level}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          active={editor.isActive("heading", { level })}
          title={`Heading ${level}`}
          className="font-semibold px-2"
        >
          H{level}
        </ToolbarButton>
      ))}

      </div>
      <Divider />

      {/* Inline marks */}
      <div role="group" aria-label="Text styles" className="flex items-center gap-0.5">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Ctrl+B)"
      >
        <span className="font-bold px-0.5">B</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Ctrl+I)"
      >
        <span className="italic font-serif px-0.5">I</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline (Ctrl+U)"
      >
        <span className="underline underline-offset-2 px-0.5">U</span>
      </ToolbarButton>
      </div>
      <button type="button" className="sm:hidden btn btn-ghost px-2 py-1 text-xs" aria-expanded={showMore} aria-label="More formatting options" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowMore((value) => !value)}>More {showMore ? "−" : "+"}</button>
      <div className={showMore ? "contents" : "hidden sm:contents"}>
      <div role="group" aria-label="Additional text styles" className="flex items-center gap-0.5">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough (Ctrl+Shift+S)"
      >
        <span className="line-through px-0.5">S</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline Code (Ctrl+E)"
        className="font-mono"
      >
        {"</>"}
      </ToolbarButton>

      </div>
      <Divider />

      {/* Blocks */}
      <div role="group" aria-label="Lists and blocks" className="flex items-center gap-0.5">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered List"
      >
        <span className="font-mono text-[11px] px-0.5">1.</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code Block"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal Rule"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeWidth={2} d="M4 12h16" />
        </svg>
      </ToolbarButton>

      </div>
      <Divider />

      {/* Link */}
      <div role="group" aria-label="Links" className="flex items-center gap-0.5">
      <ToolbarButton
        onClick={handleOpenLinkModal}
        active={isLinkActive}
        title={isLinkActive ? "Edit Link" : "Add Link"}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </ToolbarButton>
      {isLinkActive && (
        <ToolbarButton onClick={handleRemoveLink} title="Remove Link" className="text-text-muted hover:text-red-400">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </ToolbarButton>
      )}
      </div>
      </div>

      {documentId && dictationEnabled && <VoiceDictation key={documentId} editor={editor} documentId={documentId} />}

      <div className={`ml-auto items-center ${showMore ? "flex" : "hidden sm:flex"}`}>
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          title="Clear formatting"
          className="text-text-muted"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M9 4h10l-2 4M8 20h6M12 8l-4 12" />
          </svg>
        </ToolbarButton>
      </div>

      {/* Link Input Modal */}
      <Modal open={isLinkModalOpen} onClose={() => setIsLinkModalOpen(false)} labelledBy="link-dialog-title" size="sm">
        <form onSubmit={handleApplyLink} className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 id="link-dialog-title" className="text-sm font-semibold text-text-primary">
              {isLinkActive ? "Edit link" : "Insert link"}
            </h3>
            <button
              type="button"
              onClick={() => setIsLinkModalOpen(false)}
              data-modal-close
              className="text-text-muted hover:text-text-primary"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            autoFocus
            className="input"
            aria-label="Link URL"
          />
          <p className="text-[11px] text-text-muted">
            Only http(s), mailto and relative links are allowed. A missing scheme defaults to https://.
          </p>
          <div className="flex justify-end gap-2 text-xs">
            {isLinkActive && (
              <button
                type="button"
                onClick={handleRemoveLink}
                className="btn btn-ghost px-3 py-1.5 text-red-400 hover:text-red-300"
              >
                Unlink
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsLinkModalOpen(false)}
              className="btn btn-ghost px-3 py-1.5"
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary px-4 py-1.5">
              Apply
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
