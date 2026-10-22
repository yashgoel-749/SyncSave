"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/utils";

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  _count?: { documents: number; members: number };
}

interface DocumentItem {
  id: string;
  title: string;
  content: string | null;
  workspaceId: string | null;
  workspace?: { id: string; name: string } | null;
  ownerId: string;
  owner?: { id: string; name: string | null; email: string };
  isArchived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DashboardViewProps {
  initialWorkspaces: Workspace[];
  userId: string;
}

export default function DashboardView({
  initialWorkspaces,
  userId,
}: DashboardViewProps) {
  const router = useRouter();

  // Workspaces state
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(
    initialWorkspaces[0]?.id || ""
  );
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState("");

  // Documents state
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [filter, setFilter] = useState<"all" | "recent" | "archived" | "trash">("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Rename modal state
  const [renamingDoc, setRenamingDoc] = useState<DocumentItem | null>(null);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function fetchDocuments() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams();
        if (selectedWorkspaceId) params.set("workspaceId", selectedWorkspaceId);
        if (filter) params.set("filter", filter);
        if (search.trim()) params.set("search", search.trim());

        const res = await fetch(`/api/documents?${params.toString()}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load documents");
        }
        const data = await res.json();
        if (isMounted) {
          setDocuments(data.documents || []);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : "Error loading documents";
          setErrorMessage(msg);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchDocuments();

    return () => {
      isMounted = false;
    };
  }, [selectedWorkspaceId, filter, search, refreshKey]);

  // Create document with optimistic update
  const handleCreateDocument = async () => {
    const tempId = `temp-${Date.now()}`;
    const optimisticDoc: DocumentItem = {
      id: tempId,
      title: "Untitled Document",
      content: null,
      workspaceId: selectedWorkspaceId || null,
      workspace: workspaces.find((w) => w.id === selectedWorkspaceId) || null,
      ownerId: userId,
      isArchived: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Optimistic insert
    setDocuments((prev) => [optimisticDoc, ...prev]);

    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled Document",
          workspaceId: selectedWorkspaceId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create document");
      }

      const { document: newDoc } = await res.json();
      // Replace optimistic doc with server doc
      setDocuments((prev) =>
        prev.map((d) => (d.id === tempId ? newDoc : d))
      );
      router.push(`/documents/${newDoc.id}`);
    } catch (err: unknown) {
      // Rollback on failure
      setDocuments((prev) => prev.filter((d) => d.id !== tempId));
      const msg = err instanceof Error ? err.message : "Failed to create document";
      setErrorMessage(msg);
    }
  };

  // Create Workspace
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newWorkspaceName.trim(),
          description: newWorkspaceDesc.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create workspace");
      }

      const { workspace: newWs } = await res.json();
      setWorkspaces((prev) => [...prev, newWs]);
      setSelectedWorkspaceId(newWs.id);
      setIsCreatingWorkspace(false);
      setNewWorkspaceName("");
      setNewWorkspaceDesc("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create workspace";
      setErrorMessage(msg);
    }
  };

  // Rename document with rollback
  const handleRename = async () => {
    if (!renamingDoc || !newTitle.trim()) return;
    const originalTitle = renamingDoc.title;
    const docId = renamingDoc.id;

    // Optimistic title update
    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, title: newTitle.trim() } : d))
    );
    setRenamingDoc(null);

    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to rename document");
      }
    } catch (err: unknown) {
      // Rollback
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, title: originalTitle } : d))
      );
      const msg = err instanceof Error ? err.message : "Failed to rename document";
      setErrorMessage(msg);
    }
  };

  // Archive / Unarchive with rollback
  const handleToggleArchive = async (doc: DocumentItem) => {
    const targetState = !doc.isArchived;

    // Optimistic update
    setDocuments((prev) =>
      filter === "archived" || filter === "all"
        ? prev.filter((d) => d.id !== doc.id)
        : prev.map((d) => (d.id === doc.id ? { ...d, isArchived: targetState } : d))
    );

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: targetState }),
      });

      if (!res.ok) {
        throw new Error("Failed to update archive status");
      }
    } catch (err: unknown) {
      setRefreshKey((k) => k + 1); // Rollback to fresh state
      const msg = err instanceof Error ? err.message : "Failed to update archive status";
      setErrorMessage(msg);
    }
  };

  // Soft delete (Move to Trash) with rollback
  const handleSoftDelete = async (doc: DocumentItem) => {
    // Optimistic removal
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to move document to trash");
      }
    } catch (err: unknown) {
      setRefreshKey((k) => k + 1); // Rollback
      const msg = err instanceof Error ? err.message : "Failed to move document to trash";
      setErrorMessage(msg);
    }
  };

  // Restore document from Trash
  const handleRestore = async (doc: DocumentItem) => {
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));

    try {
      const res = await fetch(`/api/documents/${doc.id}/restore`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to restore document");
      }
    } catch (err: unknown) {
      setRefreshKey((k) => k + 1);
      const msg = err instanceof Error ? err.message : "Failed to restore document";
      setErrorMessage(msg);
    }
  };

  // Permanent Delete
  const handlePermanentDelete = async (doc: DocumentItem) => {
    if (!confirm(`Permanently delete "${doc.title}"? This action cannot be undone.`)) {
      return;
    }

    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));

    try {
      const res = await fetch(`/api/documents/${doc.id}?permanent=true`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to permanently delete document");
      }
    } catch (err: unknown) {
      setRefreshKey((k) => k + 1);
      const msg = err instanceof Error ? err.message : "Failed to permanently delete document";
      setErrorMessage(msg);
    }
  };

  const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

  return (
    <div className="space-y-6">
      {/* Top Controls: Workspace Selector + Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Workspace Selector */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              className="bg-bg-surface border border-border-subtle text-text-primary text-sm rounded-lg px-3.5 py-2 pr-8 appearance-none focus:outline-none focus:border-brand-primary cursor-pointer hover:border-border-strong transition-colors font-medium"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <button
            onClick={() => setIsCreatingWorkspace(true)}
            className="btn btn-ghost text-xs px-2.5 py-2 text-text-secondary hover:text-text-primary border border-dashed border-border-subtle hover:border-border-strong rounded-lg flex items-center gap-1.5"
            title="Create new workspace"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New Workspace</span>
          </button>
        </div>

        {/* Right CTA: New Document */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCreateDocument}
            id="new-document-button"
            className="btn btn-primary text-sm px-4 py-2 flex items-center gap-2 shadow-lg shadow-brand-primary/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New Document</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between gap-3 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-300 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search and Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-border-subtle pb-4">
        {/* Filter Navigation */}
        <div className="flex items-center gap-1 bg-bg-surface/60 p-1 rounded-lg border border-border-subtle self-start">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "all"
                ? "bg-brand-primary text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            All Documents
          </button>
          <button
            onClick={() => setFilter("recent")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "recent"
                ? "bg-brand-primary text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Recent
          </button>
          <button
            onClick={() => setFilter("archived")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "archived"
                ? "bg-brand-primary text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Archived
          </button>
          <button
            onClick={() => setFilter("trash")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "trash"
                ? "bg-red-500/80 text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Trash
          </button>
        </div>

        {/* Search input */}
        <div className="relative max-w-xs w-full">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full bg-bg-surface border border-border-subtle rounded-lg text-xs text-text-primary px-3 py-2 pl-9 placeholder:text-text-muted focus:outline-none focus:border-brand-primary transition-colors"
          />
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Documents Grid / Content View */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="card p-5 border border-border-subtle bg-bg-card/40 animate-pulse space-y-3"
            >
              <div className="h-5 w-2/3 bg-bg-surface rounded" />
              <div className="h-3 w-1/3 bg-bg-surface/60 rounded" />
              <div className="pt-4 flex justify-between">
                <div className="h-3 w-20 bg-bg-surface/50 rounded" />
                <div className="h-3 w-16 bg-bg-surface/50 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="card p-12 text-center border border-dashed border-border-subtle bg-bg-surface/20">
          <div className="mx-auto w-12 h-12 rounded-full bg-bg-surface flex items-center justify-center text-text-muted mb-3">
            {filter === "trash" ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            ) : filter === "archived" ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
          </div>
          <h3 className="text-base font-semibold text-text-primary">
            {search
              ? `No documents matching "${search}"`
              : filter === "trash"
              ? "Trash is empty"
              : filter === "archived"
              ? "No archived documents"
              : "No documents yet"}
          </h3>
          <p className="mt-1 text-xs text-text-secondary max-w-sm mx-auto">
            {search
              ? "Try adjusting your search terms or filters."
              : filter === "trash"
              ? "Documents moved to trash will appear here."
              : filter === "archived"
              ? "Archive documents you want to keep reference to without cluttering your main view."
              : `Start collaborating by creating your first document in ${activeWorkspace?.name || "your workspace"}.`}
          </p>
          {filter === "all" && !search && (
            <button
              onClick={handleCreateDocument}
              className="mt-4 btn btn-primary text-xs px-4 py-2 inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Create Document</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="card p-5 border border-border-subtle bg-bg-card/70 hover:border-brand-primary/40 transition-all duration-200 group relative flex flex-col justify-between"
            >
              <div>
                {/* Header: Title + Action buttons */}
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/documents/${doc.id}`}
                    className="font-semibold text-sm text-text-primary group-hover:text-brand-secondary transition-colors line-clamp-1 flex-1"
                  >
                    {doc.title || "Untitled Document"}
                  </Link>

                  {/* Actions Dropdown / Icon actions */}
                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    {filter === "trash" ? (
                      <>
                        <button
                          onClick={() => handleRestore(doc)}
                          className="p-1 hover:text-accent-emerald text-text-muted text-xs"
                          title="Restore document"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(doc)}
                          className="p-1 hover:text-red-400 text-text-muted text-xs"
                          title="Permanently delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setRenamingDoc(doc);
                            setNewTitle(doc.title);
                          }}
                          className="p-1 hover:text-text-primary text-text-muted text-xs"
                          title="Rename"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleToggleArchive(doc)}
                          className={`p-1 hover:text-text-primary text-xs ${
                            doc.isArchived ? "text-accent-violet" : "text-text-muted"
                          }`}
                          title={doc.isArchived ? "Unarchive" : "Archive"}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleSoftDelete(doc)}
                          className="p-1 hover:text-red-400 text-text-muted text-xs"
                          title="Move to trash"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Content snippet */}
                <p className="mt-2 text-xs text-text-secondary line-clamp-2 min-h-[2rem]">
                  {doc.content ? doc.content.slice(0, 120) : "Blank document ready for writing..."}
                </p>
              </div>

              {/* Card Footer: Metadata */}
              <div className="pt-4 mt-3 border-t border-border-subtle/60 flex items-center justify-between text-[11px] text-text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald" />
                  <span>{relativeTime(doc.updatedAt)}</span>
                </span>
                {doc.workspace?.name && (
                  <span className="bg-bg-surface px-2 py-0.5 rounded text-[10px] text-text-secondary border border-border-subtle truncate max-w-[120px]">
                    {doc.workspace.name}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rename Modal */}
      {renamingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="card p-6 w-full max-w-sm border border-border-subtle bg-bg-card shadow-2xl">
            <h3 className="text-base font-semibold text-text-primary mb-3">Rename Document</h3>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand-primary mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenamingDoc(null);
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenamingDoc(null)}
                className="btn btn-ghost text-xs px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                className="btn btn-primary text-xs px-4 py-1.5"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Workspace Modal */}
      {isCreatingWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="card p-6 w-full max-w-md border border-border-subtle bg-bg-card shadow-2xl">
            <h3 className="text-base font-semibold text-text-primary mb-1">Create Workspace</h3>
            <p className="text-xs text-text-secondary mb-4">
              Workspaces organize documents and let you collaborate with team members.
            </p>
            <form onSubmit={handleCreateWorkspace} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                  Workspace Name
                </label>
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder="e.g. Engineering, Marketing, Side Project"
                  required
                  className="w-full bg-bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                  Description <span className="text-text-muted font-normal lowercase">(optional)</span>
                </label>
                <textarea
                  value={newWorkspaceDesc}
                  onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                  placeholder="What is this workspace for?"
                  rows={2}
                  className="w-full bg-bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand-primary resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingWorkspace(false)}
                  className="btn btn-ghost text-xs px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary text-xs px-4 py-1.5"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
