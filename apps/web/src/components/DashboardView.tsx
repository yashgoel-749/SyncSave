"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/utils";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";

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
  /** Short plain-text excerpt computed server-side (never the raw JSON). */
  preview?: string;
  workspaceId: string | null;
  workspace?: { id: string; name: string } | null;
  ownerId: string;
  owner?: { id: string; name: string | null; email: string };
  isArchived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { collaborators: number };
}

interface DashboardViewProps {
  initialWorkspaces: Workspace[];
  userId: string;
  initialWorkspaceId?: string;
}

type Filter = "all" | "recent" | "archived" | "trash";

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 250;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All documents" },
  { id: "recent", label: "Recent" },
  { id: "archived", label: "Archived" },
  { id: "trash", label: "Trash" },
];

export default function DashboardView({
  initialWorkspaces,
  userId,
  initialWorkspaceId,
}: DashboardViewProps) {
  const router = useRouter();

  // Workspaces state
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(
    (initialWorkspaceId && initialWorkspaces.some((w) => w.id === initialWorkspaceId)
      ? initialWorkspaceId
      : initialWorkspaces[0]?.id) || ""
  );
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState("");
  const [isSubmittingWorkspace, setIsSubmittingWorkspace] = useState(false);

  // Documents state
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [renamingDoc, setRenamingDoc] = useState<DocumentItem | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [deletingDoc, setDeletingDoc] = useState<DocumentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Debounce search input so we don't hit the API on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // "/" focuses search (unless typing elsewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const buildQuery = useCallback(
    (pageToLoad: number) => {
      const params = new URLSearchParams();
      if (selectedWorkspaceId) params.set("workspaceId", selectedWorkspaceId);
      params.set("filter", filter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("page", String(pageToLoad));
      params.set("limit", String(PAGE_SIZE));
      return params.toString();
    },
    [selectedWorkspaceId, filter, debouncedSearch]
  );

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function fetchDocuments() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/documents?${buildQuery(1)}`, { signal: controller.signal });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load documents");
        }
        const data = await res.json();
        if (isMounted) {
          setDocuments(data.documents || []);
          setPage(1);
          setTotalPages(data.pagination?.totalPages ?? 1);
          setTotal(data.pagination?.total ?? (data.documents?.length || 0));
        }
      } catch (err: unknown) {
        if (!isMounted || (err instanceof DOMException && err.name === "AbortError")) return;
        const msg = err instanceof Error ? err.message : "Error loading documents";
        setErrorMessage(msg);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchDocuments();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [buildQuery, refreshKey]);

  const loadMore = async () => {
    if (page >= totalPages || isLoadingMore) return;
    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`/api/documents?${buildQuery(nextPage)}`);
      if (!res.ok) throw new Error("Failed to load more documents");
      const data = await res.json();
      setDocuments((prev) => {
        const seen = new Set(prev.map((d) => d.id));
        return [...prev, ...(data.documents || []).filter((d: DocumentItem) => !seen.has(d.id))];
      });
      setPage(nextPage);
      setTotalPages(data.pagination?.totalPages ?? nextPage);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load more documents");
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Create document with optimistic update
  const handleCreateDocument = async () => {
    if (isCreating) return;
    setIsCreating(true);
    const tempId = `temp-${Date.now()}`;
    const optimisticDoc: DocumentItem = {
      id: tempId,
      title: "Untitled Document",
      preview: "",
      workspaceId: selectedWorkspaceId || null,
      workspace: workspaces.find((w) => w.id === selectedWorkspaceId) || null,
      ownerId: userId,
      isArchived: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

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
      setDocuments((prev) => prev.map((d) => (d.id === tempId ? newDoc : d)));
      router.push(`/documents/${newDoc.id}`);
    } catch (err: unknown) {
      setDocuments((prev) => prev.filter((d) => d.id !== tempId));
      const msg = err instanceof Error ? err.message : "Failed to create document";
      setErrorMessage(msg);
      setIsCreating(false);
    }
  };

  // Create Workspace
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim() || isSubmittingWorkspace) return;
    setIsSubmittingWorkspace(true);

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
      setWorkspaces((prev) => [...prev, { ...newWs, _count: { documents: 0, members: 1 } }]);
      setSelectedWorkspaceId(newWs.id);
      setIsCreatingWorkspace(false);
      setNewWorkspaceName("");
      setNewWorkspaceDesc("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create workspace";
      setErrorMessage(msg);
    } finally {
      setIsSubmittingWorkspace(false);
    }
  };

  // Rename document with rollback
  const handleRename = async () => {
    if (!renamingDoc || !newTitle.trim()) return;
    const originalTitle = renamingDoc.title;
    const docId = renamingDoc.id;
    const nextTitle = newTitle.trim();

    setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, title: nextTitle } : d)));
    setRenamingDoc(null);

    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to rename document");
      }
    } catch (err: unknown) {
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
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    setTotal((t) => Math.max(0, t - 1));

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: targetState }),
      });
      if (!res.ok) throw new Error("Failed to update archive status");
    } catch (err: unknown) {
      setRefreshKey((k) => k + 1);
      const msg = err instanceof Error ? err.message : "Failed to update archive status";
      setErrorMessage(msg);
    }
  };

  // Soft delete (Move to Trash) with rollback
  const handleSoftDelete = async (doc: DocumentItem) => {
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    setTotal((t) => Math.max(0, t - 1));

    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to move document to trash");
    } catch (err: unknown) {
      setRefreshKey((k) => k + 1);
      const msg = err instanceof Error ? err.message : "Failed to move document to trash";
      setErrorMessage(msg);
    }
  };

  // Restore document from Trash
  const handleRestore = async (doc: DocumentItem) => {
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    setTotal((t) => Math.max(0, t - 1));

    try {
      const res = await fetch(`/api/documents/${doc.id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to restore document");
    } catch (err: unknown) {
      setRefreshKey((k) => k + 1);
      const msg = err instanceof Error ? err.message : "Failed to restore document";
      setErrorMessage(msg);
    }
  };

  // Permanent Delete (confirmed via dialog)
  const handlePermanentDelete = async () => {
    const doc = deletingDoc;
    if (!doc) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/documents/${doc.id}?permanent=true`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to permanently delete document");
      }
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to permanently delete document";
      setErrorMessage(msg);
    } finally {
      setIsDeleting(false);
      setDeletingDoc(null);
    }
  };

  const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

  return (
    <div className="space-y-6">
      {/* Top Controls: Workspace Selector + Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <label htmlFor="workspace-select" className="sr-only">
              Workspace
            </label>
            <select
              id="workspace-select"
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              className="select w-auto min-w-[200px] font-medium"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                  {ws._count ? ` (${ws._count.documents})` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsCreatingWorkspace(true)}
            className="btn btn-ghost text-xs px-2.5 py-2 text-text-secondary hover:text-text-primary border border-dashed border-border-normal hover:border-brand-500/60 rounded-lg flex items-center gap-1.5"
            title="Create new workspace"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New workspace</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCreateDocument}
            disabled={isCreating}
            id="new-document-button"
            className="btn btn-primary text-sm px-4 py-2 flex items-center gap-2"
          >
            {isCreating ? (
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
            <span>New document</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2"
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
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search and Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <div className="segmented self-start" role="tablist" aria-label="Document filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              data-active={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={f.id === "trash" && filter === "trash" ? "!text-red-300" : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative max-w-xs w-full">
          <label htmlFor="document-search" className="sr-only">
            Search documents
          </label>
          <input
            id="document-search"
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="input text-xs py-2 pl-9 pr-10"
            autoComplete="off"
          />
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          {search ? (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary text-xs"
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : (
            <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none hidden sm:inline-flex">/</span>
          )}
        </div>
      </div>

      {/* Result summary */}
      {!isLoading && documents.length > 0 && (
        <p className="text-[11px] text-text-muted -mt-2">
          Showing {documents.length} of {total} {total === 1 ? "document" : "documents"}
          {activeWorkspace ? ` in ${activeWorkspace.name}` : ""}
          {debouncedSearch ? ` matching “${debouncedSearch}”` : ""}
        </p>
      )}

      {/* Documents Grid / Content View */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="card p-5 space-y-3">
              <div className="skeleton h-5 w-2/3" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-5/6" />
              <div className="pt-4 flex justify-between">
                <div className="skeleton h-3 w-20" />
                <div className="skeleton h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="card p-12 text-center border-dashed bg-surface-1/40 animate-in fade-in zoom-in-95">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-2 border border-border-subtle flex items-center justify-center text-text-muted mb-4">
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
            {debouncedSearch
              ? `No documents matching “${debouncedSearch}”`
              : filter === "trash"
              ? "Trash is empty"
              : filter === "archived"
              ? "No archived documents"
              : filter === "recent"
              ? "Nothing edited in the last 7 days"
              : "No documents yet"}
          </h3>
          <p className="mt-1 text-xs text-text-secondary max-w-sm mx-auto">
            {debouncedSearch
              ? "Try adjusting your search terms or filters."
              : filter === "trash"
              ? "Documents moved to trash will appear here for restoring or permanent deletion."
              : filter === "archived"
              ? "Archive documents you want to keep without cluttering your main view."
              : filter === "recent"
              ? "Documents you or your team touch recently will show up here."
              : `Start collaborating by creating your first document in ${activeWorkspace?.name || "your workspace"}.`}
          </p>
          {filter === "all" && !debouncedSearch && (
            <button
              onClick={handleCreateDocument}
              disabled={isCreating}
              className="mt-5 btn btn-primary text-xs px-4 py-2 inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Create document</span>
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
            {documents.map((doc) => {
              const isOwner = doc.ownerId === userId;
              const sharedCount = doc._count?.collaborators ?? 0;
              return (
                <article
                  key={doc.id}
                  className="card card-hover p-5 group relative flex flex-col justify-between overflow-hidden"
                >
                  {/* Accent bar */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-500 via-brand-400 to-accent-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="font-semibold text-sm text-text-primary group-hover:text-brand-300 transition-colors line-clamp-1 flex-1"
                      >
                        {doc.title || "Untitled Document"}
                      </Link>

                      <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {filter === "trash" ? (
                          <>
                            <CardAction label="Restore document" onClick={() => handleRestore(doc)} hover="hover:text-accent-400">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </CardAction>
                            <CardAction label="Permanently delete" onClick={() => setDeletingDoc(doc)} hover="hover:text-red-400">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </CardAction>
                          </>
                        ) : (
                          <>
                            <CardAction
                              label="Rename"
                              onClick={() => {
                                setRenamingDoc(doc);
                                setNewTitle(doc.title);
                              }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </CardAction>
                            <CardAction
                              label={doc.isArchived ? "Unarchive" : "Archive"}
                              onClick={() => handleToggleArchive(doc)}
                              active={doc.isArchived}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                              </svg>
                            </CardAction>
                            <CardAction label="Move to trash" onClick={() => handleSoftDelete(doc)} hover="hover:text-red-400">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </CardAction>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="mt-2 text-xs text-text-secondary line-clamp-2 min-h-[2rem]">
                      {doc.preview ? doc.preview : <span className="italic text-text-muted">Blank document, ready for writing.</span>}
                    </p>
                  </div>

                  <div className="pt-4 mt-3 border-t border-border-subtle/60 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                    <span className="flex items-center gap-1.5 min-w-0" suppressHydrationWarning>
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-500 flex-shrink-0" />
                      <span suppressHydrationWarning className="truncate">Edited {relativeTime(doc.updatedAt)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      {!isOwner && <span className="badge badge-muted">Shared with you</span>}
                      {isOwner && sharedCount > 0 && (
                        <span className="badge badge-brand" title={`${sharedCount} collaborator${sharedCount === 1 ? "" : "s"}`}>
                          {sharedCount} shared
                        </span>
                      )}
                      {doc.workspace?.name && !selectedWorkspaceId && (
                        <span className="badge badge-muted truncate max-w-[120px]">{doc.workspace.name}</span>
                      )}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {page < totalPages && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className="btn btn-secondary text-xs px-5 py-2"
              >
                {isLoadingMore ? "Loading…" : `Load more (${total - documents.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Rename Modal */}
      <Modal open={renamingDoc !== null} onClose={() => setRenamingDoc(null)} labelledBy="rename-dialog-title" size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRename();
          }}
          className="p-6"
        >
          <h3 id="rename-dialog-title" className="text-base font-semibold text-text-primary mb-3">
            Rename document
          </h3>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={100}
            className="input mb-4"
            autoFocus
            aria-label="Document title"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRenamingDoc(null)} className="btn btn-ghost text-xs px-3 py-1.5">
              Cancel
            </button>
            <button type="submit" disabled={!newTitle.trim()} className="btn btn-primary text-xs px-4 py-1.5">
              Save
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Workspace Modal */}
      <Modal open={isCreatingWorkspace} onClose={() => setIsCreatingWorkspace(false)} labelledBy="workspace-dialog-title">
        <div className="p-6">
          <h3 id="workspace-dialog-title" className="text-base font-semibold text-text-primary mb-1">
            Create workspace
          </h3>
          <p className="text-xs text-text-secondary mb-4">
            Workspaces organize documents and let you collaborate with team members.
          </p>
          <form onSubmit={handleCreateWorkspace} className="space-y-3">
            <div>
              <label htmlFor="ws-name" className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                Workspace name
              </label>
              <input
                id="ws-name"
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="e.g. Engineering, Marketing, Side Project"
                required
                maxLength={50}
                className="input"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="ws-desc" className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                Description <span className="text-text-muted font-normal lowercase">(optional)</span>
              </label>
              <textarea
                id="ws-desc"
                value={newWorkspaceDesc}
                onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                placeholder="What is this workspace for?"
                rows={2}
                maxLength={200}
                className="textarea resize-none"
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
              <button type="submit" disabled={isSubmittingWorkspace} className="btn btn-primary text-xs px-4 py-1.5">
                {isSubmittingWorkspace ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Permanent delete confirmation */}
      <ConfirmDialog
        open={deletingDoc !== null}
        title="Delete permanently?"
        description={
          deletingDoc ? (
            <>
              <strong className="text-text-primary">“{deletingDoc.title || "Untitled Document"}”</strong> and its
              full edit history will be erased. This cannot be undone.
            </>
          ) : undefined
        }
        confirmLabel="Delete forever"
        tone="danger"
        loading={isDeleting}
        onConfirm={handlePermanentDelete}
        onCancel={() => setDeletingDoc(null)}
      />
    </div>
  );
}

function CardAction({
  label,
  onClick,
  children,
  hover = "hover:text-text-primary",
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  hover?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-md transition-colors hover:bg-surface-3 ${
        active ? "text-accent-violet" : "text-text-muted"
      } ${hover}`}
    >
      {children}
    </button>
  );
}
