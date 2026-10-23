"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import EditorToolbar from "./EditorToolbar";
import { CollaborationCursor } from "./collaboration-cursor";
import { parseDocumentContent } from "@/lib/editor-utils";
import { relativeTime } from "@/lib/utils";

export type SaveStatus = "saved" | "pending" | "saving" | "failed";

export interface ParticipantInfo {
  clientId: number;
  user: {
    userId: string;
    name: string;
    color: string;
  };
}

export interface CollabConfig {
  token: string;
  serverUrl: string;
  user: {
    id: string;
    name: string;
    email: string;
    color: string;
    role: string;
  };
}

export interface DocumentEditorProps {
  document: {
    id: string;
    title: string;
    content: string | null;
    isArchived: boolean;
    createdAt?: string;
    updatedAt: string;
    owner?: { id: string; name: string | null; email: string };
    workspace?: { id: string; name: string } | null;
    userRole: string;
  };
  userId: string;
  collabConfig?: CollabConfig;
}

export default function DocumentEditor({
  document: initialDoc,
  collabConfig,
  userId,
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

  // Collaboration State
  const [collab, setCollab] = useState<{
    ydoc: Y.Doc;
    provider: WebsocketProvider | null;
    user: { id: string; name: string; color: string; role: string };
  } | null>(null);
  const [collabStatus, setCollabStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [isSynced, setIsSynced] = useState(false);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);

  // Offline-first & Persistence States
  const [isOnline, setIsOnline] = useState<boolean>(
    () => (typeof navigator !== "undefined" ? navigator.onLine : true)
  );
  const [isLocalSynced, setIsLocalSynced] = useState<boolean>(false);
  const [isStorageBlocked, setIsStorageBlocked] = useState<boolean>(false);
  const [pendingSync, setPendingSync] = useState<boolean>(false);
  const [showStatusDetails, setShowStatusDetails] = useState<boolean>(false);
  const [manualOffline, setManualOffline] = useState<boolean>(false);

  const collabStatusRef = useRef(collabStatus);
  const isSyncedRef = useRef(isSynced);
  const isOnlineRef = useRef(isOnline);
  const manualOfflineRef = useRef(false);
  const providerRef = useRef<WebsocketProvider | null>(null);

  useEffect(() => {
    collabStatusRef.current = collabStatus;
  }, [collabStatus]);

  useEffect(() => {
    isSyncedRef.current = isSynced;
  }, [isSynced]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    manualOfflineRef.current = manualOffline;
  }, [manualOffline]);

  const handleOnline = useCallback(() => {
    manualOfflineRef.current = false;
    setManualOffline(false);
    setIsOnline(true);
    setCollabStatus("connecting");
    if (providerRef.current) {
      try {
        providerRef.current.connect();
      } catch (err) {
        console.warn("Reconnect error:", err);
      }
    }
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setCollabStatus("disconnected");
    if (providerRef.current) {
      try {
        providerRef.current.disconnect();
      } catch (err) {
        console.warn("Disconnect error:", err);
      }
    }
  }, []);

  const toggleSimulatedOffline = useCallback(() => {
    if (manualOfflineRef.current || !isOnlineRef.current) {
      handleOnline();
    } else {
      manualOfflineRef.current = true;
      setManualOffline(true);
      handleOffline();
    }
  }, [handleOnline, handleOffline]);

  // Share Modal State
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"EDITOR" | "VIEWER">("EDITOR");
  const [isSharing, setIsSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [collaborators, setCollaborators] = useState<
    Array<{ id: string; role: string; user: { id: string; name: string | null; email: string } }>
  >([]);
  const [copiedLink, setCopiedLink] = useState(false);

  // Stale request & concurrency protection for title / fallback saves
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
    initialDoc.userRole === "ADMIN" ||
    initialDoc.userRole === "MEMBER";

  // Connect to Collaboration Server (Yjs + WebSockets + IndexedDB)
  useEffect(() => {
    let isMounted = true;
    let idbInstance: IndexeddbPersistence | null = null;
    let ydocInstance: Y.Doc | null = null;

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    // Polling timer to immediately catch Chrome DevTools Network "Offline" throttling
    // which modifies navigator.onLine without reliably dispatching window offline events on localhost
    const pollTimer = setInterval(() => {
      if (typeof navigator !== "undefined" && isMounted) {
        if (!navigator.onLine && isOnlineRef.current) {
          handleOffline();
        } else if (navigator.onLine && !isOnlineRef.current && !manualOfflineRef.current) {
          handleOnline();
        }
      }
    }, 300);

    async function initCollab() {
      try {
        const ydoc = new Y.Doc();
        ydocInstance = ydoc;

        // 1. IndexedDB Persistence: cache updates locally across restarts/reloads
        if (typeof window !== "undefined" && "indexedDB" in window && window.indexedDB) {
          try {
            const idb = new IndexeddbPersistence(`syncspace_doc_${initialDoc.id}`, ydoc);
            idbInstance = idb;

            idb.on("synced", () => {
              if (isMounted) {
                setIsLocalSynced(true);
              }
            });
          } catch (storageErr) {
            console.warn("IndexedDB persistence could not be initialized:", storageErr);
            if (isMounted) setIsStorageBlocked(true);
          }
        }

        // 2. Track local edits made while disconnected
        ydoc.on("update", () => {
          if (isMounted) {
            if (collabStatusRef.current !== "connected" || !isSyncedRef.current) {
              setPendingSync(true);
            }
          }
        });

        // 3. Resolve Collab Config & Token
        let config = collabConfig;
        if (!config && typeof window !== "undefined") {
          try {
            const res = await fetch(`/api/documents/${initialDoc.id}/collab-token`);
            if (res.ok) {
              const data = await res.json();
              config = {
                serverUrl: data.serverUrl,
                token: data.token,
                user: data.user,
              };
            }
          } catch {
            // Token fetch failed (offline)
          }
        }

        const user = config?.user || {
          id: userId,
          name: "Anonymous",
          color: "#6d5ae6",
          role: initialDoc.userRole,
        };

        if (!config || !config.serverUrl) {
          // Offline mode without server config: allow offline editing in ydoc!
          if (isMounted) {
            setCollab({
              ydoc,
              provider: null,
              user,
            });
            setCollabStatus("disconnected");
          }
          return;
        }

        // 4. WebSocket Collaboration Provider
        // disableBc: true ensures multi-user sync flows strictly through the authenticated server room
        // and prevents tabs in the same browser from leaking updates while offline via BroadcastChannel
        const provider = new WebsocketProvider(
          config.serverUrl,
          initialDoc.id,
          ydoc,
          { params: { token: config.token }, disableBc: true }
        );
        providerRef.current = provider;

        // If the browser is currently offline or manual offline mode is active, disconnect the socket immediately
        if ((typeof navigator !== "undefined" && !navigator.onLine) || manualOfflineRef.current) {
          try {
            provider.disconnect();
          } catch {
            // ignore
          }
          if (isMounted) {
            setCollabStatus("disconnected");
            setIsOnline(false);
          }
        }

        // Configure user awareness
        provider.awareness.setLocalStateField("user", {
          userId: user.id,
          name: user.name,
          color: user.color,
        });

        provider.on("status", ({ status }: { status: "connecting" | "connected" | "disconnected" }) => {
          if (isMounted) setCollabStatus(status);
        });

        provider.on("sync", (synced: boolean) => {
          if (isMounted) {
            setIsSynced(synced);
            if (synced) {
              setSaveStatus("saved");
              setPendingSync(false);
              setLastSavedTime(new Date());
            }
          }
        });

        const updateParticipants = () => {
          if (!isMounted) return;
          const states = Array.from(provider.awareness.getStates().entries());
          const active: ParticipantInfo[] = states
            .map(([clientId, state]) => {
              const userState = (state as { user?: ParticipantInfo["user"] })?.user;
              return {
                clientId,
                user: userState as ParticipantInfo["user"],
              };
            })
            .filter((p): p is ParticipantInfo => Boolean(p.user));
          setParticipants(active);
        };

        provider.awareness.on("change", updateParticipants);

        if (isMounted) {
          setCollab({
            ydoc,
            provider,
            user,
          });
        }
      } catch (err) {
        if (isMounted) {
          loggerFallback(err);
        }
      }
    }

    function loggerFallback(err: unknown) {
      console.warn("Collab session fallback:", err);
      setCollabStatus("disconnected");
    }

    initCollab();

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }
      if (idbInstance) {
        idbInstance.destroy().catch(() => {});
      }
      if (ydocInstance) {
        ydocInstance.destroy();
      }
    };
  }, [initialDoc.id, collabConfig, userId, initialDoc.userRole, handleOnline, handleOffline]);

  // TipTap Editor instance
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: canEdit,
      extensions: [
        StarterKit.configure({
          undoRedo: collab ? false : undefined, // Handled by Yjs when collab is enabled
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
        ...(collab
          ? [
              Collaboration.configure({
                document: collab.ydoc,
                field: "default",
              }),
              ...(collab.provider
                ? [
                    CollaborationCursor.configure({
                      provider: collab.provider,
                      user: {
                        name: collab.user.name,
                        color: collab.user.color,
                      },
                    }),
                  ]
                : []),
            ]
          : []),
      ],
      content: collab ? undefined : parseDocumentContent(initialDoc.content),
      onUpdate: () => {
        if (!collab && canEdit) {
          triggerAutosave();
        }
      },
    },
    [collab, canEdit]
  );

  // Keep editor editable state in sync if permission changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(canEdit);
    }
  }, [editor, canEdit]);

  // Title Save function (persists title updates via REST)
  const saveTitle = useCallback(
    async (manualTitle?: string) => {
      if (!canEdit) return;

      const currentSeq = ++saveSeqRef.current;
      setSaveStatus("saving");
      setErrorMessage(null);

      const titleToSave =
        (manualTitle !== undefined ? manualTitle : titleRef.current).trim() ||
        "Untitled Document";

      try {
        const res = await fetch(`/api/documents/${initialDoc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleToSave,
            clientUpdatedAt: lastKnownUpdatedAtRef.current,
          }),
        });

        if (currentSeq < saveSeqRef.current) return;

        if (res.status === 409) {
          const errData = await res.json().catch(() => ({}));
          setSaveStatus("failed");
          setErrorMessage(
            errData.error ||
              "Document was updated in another session. Please reload."
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
        const msg =
          err instanceof Error ? err.message : "Failed to save title";
        setSaveStatus("failed");
        setErrorMessage(msg);
      }
    },
    [canEdit, initialDoc.id]
  );

  // Debounced Autosave Trigger for Title
  const triggerAutosave = useCallback(() => {
    if (!canEdit) return;
    setSaveStatus("pending");
    setErrorMessage(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveTitle();
    }, 1200);
  }, [canEdit, saveTitle]);

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
    const res = await fetch(`/api/documents/${initialDoc.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.push("/dashboard");
    }
  };

  // Fetch collaborators when modal opens
  useEffect(() => {
    if (!isShareModalOpen) return;
    let isMounted = true;

    async function loadCollaborators() {
      try {
        const res = await fetch(`/api/documents/${initialDoc.id}/collaborators`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setCollaborators(data.collaborators || []);
        }
      } catch {
        // silent fail
      }
    }

    loadCollaborators();
    return () => {
      isMounted = false;
    };
  }, [isShareModalOpen, initialDoc.id]);

  const handleInviteCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareEmail.trim()) return;

    setIsSharing(true);
    setShareMessage(null);

    try {
      const res = await fetch(`/api/documents/${initialDoc.id}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: shareEmail.trim(), role: shareRole }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to add collaborator");
      }

      setShareMessage({ text: `Invited ${shareEmail} as ${shareRole}`, isError: false });
      setShareEmail("");
      if (data.collaborator) {
        setCollaborators((prev) => [
          ...prev.filter((c) => c.user.id !== data.collaborator.user.id),
          data.collaborator,
        ]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to invite";
      setShareMessage({ text: msg, isError: true });
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
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
                className="hover:text-text-secondary transition-colors"
              >
                Dashboard
              </Link>
              {initialDoc.workspace && (
                <>
                  <span className="text-border-normal">/</span>
                  <Link
                    href={`/dashboard?workspaceId=${initialDoc.workspace.id}`}
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

          {/* Right Header: Active Participants & Connection Status */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {/* Live Participants Avatars */}
            {participants.length > 0 && (
              <div className="flex items-center -space-x-1.5 overflow-hidden pr-1">
                {participants.map((p) => (
                  <div
                    key={p.clientId}
                    style={{ backgroundColor: p.user.color }}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold shadow-md border-2 border-surface-1 cursor-default transition-transform hover:scale-110"
                    title={`${p.user.name}${p.user.userId === initialDoc.owner?.id ? " (Owner)" : ""}`}
                  >
                    {p.user.name.charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
            )}

            {/* Real-time Sync, Offline & Save Status Badge */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowStatusDetails((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                  isStorageBlocked
                    ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                    : saveStatus === "pending"
                    ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                    : saveStatus === "saving"
                    ? "bg-brand-500/10 text-brand-300 border-brand-500/20"
                    : saveStatus === "failed"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : !isOnline || collabStatus === "disconnected"
                    ? pendingSync
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
                      : "bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/15"
                    : collabStatus === "connecting"
                    ? "bg-brand-500/10 text-brand-300 border-brand-500/20 hover:bg-brand-500/15"
                    : collabStatus === "connected" && isSynced
                    ? "bg-accent-500/10 text-accent-400 border-accent-500/20 hover:bg-accent-500/15"
                    : "bg-accent-500/10 text-accent-400 border-accent-500/20"
                }`}
                title="Click to view detailed synchronization & persistence status"
              >
                {isStorageBlocked ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    <span>Storage Blocked</span>
                  </>
                ) : saveStatus === "pending" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="hidden sm:inline">Unsaved changes</span>
                  </>
                ) : saveStatus === "saving" ? (
                  <>
                    <svg className="animate-spin w-3 h-3 text-brand-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="hidden sm:inline">Saving...</span>
                  </>
                ) : saveStatus === "failed" ? (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    <span>Failed</span>
                  </div>
                ) : !isOnline || collabStatus === "disconnected" ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" />
                    </svg>
                    <span className="hidden sm:inline">
                      {pendingSync ? "Offline (Saved locally)" : "Offline"}
                    </span>
                  </>
                ) : collabStatus === "connecting" ? (
                  <>
                    <svg className="animate-spin w-3 h-3 text-brand-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="hidden sm:inline">Connecting...</span>
                  </>
                ) : collabStatus === "connected" && isSynced ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
                    <span className="hidden sm:inline">Live Sync</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-400" />
                    <span className="hidden sm:inline">Saved</span>
                  </>
                )}
              </button>

              {/* Status Details Popover */}
              {showStatusDetails && (
                <div className="absolute right-0 top-full mt-2 w-72 p-3 bg-surface-1 border border-border-subtle rounded-xl shadow-2xl z-50 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-border-subtle mb-2.5">
                    <span className="font-semibold text-text-primary">Sync & Persistence State</span>
                    <button
                      type="button"
                      onClick={() => setShowStatusDetails(false)}
                      className="text-text-muted hover:text-text-primary text-xs p-1"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {/* Device Persistence (IndexedDB) */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-text-primary">Device Storage</div>
                        <div className="text-[11px] text-text-secondary">
                          {isStorageBlocked
                            ? "IndexedDB blocked (private mode/quota)"
                            : isLocalSynced
                            ? "Saved locally in IndexedDB"
                            : "Initializing local storage..."}
                        </div>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          isStorageBlocked
                            ? "bg-red-500/10 text-red-400"
                            : isLocalSynced
                            ? "bg-accent-500/10 text-accent-400"
                            : "bg-brand-500/10 text-brand-300"
                        }`}
                      >
                        {isStorageBlocked ? "Blocked" : isLocalSynced ? "Saved" : "Loading"}
                      </span>
                    </div>

                    {/* Live Collaboration (WebSocket) */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-text-primary">Collaboration Sync</div>
                        <div className="text-[11px] text-text-secondary">
                          {collabStatus === "connected" && isSynced
                            ? "Merged with active server room"
                            : collabStatus === "connecting"
                            ? "Connecting to server..."
                            : "Disconnected (offline mode)"}
                        </div>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          collabStatus === "connected" && isSynced
                            ? "bg-accent-500/10 text-accent-400"
                            : collabStatus === "connecting"
                            ? "bg-brand-500/10 text-brand-300"
                            : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {collabStatus === "connected" && isSynced
                          ? "In Sync"
                          : collabStatus === "connecting"
                          ? "Syncing"
                          : "Offline"}
                      </span>
                    </div>

                    {/* Cloud Database (PostgreSQL) */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-text-primary">Cloud Database</div>
                        <div className="text-[11px] text-text-secondary">
                          {collabStatus === "connected" && isSynced && !pendingSync
                            ? "Durably persisted in PostgreSQL"
                            : pendingSync
                            ? "Queued locally; syncs on reconnect"
                            : "Synchronized at last session"}
                        </div>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          collabStatus === "connected" && isSynced && !pendingSync
                            ? "bg-accent-500/10 text-accent-400"
                            : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {collabStatus === "connected" && isSynced && !pendingSync
                          ? "Persisted"
                          : "Pending"}
                      </span>
                    </div>
                  </div>

                  {/* Manual Offline Disconnect / Reconnect Button */}
                  <div className="pt-2 mt-2.5 border-t border-border-subtle">
                    <button
                      type="button"
                      onClick={toggleSimulatedOffline}
                      className={`w-full py-1.5 px-3 rounded text-[11px] font-semibold transition-colors border text-center cursor-pointer ${
                        !isOnline || collabStatus === "disconnected" || manualOffline
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25"
                          : "bg-surface-2 text-text-secondary border-border-subtle hover:bg-surface-3 hover:text-text-primary"
                      }`}
                    >
                      {!isOnline || collabStatus === "disconnected" || manualOffline
                        ? "⚡ Reconnect to Collaboration Server"
                        : "🔌 Disconnect & Test Offline Mode"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Role Badge */}
            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wider bg-brand-500/10 text-brand-300 border border-brand-500/20">
              {initialDoc.userRole}
            </span>

            {/* Quick Actions (Share, Archive, Trash) */}
            {canEdit && (
              <div className="flex items-center gap-1 border-l border-border-subtle pl-2">
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(true)}
                  className="btn btn-ghost text-xs px-2.5 py-1 text-text-muted hover:text-text-primary flex items-center gap-1 font-medium bg-surface-2 hover:bg-surface-3 transition-colors rounded"
                  title="Share document with collaborators"
                >
                  <svg className="w-3.5 h-3.5 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span className="hidden sm:inline">Share</span>
                </button>
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

      {/* Error Notification Banner */}
      {errorMessage && (
        <div className="bg-red-950/80 border-b border-red-500/30 px-4 py-2 text-xs text-red-200 flex items-center justify-between">
          <div className="flex items-center gap-2 mx-auto max-w-6xl w-full">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="flex-1">{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Storage Warning Banner */}
      {isStorageBlocked && (
        <div className="bg-red-950/80 border-b border-red-500/30 px-4 py-2 text-xs text-red-200">
          <div className="flex items-center gap-2 mx-auto max-w-6xl w-full">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1">
              <strong>Storage Warning:</strong> Device IndexedDB is unavailable (private mode or quota exceeded). Local edits will not persist across browser refreshes until reconnected to server.
            </span>
          </div>
        </div>
      )}

      {/* Offline Working Banner */}
      {(!isOnline || collabStatus === "disconnected") && (
        <div className="bg-amber-950/70 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200">
          <div className="flex items-center justify-between mx-auto max-w-6xl w-full">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                <strong>Working offline:</strong> Edits are saved locally to your device via IndexedDB and will automatically sync when reconnected.
              </span>
            </div>
            <div className="flex items-center gap-2">
              {pendingSync && (
                <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded text-[11px] font-semibold border border-amber-500/30">
                  Pending cloud sync
                </span>
              )}
              <button
                type="button"
                onClick={toggleSimulatedOffline}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-2.5 py-0.5 rounded text-[11px] font-medium border border-amber-500/40 transition-colors cursor-pointer"
              >
                Reconnect to Cloud
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
            {participants.length > 1 && (
              <>
                <span>•</span>
                <span className="text-accent-400 font-medium">
                  {participants.length} collaborating right now
                </span>
              </>
            )}
          </div>
          <div suppressHydrationWarning>Last saved {relativeTime(lastSavedTime.toISOString())}</div>
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

      {/* Share Document Modal */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="card p-6 max-w-md w-full bg-surface-1 border border-border-normal shadow-2xl rounded-xl space-y-5 animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-brand-500/10 text-brand-400 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">Share Document</h3>
                  <p className="text-[11px] text-text-muted truncate max-w-[240px]">{title || "Untitled Document"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsShareModalOpen(false);
                  setShareMessage(null);
                }}
                className="btn btn-ghost text-xs p-1 text-text-muted hover:text-text-primary"
              >
                ✕
              </button>
            </div>

            {/* Quick Copy Link */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary">Document Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={typeof window !== "undefined" ? window.location.href : ""}
                  className="input flex-1 text-xs py-1.5 px-2.5 bg-surface-2 border-border-subtle text-text-muted select-all truncate"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 flex-shrink-0"
                >
                  {copiedLink ? (
                    <>
                      <span className="text-emerald-400">✓</span>
                      <span>Copied</span>
                    </>
                  ) : (
                    <span>Copy Link</span>
                  )}
                </button>
              </div>
            </div>

            {/* Invite by Email Form */}
            <form onSubmit={handleInviteCollaborator} className="space-y-3 pt-2 border-t border-border-subtle">
              <label className="text-xs font-semibold text-text-secondary block">Invite Collaborator</label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="email"
                  required
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="collaborator@example.com"
                  className="input flex-1 text-xs py-1.5 px-2.5 bg-surface-2 border-border-subtle"
                />
                <select
                  value={shareRole}
                  onChange={(e) => setShareRole(e.target.value as "EDITOR" | "VIEWER")}
                  className="select text-xs py-1.5 px-2.5 bg-surface-2 border-border-subtle text-text-primary rounded-lg"
                >
                  <option value="EDITOR">Editor (Can edit)</option>
                  <option value="VIEWER">Viewer (Read only)</option>
                </select>
                <button
                  type="submit"
                  disabled={isSharing || !shareEmail.trim()}
                  className="btn btn-primary text-xs px-3.5 py-1.5 flex items-center justify-center gap-1.5 flex-shrink-0"
                >
                  {isSharing ? (
                    <span className="animate-spin text-xs">●</span>
                  ) : (
                    <span>Invite</span>
                  )}
                </button>
              </div>

              {shareMessage && (
                <div
                  className={`p-2 rounded text-xs border ${
                    shareMessage.isError
                      ? "bg-red-500/10 text-red-300 border-red-500/20"
                      : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                  }`}
                >
                  {shareMessage.text}
                </div>
              )}
            </form>

            {/* Existing Collaborators List */}
            <div className="space-y-2 pt-2 border-t border-border-subtle">
              <div className="text-xs font-semibold text-text-secondary">People with access</div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 text-xs">
                {/* Document Owner */}
                {initialDoc.owner && (
                  <div className="flex items-center justify-between p-2 rounded bg-surface-2/60">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-medium text-text-primary truncate">
                        {initialDoc.owner.name || "Owner"}
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        {initialDoc.owner.email}
                      </div>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-brand-500/10 text-brand-300 border border-brand-500/20">
                      Owner
                    </span>
                  </div>
                )}

                {/* Invited Collaborators */}
                {collaborators.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-2 rounded bg-surface-2/60"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-medium text-text-primary truncate">
                        {c.user.name || c.user.email}
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        {c.user.email}
                      </div>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        c.role === "EDITOR"
                          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                          : "bg-surface-3 text-text-muted border border-border-subtle"
                      }`}
                    >
                      {c.role}
                    </span>
                  </div>
                ))}

                {collaborators.length === 0 && (
                  <p className="text-[11px] text-text-muted italic py-1">
                    No additional collaborators invited yet.
                  </p>
                )}
              </div>
            </div>

            {/* Note */}
            <p className="text-[10px] text-text-muted pt-1 border-t border-border-subtle">
              Users invited as Editors can collaborate on this document in real time with live carets and presence.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
