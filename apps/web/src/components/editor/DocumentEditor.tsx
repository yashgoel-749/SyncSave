"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import EditorToolbar from "./EditorToolbar";
import { parseDocumentContent } from "@/lib/editor-utils";
import { relativeTime } from "@/lib/utils";

export type SaveStatus = "saved" | "pending" | "saving" | "failed";

export interface DocumentEditorProps {
  document: {
    id: string;
    title: string;
    content: string | null;
    isArchived: boolean;
    updatedAt: string;
    owner?: { id: string; name: string | null; email: string };
    workspace?: { id: string; name: string } | null;
    userRole: string;
  };
  userId: string;
}

export default function DocumentEditor({
  document: initialDoc,
}: DocumentEditorProps) {
  const router = useRouter();

  // Document state
  const [title, setTitle] = useState(initialDoc.title || "Untitled Document");
  const [isArchived, setIsArchived] = useState(initialDoc.isArchived);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSavedTime, setLastSavedTime] = useState<Date>(
    new Date(initialDoc.updatedAt)
  );

  // Stale request & concurrency protection
  const lastKnownUpdatedAtRef = useRef<string>(initialDoc.updatedAt);
  const saveSeqRef = useRef<number>(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const titleRef = useRef(title);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  // Permissions
  const canEdit =
    initialDoc.userRole === "OWNER" ||
    initialDoc.userRole === "EDITOR" ||
    initialDoc.userRole === "ADMIN";

  // TipTap Editor instance
  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
        validate: (url) =>
          /^https?:\/\//i.test(url) ||
          url.startsWith("/") ||
          url.startsWith("mailto:"),
      }),
    ],
    content: parseDocumentContent(initialDoc.content),
    onUpdate: () => {
      if (canEdit) {
        triggerAutosave();
      }
    },
  });

  // Keep editor editable state in sync if permission changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(canEdit);
    }
  }, [editor, canEdit]);

  // Actual Save function
  const performSave = useCallback(
    async (manualTitle?: string) => {
      if (!canEdit || !editor) return;

      const currentSeq = ++saveSeqRef.current;
      setSaveStatus("saving");
      setErrorMessage(null);

      const titleToSave = (manualTitle !== undefined ? manualTitle : titleRef.current).trim() || "Untitled Document";
      const contentJson = JSON.stringify(editor.getJSON());

      try {
        const res = await fetch(`/api/documents/${initialDoc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleToSave,
            content: contentJson,
            clientUpdatedAt: lastKnownUpdatedAtRef.current,
          }),
        });

        // If a newer save was initiated while this request was in flight, discard this older response
        if (currentSeq < saveSeqRef.current) {
          return;
        }

        if (res.status === 409) {
          const errData = await res.json().catch(() => ({}));
          setSaveStatus("failed");
          setErrorMessage(
            errData.error ||
              "Document was updated in another session. Please reload to avoid overwriting changes."
          );
          return;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Save failed (${res.status})`);
        }

        const data = await res.json();
        if (data.document?.updatedAt) {
          lastKnownUpdatedAtRef.current = data.document.updatedAt;
        }

        setSaveStatus("saved");
        setLastSavedTime(new Date());
      } catch (err: unknown) {
        if (currentSeq < saveSeqRef.current) return;
        const msg = err instanceof Error ? err.message : "Failed to save document";
        setSaveStatus("failed");
        setErrorMessage(msg);
      }
    },
    [canEdit, editor, initialDoc.id]
  );

  // Debounced Autosave Trigger
  const triggerAutosave = useCallback(() => {
    if (!canEdit) return;
    setSaveStatus("pending");
    setErrorMessage(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, 1200);
  }, [canEdit, performSave]);

  // Manual Retry Save
  const handleRetrySave = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    performSave();
  };

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit && (saveStatus === "pending" || saveStatus === "failed")) {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          performSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, saveStatus, performSave]);

  // Prevent leaving window/tab with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === "pending" || saveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  // In-app navigation guard for breadcrumb links
  const handleBreadcrumbClick = (e: React.MouseEvent) => {
    if (saveStatus === "pending" || saveStatus === "saving") {
      const confirmLeave = window.confirm(
        "You have unsaved changes. Are you sure you want to leave?"
      );
      if (!confirmLeave) {
        e.preventDefault();
      }
    }
  };

  // Title change handler
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const newTitle = e.target.value;
    setTitle(newTitle);
    triggerAutosave();
  };

  const handleToggleArchive = async () => {
    if (!canEdit) return;
    const nextState = !isArchived;
    setIsArchived(nextState);
    try {
      await fetch(`/api/documents/${initialDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: nextState }),
      });
      router.refresh();
    } catch {
      setIsArchived(!nextState);
    }
  };

  const handleTrash = async () => {
    if (!canEdit) return;
    if (!window.confirm("Move this document to trash?")) return;
    const res = await fetch(`/api/documents/${initialDoc.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-dvh flex flex-col bg-surface-0 text-text-primary">
      {/* Top Header / Breadcrumbs & Status Bar */}
      <header className="border-b border-border-subtle bg-surface-1/80 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Breadcrumbs & Title Input */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Link
              href="/dashboard"
              onClick={handleBreadcrumbClick}
              className="btn btn-ghost text-xs p-1.5 text-text-muted hover:text-text-primary flex-shrink-0"
              title="Back to Dashboard"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>

            {/* Breadcrumb Workspace */}
            <div className="flex items-center gap-1.5 text-xs text-text-muted flex-shrink-0">
              <Link
                href="/dashboard"
                onClick={handleBreadcrumbClick}
                className="hover:text-text-secondary transition-colors"
              >
                Dashboard
              </Link>
              {initialDoc.workspace && (
                <>
                  <span className="text-border-normal">/</span>
                  <Link
                    href={`/dashboard?workspaceId=${initialDoc.workspace.id}`}
                    onClick={handleBreadcrumbClick}
                    className="hover:text-text-secondary truncate max-w-[120px] transition-colors"
                  >
                    {initialDoc.workspace.name}
                  </Link>
                </>
              )}
              <span className="text-border-normal">/</span>
            </div>

            {/* Editable Title */}
            <div className="flex-1 min-w-[140px] max-w-md">
              <input
                type="text"
                value={title}
                onChange={handleTitleChange}
                disabled={!canEdit}
                maxLength={100}
                placeholder="Untitled Document"
                className={`w-full bg-transparent px-2 py-1 rounded text-sm font-semibold tracking-tight text-text-primary border border-transparent transition-all truncate ${
                  canEdit
                    ? "hover:border-border-subtle focus:border-brand-500 focus:bg-surface-2 focus:outline-none"
                    : "cursor-default"
                }`}
                title={canEdit ? "Click to rename document" : "Document title"}
              />
            </div>
          </div>

          {/* Right Header: Role & Save Status Indicator */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Save Status Badge */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                saveStatus === "saved"
                  ? "bg-accent-500/10 text-accent-400 border-accent-500/20"
                  : saveStatus === "saving"
                  ? "bg-brand-500/10 text-brand-300 border-brand-500/20"
                  : saveStatus === "pending"
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}
              title={
                saveStatus === "saved"
                  ? `Saved at ${lastSavedTime.toLocaleTimeString()}`
                  : saveStatus === "failed"
                  ? errorMessage || "Save failed"
                  : undefined
              }
            >
              {saveStatus === "saved" && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-400" />
                  <span className="hidden sm:inline">Saved</span>
                </>
              )}

              {saveStatus === "saving" && (
                <>
                  <svg className="animate-spin w-3 h-3 text-brand-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="hidden sm:inline">Saving...</span>
                </>
              )}

              {saveStatus === "pending" && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="hidden sm:inline">Unsaved changes</span>
                </>
              )}

              {saveStatus === "failed" && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <span>Failed</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={handleRetrySave}
                      className="ml-1 underline font-semibold hover:text-red-300"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Role Badge */}
            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wider bg-brand-500/10 text-brand-300 border border-brand-500/20">
              {initialDoc.userRole}
            </span>

            {/* Quick Actions (Archive, Trash) */}
            {canEdit && (
              <div className="flex items-center gap-1 border-l border-border-subtle pl-2">
                <button
                  type="button"
                  onClick={handleToggleArchive}
                  className={`btn btn-ghost text-xs px-2 py-1 ${
                    isArchived
                      ? "text-brand-300 font-semibold"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                  title={isArchived ? "Unarchive Document" : "Archive Document"}
                >
                  {isArchived ? "Archived" : "Archive"}
                </button>
                <button
                  type="button"
                  onClick={handleTrash}
                  className="btn btn-ghost text-xs p-1.5 text-text-muted hover:text-red-400"
                  title="Move to Trash"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Save Conflict or Error Notification Banner */}
      {errorMessage && saveStatus === "failed" && (
        <div className="bg-red-950/80 border-b border-red-500/30 px-4 py-2.5 text-xs text-red-200 flex items-center justify-between">
          <div className="flex items-center gap-2 mx-auto max-w-6xl w-full">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="flex-1">{errorMessage}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.refresh()}
                className="btn btn-ghost px-2 py-1 text-xs text-red-300 hover:text-white underline"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={handleRetrySave}
                className="btn btn-secondary px-3 py-1 text-xs"
              >
                Retry Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Document Body */}
      <main className="flex-1 mx-auto max-w-4xl w-full px-4 sm:px-6 py-6 flex flex-col">
        {/* Document Metadata Pill */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted pb-4 mb-4 border-b border-border-subtle/50">
          <div className="flex items-center gap-3">
            <span>
              Author:{" "}
              <strong className="text-text-secondary">
                {initialDoc.owner?.name || initialDoc.owner?.email || "Unknown"}
              </strong>
            </span>
            {initialDoc.workspace && (
              <>
                <span>•</span>
                <span>
                  Workspace:{" "}
                  <strong className="text-text-secondary">
                    {initialDoc.workspace.name}
                  </strong>
                </span>
              </>
            )}
          </div>
          <div>Last saved {relativeTime(lastSavedTime.toISOString())}</div>
        </div>

        {/* TipTap Rich Text Editor Container */}
        <div className="flex-1 card border border-border-subtle bg-surface-1/40 flex flex-col rounded-xl overflow-hidden shadow-xl">
          {/* Editor Format Toolbar */}
          <EditorToolbar editor={editor} readOnly={!canEdit} />

          {/* Clickable Canvas Wrapping ProseMirror */}
          <div
            className="flex-1 p-6 sm:p-10 tiptap-editor-canvas"
            onClick={() => {
              if (canEdit && editor && !editor.isFocused) {
                editor.commands.focus();
              }
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
      </main>
    </div>
  );
}
