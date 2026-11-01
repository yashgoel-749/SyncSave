"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/utils";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { DOCUMENT_STARTERS } from "@/lib/document-starters";
import { readDocumentFile, type TipTapDocument } from "@/lib/document-files";

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
  const [navigationOpen, setNavigationOpen] = useState(false);

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
  const creationPendingRef = useRef(false);
  const importPendingRef = useRef(false);
  const [creationDialog, setCreationDialog] = useState<"templates" | "import" | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);

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
  const handleCreateDocument = async (starter?: { title: string; content: TipTapDocument }) => {
    if (creationPendingRef.current) return;
    creationPendingRef.current = true;
    setIsCreating(true);
    setCreationError(null);
    setErrorMessage(null);
    const tempId = `temp-${Date.now()}`;
    const optimisticDoc: DocumentItem = {
      id: tempId,
      title: starter?.title ?? "Untitled Document",
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
          title: starter?.title ?? "Untitled Document",
          workspaceId: selectedWorkspaceId || undefined,
          ...(starter ? { content: JSON.stringify(starter.content) } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create document");
      }

      const { document: newDoc } = await res.json();
      setDocuments((prev) => prev.map((d) => (d.id === tempId ? newDoc : d)));
      setCreationDialog(null);
      router.push(`/documents/${newDoc.id}`);
    } catch (err: unknown) {
      setDocuments((prev) => prev.filter((d) => d.id !== tempId));
      const msg = err instanceof Error ? err.message : "Failed to create document";
      setErrorMessage(msg);
      setCreationError(msg);
      creationPendingRef.current = false;
      setIsCreating(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file || importPendingRef.current || creationPendingRef.current) return;
    importPendingRef.current = true;
    setIsReadingFile(true);
    setCreationError(null);
    try {
      const imported = await readDocumentFile(file);
      await handleCreateDocument(imported);
    } catch (err: unknown) {
      setCreationError(err instanceof Error ? err.message : "Could not import this file. Try again.");
    } finally {
      importPendingRef.current = false;
      setIsReadingFile(false);
    }
  };

  const closeCreationDialog = () => {
    if (!isCreating && !isReadingFile) setCreationDialog(null);
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
    <div className="grid min-w-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
      <aside className="min-w-0 self-start rounded-xl border border-border-subtle bg-surface-1 lg:sticky lg:top-24">
        <button
          type="button"
          className="flex w-full min-w-0 items-center justify-between gap-3 p-4 text-left text-sm font-medium lg:hidden"
          aria-expanded={navigationOpen}
          aria-controls="dashboard-navigation"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <span className="min-w-0 truncate">{activeWorkspace?.name || "Workspace"} · {FILTERS.find((f) => f.id === filter)?.label}</span>
          <svg aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${navigationOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <div id="dashboard-navigation" className={`${navigationOpen ? "block" : "hidden"} space-y-6 p-4 lg:block lg:p-5`}>
          <div className="min-w-0 space-y-3">
            <label htmlFor="workspace-select" className="block text-xs font-semibold tracking-wide text-text-secondary">
              Workspace
            </label>
            <select
              id="workspace-select"
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              className="select w-full min-w-0 text-sm font-medium"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
            {activeWorkspace?.description && <p className="break-words text-sm leading-relaxed text-text-secondary">{activeWorkspace.description}</p>}
            <button
              onClick={() => setIsCreatingWorkspace(true)}
              className="btn btn-ghost w-full justify-start gap-2 px-2.5 py-2 text-sm text-text-secondary hover:text-text-primary"
              title="Create new workspace"
            >
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>New workspace</span>
            </button>
          </div>
          <nav aria-label="Document navigation" className="space-y-1 border-t border-border-subtle pt-4">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors ${filter === f.id ? "bg-brand-500/10 font-semibold text-action" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}
              >
                <FilterIcon filter={f.id} />
                {f.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>
      <section aria-labelledby="dashboard-documents-title" className="min-w-0 space-y-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div className="min-w-0">
          <p className="mb-1 truncate text-sm text-text-secondary">{activeWorkspace?.name || "Your workspace"}</p>
          <h2 id="dashboard-documents-title" className="text-2xl font-semibold tracking-tight text-text-primary">{FILTERS.find((f) => f.id === filter)?.label}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleCreateDocument()}
            disabled={isCreating || isReadingFile}
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
          <button className="btn btn-secondary text-sm px-4 py-2" disabled={isCreating || isReadingFile}
            onClick={() => { setCreationError(null); setCreationDialog("templates"); }}>
            Templates
          </button>
          <button className="btn btn-secondary text-sm px-4 py-2" disabled={isCreating || isReadingFile}
            onClick={() => { setCreationError(null); setCreationDialog("import"); }}>
            Import
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-status-danger-bg border border-status-danger-border text-status-danger text-sm flex items-center justify-between gap-3"
        >
          <div className="flex min-w-0 items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="break-words">{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="shrink-0 text-status-danger font-bold p-2"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="border-b border-border-subtle pb-5">
        <div className="relative w-full max-w-xl">
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
            className="input text-sm py-3 pl-10 pr-10"
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
        <p role="status" className="break-words text-sm text-text-secondary">
          Showing {documents.length} of {total} {total === 1 ? "document" : "documents"}
          {activeWorkspace ? ` in ${activeWorkspace.name}` : ""}
          {debouncedSearch ? ` matching “${debouncedSearch}”` : ""}
        </p>
      )}

      {/* Documents Grid / Content View */}
      {isLoading ? (
        <div className="grid min-w-0 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading documents">
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
        <div className="card px-5 py-10 sm:p-12 text-center border-dashed bg-surface-1">
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
          <p className="mt-2 text-sm leading-relaxed text-text-secondary max-w-sm mx-auto break-words">
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
              onClick={() => handleCreateDocument()}
              disabled={isCreating || isReadingFile}
              className="mt-5 btn btn-primary text-xs px-4 py-2 inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Create document</span>
            </button>
          )}
          {filter === "all" && !debouncedSearch && !errorMessage && (
            <div className="mt-6 text-left max-w-md mx-auto border-t border-border-subtle pt-5">
              <h4 className="font-semibold text-sm text-text-primary">Getting started</h4>
              <ol className="mt-3 space-y-3 text-sm leading-relaxed text-text-secondary list-decimal pl-5">
                <li>Choose New document for a blank page, Templates for a starting outline, or Import for an existing text file.</li>
                <li>Write in the editor. Your changes save automatically.</li>
                <li>Use Share in your document to invite collaborators.</li>
              </ol>
              <Link href="/help" className="inline-block mt-3 text-sm text-action hover:underline">Read the getting-started guide</Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {documents.map((doc) => {
              const isOwner = doc.ownerId === userId;
              const sharedCount = doc._count?.collaborators ?? 0;
              return (
                <article
                  key={doc.id}
                  className="card card-hover min-w-0 p-5 group flex flex-col justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-col items-start justify-between gap-3">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="min-w-0 break-words font-semibold text-base leading-snug text-text-primary hover:text-action transition-colors line-clamp-2"
                      >
                        {doc.title || "Untitled Document"}
                      </Link>

                      <div className="flex flex-wrap items-center gap-1">
                        {filter === "trash" ? (
                          <>
                            <CardAction label="Restore document" onClick={() => handleRestore(doc)} hover="hover:text-status-success">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </CardAction>
                            <CardAction label="Permanently delete" onClick={() => setDeletingDoc(doc)} hover="hover:text-status-danger">
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
                            <CardAction label="Move to trash" onClick={() => handleSoftDelete(doc)} hover="hover:text-status-danger">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </CardAction>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="mt-3 break-words text-sm leading-relaxed text-text-secondary line-clamp-3 min-h-[4rem]">
                      {doc.preview ? doc.preview : <span className="italic text-text-muted">Blank document, ready for writing.</span>}
                    </p>
                  </div>

                  <div className="pt-4 mt-4 border-t border-border-subtle flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                    <span className="flex items-center gap-1.5 min-w-0" suppressHydrationWarning>
                      <span suppressHydrationWarning className="truncate">Edited {relativeTime(doc.updatedAt)}</span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
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

      </section>

      <Modal open={creationDialog === "templates"} onClose={closeCreationDialog} labelledBy="templates-dialog-title">
        <div className="p-6 space-y-4">
          <h3 id="templates-dialog-title" className="text-base font-semibold text-text-primary">Start from a template</h3>
          <p className="text-xs text-text-secondary">Each template creates a new document in {activeWorkspace?.name || "your workspace"}.</p>
          {creationError && <p role="alert" className="text-sm text-status-danger">{creationError}</p>}
          <div className="space-y-3">
            {DOCUMENT_STARTERS.map((starter) => (
              <button key={starter.id} disabled={isCreating} onClick={() => handleCreateDocument(starter)}
                className="card card-hover w-full p-4 text-left disabled:opacity-50">
                <span className="block font-semibold text-sm">{starter.title}</span>
                <span className="block mt-1 text-xs text-text-secondary">{starter.description}</span>
              </button>
            ))}
          </div>
          {isCreating && <p role="status" className="text-xs text-text-secondary">Creating document…</p>}
          <button type="button" disabled={isCreating} onClick={closeCreationDialog} className="btn btn-ghost text-xs">Cancel</button>
        </div>
      </Modal>

      <Modal open={creationDialog === "import"} onClose={closeCreationDialog} labelledBy="import-dialog-title">
        <div className="p-6 space-y-4">
          <h3 id="import-dialog-title" className="text-base font-semibold text-text-primary">Import a document</h3>
          <p className="text-xs text-text-secondary">Choose a UTF-8 .txt file or supported TipTap .json export, up to 256 KiB. Import creates a new document in {activeWorkspace?.name || "your workspace"}; it never replaces an existing document.</p>
          <label htmlFor="document-import-file" className="block text-sm font-medium">Document file</label>
          <input id="document-import-file" type="file" accept=".txt,.json" disabled={isCreating || isReadingFile}
            onChange={handleImportFile} className="input text-xs" />
          {creationError && <p role="alert" className="text-sm text-status-danger">{creationError}</p>}
          {(isCreating || isReadingFile) && <p role="status" className="text-xs text-text-secondary">Importing document…</p>}
          <button type="button" disabled={isCreating || isReadingFile} onClick={closeCreationDialog} className="btn btn-ghost text-xs">Cancel</button>
        </div>
      </Modal>

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

function FilterIcon({ filter }: { filter: Filter }) {
  const paths: Record<Filter, string> = {
    all: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    recent: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    archived: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
    trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  };
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={paths[filter]} />
    </svg>
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
      className={`p-2.5 rounded-md transition-colors hover:bg-surface-3 ${
        active ? "text-action" : "text-text-secondary"
      } ${hover}`}
    >
      {children}
    </button>
  );
}
