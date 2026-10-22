"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface DocumentHeaderActionsProps {
  docId: string;
  initialTitle: string;
  isArchived: boolean;
  userRole: string;
}

export default function DocumentHeaderActions({
  docId,
  initialTitle,
  isArchived: initialIsArchived,
  userRole,
}: DocumentHeaderActionsProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [isArchived, setIsArchived] = useState(initialIsArchived);
  const [isRenaming, setIsRenaming] = useState(false);
  const [tempTitle, setTempTitle] = useState(initialTitle);
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = userRole === "OWNER" || userRole === "EDITOR" || userRole === "ADMIN";

  const handleSaveRename = async () => {
    if (!tempTitle.trim() || tempTitle === title) {
      setIsRenaming(false);
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: tempTitle.trim() }),
      });
      if (res.ok) {
        setTitle(tempTitle.trim());
        router.refresh();
      }
    } finally {
      setIsSaving(false);
      setIsRenaming(false);
    }
  };

  const handleToggleArchive = async () => {
    const nextState = !isArchived;
    setIsArchived(nextState);
    await fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived: nextState }),
    });
    router.refresh();
  };

  const handleTrash = async () => {
    if (!confirm("Move this document to trash?")) return;
    const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-text-muted mr-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald" />
        <span>Saved to Cloud</span>
      </div>

      {canEdit && (
        <>
          <button
            onClick={() => {
              setTempTitle(title);
              setIsRenaming(true);
            }}
            className="btn btn-ghost text-xs px-2.5 py-1.5 text-text-secondary hover:text-text-primary"
            title="Rename Document"
          >
            Rename
          </button>

          <button
            onClick={handleToggleArchive}
            className={`btn btn-ghost text-xs px-2.5 py-1.5 ${
              isArchived ? "text-accent-violet font-semibold" : "text-text-secondary hover:text-text-primary"
            }`}
            title={isArchived ? "Unarchive Document" : "Archive Document"}
          >
            {isArchived ? "Archived" : "Archive"}
          </button>

          <button
            onClick={handleTrash}
            className="btn btn-ghost text-xs px-2 py-1.5 text-text-muted hover:text-red-400"
            title="Move to Trash"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </>
      )}

      {/* Rename Modal */}
      {isRenaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="card p-6 w-full max-w-sm border border-border-subtle bg-bg-card shadow-2xl">
            <h3 className="text-sm font-semibold text-text-primary mb-2">Rename Document</h3>
            <input
              type="text"
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              disabled={isSaving}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand-primary mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveRename();
                if (e.key === "Escape") setIsRenaming(false);
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsRenaming(false)}
                className="btn btn-ghost text-xs px-3 py-1.5"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRename}
                className="btn btn-primary text-xs px-4 py-1.5"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
