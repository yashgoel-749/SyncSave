"use client";

import React, { useState } from "react";
import type { Editor } from "@tiptap/react";
import { sanitizeUrl } from "@/lib/editor-utils";

interface EditorToolbarProps {
  editor: Editor | null;
  readOnly?: boolean;
}

export default function EditorToolbar({
  editor,
  readOnly = false,
}: EditorToolbarProps) {
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  if (!editor || readOnly) {
    return (
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface-1/50 rounded-t-xl text-xs text-text-muted select-none">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-11a4 4 0 00-8 0v4h8V6z" />
          </svg>
          <span className="font-medium text-text-secondary">Read-only view</span>
          <span>— Editing is disabled for your permission level</span>
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

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border-subtle bg-surface-1 shadow-sm rounded-t-xl text-xs">
      {/* History Group */}
      <div className="flex items-center gap-0.5 pr-1.5 border-r border-border-subtle">
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-1.5 rounded hover:bg-surface-3 text-text-secondary disabled:opacity-30 disabled:hover:bg-transparent"
          title="Undo (Ctrl+Z)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l6-6m-6 6l6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-1.5 rounded hover:bg-surface-3 text-text-secondary disabled:opacity-30 disabled:hover:bg-transparent"
          title="Redo (Ctrl+Y)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2m15-7l-6-6m6 6l-6 6" />
          </svg>
        </button>
      </div>

      {/* Headings / Block Type Selector */}
      <div className="flex items-center gap-0.5 px-1.5 border-r border-border-subtle">
        <button
          type="button"
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={`px-2 py-1 rounded font-medium transition-colors ${
            editor.isActive("paragraph")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Paragraph"
        >
          Text
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`px-2 py-1 rounded font-semibold transition-colors ${
            editor.isActive("heading", { level: 1 })
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Heading 1"
        >
          H1
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-2 py-1 rounded font-semibold transition-colors ${
            editor.isActive("heading", { level: 2 })
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Heading 2"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`px-2 py-1 rounded font-semibold transition-colors ${
            editor.isActive("heading", { level: 3 })
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Heading 3"
        >
          H3
        </button>
      </div>

      {/* Inline Formatting */}
      <div className="flex items-center gap-0.5 px-1.5 border-r border-border-subtle">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("bold")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30 font-bold"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Bold (Ctrl+B)"
        >
          <span className="font-bold text-xs px-0.5">B</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("italic")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30 italic"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Italic (Ctrl+I)"
        >
          <span className="italic text-xs px-0.5">I</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("underline")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30 underline"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Underline (Ctrl+U)"
        >
          <span className="underline underline-offset-2 text-xs px-0.5">U</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("strike")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30 line-through"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Strikethrough"
        >
          <span className="line-through text-xs px-0.5">S</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={`p-1.5 rounded font-mono transition-colors ${
            editor.isActive("code")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Inline Code"
        >
          {"</>"}
        </button>
      </div>

      {/* Lists & Blockquote */}
      <div className="flex items-center gap-0.5 px-1.5 border-r border-border-subtle">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("bulletList")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Bullet List"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("orderedList")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Numbered List"
        >
          <span className="font-mono text-[11px] px-0.5">1.</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("blockquote")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Blockquote"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("codeBlock")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title="Code Block"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </button>
      </div>

      {/* Link Group */}
      <div className="flex items-center gap-0.5 pl-1.5">
        <button
          type="button"
          onClick={handleOpenLinkModal}
          className={`p-1.5 rounded transition-colors ${
            editor.isActive("link")
              ? "bg-brand-500/20 text-brand-300 border border-brand-500/30"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
          title={editor.isActive("link") ? "Edit Link" : "Add Link (Ctrl+K)"}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>
        {editor.isActive("link") && (
          <button
            type="button"
            onClick={handleRemoveLink}
            className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-surface-3"
            title="Remove Link"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Link Input Modal */}
      {isLinkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <form
            onSubmit={handleApplyLink}
            className="card p-5 w-full max-w-sm border border-border-subtle bg-surface-2 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Insert Link</h3>
              <button
                type="button"
                onClick={() => setIsLinkModalOpen(false)}
                className="text-text-muted hover:text-text-primary"
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
              className="w-full bg-surface-1 border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand-primary"
            />
            <div className="flex justify-end gap-2 text-xs">
              {editor.isActive("link") && (
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
        </div>
      )}
    </div>
  );
}
