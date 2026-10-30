"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import Collaboration from "@tiptap/extension-collaboration";
import { Placeholder, CharacterCount } from "@tiptap/extensions";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import EditorToolbar from "./EditorToolbar";
import { CollaborationCursor } from "./collaboration-cursor";
import { parseDocumentContent } from "@/lib/editor-utils";
import { relativeTime } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import Whiteboard, { WHITEBOARD_MAP_KEY } from "@/components/whiteboard/Whiteboard";

export type SaveStatus = "saved" | "pending" | "saving" | "failed";
export type DocumentView = "document" | "whiteboard";

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

/** How often we re-check navigator.onLine (DevTools "Offline" throttling does not always fire events). */
const ONLINE_POLL_MS = 2000;
/** Debounce for title autosave. */
const TITLE_AUTOSAVE_MS = 1200;

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
  const [view, setView] = useState<DocumentView>("document");
  const [whiteboardMounted, setWhiteboardMounted] = useState(false);
  const [whiteboardShapeCount, setWhiteboardShapeCount] = useState(0);

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
  // Always start as "online" so server and client render identical markup; the real
  // navigator.onLine value is applied right after mount (see the poll effect below).
  const [isOnline, setIsOnline] = useState<boolean>(true);
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
  const statusPopoverRef = useRef<HTMLDivElement>(null);

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
  const [pendingInvitations, setPendingInvitations] = useState<
    Array<{ id: string; email: string; role: string; expiresAt: string; token: string }>
  >([]);
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);
  const [isUpdatingRole, setIsUpdatingRole] = useState<string | null>(null);
  const [isRemovingCollaborator, setIsRemovingCollaborator] = useState<string | null>(null);
  const [isRevokingInvite, setIsRevokingInvite] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInviteToken, setCopiedInviteToken] = useState<string | null>(null);
  const [isAccessRevoked, setIsAccessRevoked] = useState(false);

  // Confirmation dialogs (replace window.confirm)
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [isTrashing, setIsTrashing] = useState(false);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);

  // Stale request & concurrency protection for title saves
  const lastKnownUpdatedAtRef = useRef<string>(initialDoc.updatedAt);
  const saveSeqRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

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

    // Polling timer to catch Chrome DevTools Network "Offline" throttling, which
    // modifies navigator.onLine without reliably dispatching window events on localhost.
    const checkOnline = () => {
      if (typeof navigator !== "undefined" && isMounted) {
        if (!navigator.onLine && isOnlineRef.current) {
          handleOffline();
        } else if (navigator.onLine && !isOnlineRef.current && !manualOfflineRef.current) {
          handleOnline();
        }
      }
    };
    const initialCheck = setTimeout(checkOnline, 0);
    const pollTimer = setInterval(checkOnline, ONLINE_POLL_MS);

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

        // The server closes with 4403 when the owner revokes this user's access.
        provider.on("connection-close", (event: CloseEvent | null) => {
          if (event?.code === 4403 && isMounted) {
            setIsAccessRevoked(true);
            try {
              provider.shouldConnect = false;
              provider.disconnect();
            } catch {
              // ignore
            }
          }
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
      clearTimeout(initialCheck);
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

  // Whiteboard shape count badge (cheap: observes the shared map's size only)
  useEffect(() => {
    if (!collab) return;
    const map = collab.ydoc.getMap(WHITEBOARD_MAP_KEY);
    const update = () => setWhiteboardShapeCount(map.size);
    map.observe(update);
    update();
    return () => map.unobserve(update);
  }, [collab]);

  // Close the status popover on outside click
  useEffect(() => {
    if (!showStatusDetails) return;
    const onDown = (e: MouseEvent) => {
      if (statusPopoverRef.current && !statusPopoverRef.current.contains(e.target as Node)) {
        setShowStatusDetails(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showStatusDetails]);

  // The editor becomes editable only once the shared Y.Doc is bound; otherwise the
  // first keystrokes would land in a throw-away editor instance and be lost.
  const editorEditable = canEdit && collab !== null;

  // TipTap Editor instance
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: editorEditable,
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
          validate: (url: string) =>
            /^https?:\/\//i.test(url) ||
            url.startsWith("/") ||
            url.startsWith("mailto:"),
        }),
        Placeholder.configure({
          placeholder: canEdit ? "Start writing…" : "This document is empty.",
        }),
        CharacterCount,
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
    },
    [collab, canEdit]
  );

  // Keep editor editable state in sync if permission or readiness changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(editorEditable);
    }
  }, [editor, editorEditable]);

  // Live word / character stats (re-read on every transaction)
  const [stats, setStats] = useState<{ words: number; characters: number }>({ words: 0, characters: 0 });
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const storage = (editor.storage as { characterCount?: { words?: () => number; characters?: () => number } })
        ?.characterCount;
      if (!storage?.words || !storage.characters) return;
      setStats({ words: storage.words(), characters: storage.characters() });
    };
    read();
    if (typeof editor.on !== "function") return;
    editor.on("update", read);
    return () => {
      editor.off("update", read);
    };
  }, [editor]);

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
    }, TITLE_AUTOSAVE_MS);
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
      const res = await fetch(`/api/documents/${initialDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: nextState }),
      });
      if (!res.ok) throw new Error("Failed to update archive state");
      router.refresh();
    } catch {
      setIsArchived(!nextState);
      setErrorMessage("Could not update the archive state. Please try again.");
    }
  };

  const handleTrash = async () => {
    if (!canEdit) return;
    setIsTrashing(true);
    try {
      const res = await fetch(`/api/documents/${initialDoc.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/dashboard");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setErrorMessage(data.error || "Failed to move the document to trash.");
    } catch {
      setErrorMessage("Failed to move the document to trash.");
    } finally {
      setIsTrashing(false);
      setConfirmTrash(false);
    }
  };

  // Fetch collaborators and pending invitations when modal opens
  const loadCollaboratorsAndInvites = useCallback(async () => {
    try {
      const [collabRes, inviteRes] = await Promise.all([
        fetch(`/api/documents/${initialDoc.id}/collaborators`),
        fetch(`/api/documents/${initialDoc.id}/invitations`),
      ]);
      if (collabRes.ok) {
        const data = await collabRes.json();
        setCollaborators(data.collaborators || []);
      }
      if (inviteRes.ok) {
        const data = await inviteRes.json();
        setPendingInvitations(data.invitations || []);
      }
    } catch {
      // silent fail
    }
  }, [initialDoc.id]);

  const openShareModal = () => {
    setIsShareModalOpen(true);
    loadCollaboratorsAndInvites();
  };

  const closeShareModal = useCallback(() => {
    setIsShareModalOpen(false);
    setShareMessage(null);
    setGeneratedInviteUrl(null);
  }, []);

  const handleInviteCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareEmail.trim()) return;

    setIsSharing(true);
    setShareMessage(null);
    setGeneratedInviteUrl(null);

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

      setShareMessage({
        text: data.isExistingUser
          ? `Invited ${shareEmail} as ${shareRole.toLowerCase()} — they have been notified in-app.`
          : `Invitation link ready for ${shareEmail} (${shareRole.toLowerCase()}). Send it to them: it opens the document instantly, no account or sign-in needed.`,
        isError: false,
      });

      if (data.inviteUrl) {
        setGeneratedInviteUrl(data.inviteUrl);
      }

      setShareEmail("");
      loadCollaboratorsAndInvites();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to invite";
      setShareMessage({ text: msg, isError: true });
    } finally {
      setIsSharing(false);
    }
  };

  const handleUpdateCollaboratorRole = async (targetUserId: string, newRole: "EDITOR" | "VIEWER") => {
    setIsUpdatingRole(targetUserId);
    setShareMessage(null);
    try {
      const res = await fetch(`/api/documents/${initialDoc.id}/collaborators/${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update role");
      }
      setCollaborators((prev) =>
        prev.map((c) => (c.user.id === targetUserId ? { ...c, role: newRole } : c))
      );
      setShareMessage({ text: "Collaborator role updated", isError: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update role";
      setShareMessage({ text: msg, isError: true });
    } finally {
      setIsUpdatingRole(null);
    }
  };

  const handleRemoveCollaborator = async (targetUserId: string) => {
    setIsRemovingCollaborator(targetUserId);
    setShareMessage(null);
    try {
      const res = await fetch(`/api/documents/${initialDoc.id}/collaborators/${targetUserId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to remove collaborator");
      }
      setCollaborators((prev) => prev.filter((c) => c.user.id !== targetUserId));
      setShareMessage({ text: "Collaborator access revoked", isError: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove collaborator";
      setShareMessage({ text: msg, isError: true });
    } finally {
      setIsRemovingCollaborator(null);
      setConfirmRemoveUserId(null);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    setIsRevokingInvite(invitationId);
    setShareMessage(null);
    try {
      const res = await fetch(`/api/documents/${initialDoc.id}/invitations/${invitationId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to revoke invitation");
      }
      setPendingInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      setShareMessage({ text: "Invitation canceled", isError: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to revoke invitation";
      setShareMessage({ text: msg, isError: true });
    } finally {
      setIsRevokingInvite(null);
    }
  };

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleCopyLink = async () => {
    if (typeof window === "undefined") return;
    if (await copyToClipboard(window.location.href)) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const switchView = useCallback((next: DocumentView) => {
    setView(next);
    if (next === "whiteboard") setWhiteboardMounted(true);
  }, []);

  // Unique collaborators (a user with two tabs is still one person)
  const uniqueParticipants = useMemo(() => {
    const seen = new Map<string, ParticipantInfo>();
    for (const p of participants) {
      if (!seen.has(p.user.userId)) seen.set(p.user.userId, p);
    }
    return Array.from(seen.values());
  }, [participants]);

  const readingMinutes = Math.max(1, Math.round(stats.words / 200));

  const collaboratorPendingRemoval = confirmRemoveUserId
    ? collaborators.find((c) => c.user.id === confirmRemoveUserId)
    : undefined;

  const isLive = collabStatus === "connected" && isSynced;

  return (
    <div className="min-h-dvh flex flex-col bg-surface-0 text-text-primary">
      {/* Top Header / Breadcrumbs & Status Bar */}
      <header className="border-b border-border-subtle bg-surface-1/80 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 min-h-14 py-2 sm:py-0 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-4 gap-y-2">
          {/* Breadcrumbs & Title Input */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1 order-1">
            <Link
              href="/dashboard"
              className="btn btn-ghost text-xs p-1.5 text-text-muted hover:text-text-primary flex-shrink-0"
              title="Back to Dashboard"
              aria-label="Back to Dashboard"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>

            {/* Breadcrumb Workspace */}
            <div className="hidden md:flex items-center gap-1.5 text-xs text-text-muted flex-shrink-0">
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
                aria-label="Document title"
                className={`w-full bg-transparent px-2 py-1 rounded-md text-sm font-semibold tracking-tight text-text-primary border border-transparent transition-all truncate ${
                  canEdit
                    ? "hover:border-border-subtle focus:border-brand-500 focus:bg-surface-2 focus:outline-none"
                    : "cursor-default"
                }`}
                title={canEdit ? "Click to rename document" : "Document title"}
              />
            </div>

          </div>

          {/* View switcher (own row on phones, inline from sm up) */}
          <div className="order-3 sm:order-2 w-full sm:w-auto flex sm:block">
            <div className="segmented flex-shrink-0 sm:ml-1" role="tablist" aria-label="Document view">
              <button
                type="button"
                role="tab"
                aria-selected={view === "document"}
                data-active={view === "document"}
                onClick={() => switchView("document")}
                title="Rich-text document"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="hidden sm:inline">Document</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "whiteboard"}
                data-active={view === "whiteboard"}
                onClick={() => switchView("whiteboard")}
                title="Collaborative whiteboard"
                disabled={!collab}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span className="hidden sm:inline">Whiteboard</span>
                {whiteboardShapeCount > 0 && (
                  <span className="ml-0.5 px-1.5 rounded-full bg-brand-500/20 text-brand-300 text-[10px] leading-4 tabular-nums">
                    {whiteboardShapeCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Right Header: Active Participants & Connection Status */}
          <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0 order-2 sm:order-3">
            {/* Live Participants Avatars */}
            {uniqueParticipants.length > 0 && (
              <div className="flex items-center -space-x-1.5 pr-1" aria-label={`${uniqueParticipants.length} people online`}>
                {uniqueParticipants.slice(0, 5).map((p) => (
                  <div
                    key={p.user.userId}
                    style={{ backgroundColor: p.user.color }}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold shadow-md border-2 border-surface-1 cursor-default transition-transform hover:scale-110 hover:z-10 animate-in zoom-in-75 duration-200"
                    title={`${p.user.name}${p.user.userId === initialDoc.owner?.id ? " (Owner)" : ""}${p.user.userId === userId ? " (you)" : ""}`}
                  >
                    {p.user.name.charAt(0).toUpperCase()}
                  </div>
                ))}
                {uniqueParticipants.length > 5 && (
                  <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-3 text-text-secondary text-[10px] font-bold border-2 border-surface-1">
                    +{uniqueParticipants.length - 5}
                  </div>
                )}
              </div>
            )}

            {/* Real-time Sync, Offline & Save Status Badge */}
            <div className="relative" ref={statusPopoverRef}>
              <button
                type="button"
                onClick={() => setShowStatusDetails((prev) => !prev)}
                aria-expanded={showStatusDetails}
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
                    ? "bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/15"
                    : collabStatus === "connecting"
                    ? "bg-brand-500/10 text-brand-300 border-brand-500/20 hover:bg-brand-500/15"
                    : "bg-accent-500/10 text-accent-400 border-accent-500/20 hover:bg-accent-500/15"
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
                    <Spinner className="text-brand-400" />
                    <span className="hidden sm:inline">Saving...</span>
                  </>
                ) : saveStatus === "failed" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    <span>Failed</span>
                  </>
                ) : !isOnline || collabStatus === "disconnected" ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" />
                    </svg>
                    <span className="hidden sm:inline">
                      {pendingSync ? "Offline (saved locally)" : "Offline"}
                    </span>
                  </>
                ) : collabStatus === "connecting" ? (
                  <>
                    <Spinner className="text-brand-400" />
                    <span className="hidden sm:inline">Connecting...</span>
                  </>
                ) : isLive ? (
                  <>
                    <span className="relative flex w-2 h-2">
                      <span className="absolute inline-flex w-full h-full rounded-full bg-accent-400 opacity-60 animate-ping" />
                      <span className="relative inline-flex w-2 h-2 rounded-full bg-accent-400" />
                    </span>
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
                <div className="absolute right-0 top-full mt-2 w-72 p-3 bg-surface-1 border border-border-normal rounded-xl shadow-2xl z-50 text-xs animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="flex items-center justify-between pb-2 border-b border-border-subtle mb-2.5">
                    <span className="font-semibold text-text-primary">Sync & Persistence</span>
                    <button
                      type="button"
                      onClick={() => setShowStatusDetails(false)}
                      className="text-text-muted hover:text-text-primary text-xs p-1"
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <StatusRow
                      label="Device storage"
                      detail={
                        isStorageBlocked
                          ? "IndexedDB blocked (private mode/quota)"
                          : isLocalSynced
                          ? "Saved locally in IndexedDB"
                          : "Initializing local storage..."
                      }
                      tone={isStorageBlocked ? "red" : isLocalSynced ? "accent" : "brand"}
                      badge={isStorageBlocked ? "Blocked" : isLocalSynced ? "Saved" : "Loading"}
                    />
                    <StatusRow
                      label="Collaboration"
                      detail={
                        isLive
                          ? "Merged with the active server room"
                          : collabStatus === "connecting"
                          ? "Connecting to server..."
                          : "Disconnected (offline mode)"
                      }
                      tone={isLive ? "accent" : collabStatus === "connecting" ? "brand" : "amber"}
                      badge={isLive ? "In sync" : collabStatus === "connecting" ? "Syncing" : "Offline"}
                    />
                    <StatusRow
                      label="Cloud database"
                      detail={
                        isLive && !pendingSync
                          ? "Durably persisted in PostgreSQL"
                          : pendingSync
                          ? "Queued locally; syncs on reconnect"
                          : "Synchronized at last session"
                      }
                      tone={isLive && !pendingSync ? "accent" : "amber"}
                      badge={isLive && !pendingSync ? "Persisted" : "Pending"}
                    />
                  </div>

                  {/* Manual Offline Disconnect / Reconnect Button */}
                  <div className="pt-2 mt-2.5 border-t border-border-subtle">
                    <button
                      type="button"
                      onClick={toggleSimulatedOffline}
                      className={`w-full py-1.5 px-3 rounded-md text-[11px] font-semibold transition-colors border text-center cursor-pointer ${
                        !isOnline || collabStatus === "disconnected" || manualOffline
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25"
                          : "bg-surface-2 text-text-secondary border-border-subtle hover:bg-surface-3 hover:text-text-primary"
                      }`}
                    >
                      {!isOnline || collabStatus === "disconnected" || manualOffline
                        ? "Reconnect to collaboration server"
                        : "Simulate going offline"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Notification Bell */}
            <NotificationBell />

            {/* Role Badge */}
            <span className="badge badge-brand hidden sm:inline-flex">
              {initialDoc.userRole}
            </span>

            {/* Quick Actions (Share, Archive, Trash) */}
            {canEdit && (
              <div className="flex items-center gap-1 border-l border-border-subtle pl-2">
                <button
                  type="button"
                  onClick={openShareModal}
                  className="btn btn-ghost text-xs px-2.5 py-1 text-text-muted hover:text-text-primary flex items-center gap-1 font-medium bg-surface-2 hover:bg-surface-3 transition-colors rounded-md"
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
                  className={`btn btn-ghost text-xs px-2 py-1 hidden sm:inline-flex ${
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
                  onClick={() => setConfirmTrash(true)}
                  className="btn btn-ghost text-xs p-1.5 text-text-muted hover:text-red-400"
                  title="Move to Trash"
                  aria-label="Move to Trash"
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
        <div className="bg-red-950/80 border-b border-red-500/30 px-4 py-2 text-xs text-red-200 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 mx-auto max-w-7xl w-full">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="flex-1">{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Storage Warning Banner */}
      {isStorageBlocked && (
        <div className="bg-red-950/80 border-b border-red-500/30 px-4 py-2 text-xs text-red-200">
          <div className="flex items-center gap-2 mx-auto max-w-7xl w-full">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1">
              <strong>Storage warning:</strong> device IndexedDB is unavailable (private mode or quota exceeded). Local edits will not persist across browser refreshes until reconnected to the server.
            </span>
          </div>
        </div>
      )}

      {/* Offline Working Banner */}
      {(!isOnline || collabStatus === "disconnected") && (
        <div className="bg-amber-950/70 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between mx-auto max-w-7xl w-full gap-x-3 gap-y-1.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                <strong>Working offline:</strong> edits are saved on this device and will sync automatically when the connection returns.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
              {pendingSync && (
                <span className="badge badge-amber">Pending cloud sync</span>
              )}
              <button
                type="button"
                onClick={toggleSimulatedOffline}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-2.5 py-0.5 rounded-md text-[11px] font-medium border border-amber-500/40 transition-colors cursor-pointer"
              >
                Reconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Document Body */}
      <main
        className={`flex-1 mx-auto w-full px-4 sm:px-6 py-6 flex flex-col ${
          view === "whiteboard" ? "max-w-7xl" : "max-w-4xl"
        }`}
      >
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
            {uniqueParticipants.length > 1 && (
              <>
                <span>•</span>
                <span className="text-accent-400 font-medium">
                  {uniqueParticipants.length} collaborating right now
                </span>
              </>
            )}
          </div>
          <div suppressHydrationWarning>Last saved {relativeTime(lastSavedTime.toISOString())}</div>
        </div>

        {/* Viewer restriction banner */}
        {!canEdit && (
          <div className="mb-4 p-3 rounded-xl bg-surface-1 border border-border-subtle flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 text-text-secondary">
              <div className="w-6 h-6 rounded-md bg-brand-500/10 text-brand-400 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <span>
                <strong className="text-text-primary">View-only mode:</strong> you can follow this document and whiteboard in real time, but editing is disabled.
              </span>
            </div>
            <span className="badge badge-muted flex-shrink-0">Read only</span>
          </div>
        )}

        {/* Rich-text editor pane (kept mounted while the whiteboard is shown so editor state survives) */}
        <div className={view === "document" ? "flex-1 flex flex-col" : "hidden"}>
          <div className="flex-1 card border border-border-subtle bg-surface-1 flex flex-col rounded-xl overflow-hidden shadow-xl relative">
            {/* Editor Format Toolbar */}
            <EditorToolbar editor={editor} readOnly={!canEdit} />

            {/* Clickable Canvas Wrapping ProseMirror */}
            <div
              className="flex-1 p-6 sm:p-10 tiptap-editor-canvas"
              onClick={() => {
                if (editorEditable && editor && !editor.isFocused) {
                  editor.commands.focus();
                }
              }}
            >
              <EditorContent editor={editor} />
            </div>

            {/* Loading shimmer until the shared document is bound */}
            {!collab && (
              <div className="absolute inset-x-0 bottom-0 top-[45px] bg-surface-1/70 backdrop-blur-[1px] flex items-start justify-center p-10 pointer-events-none">
                <div className="w-full max-w-2xl space-y-3">
                  <div className="skeleton h-6 w-2/3" />
                  <div className="skeleton h-4 w-full" />
                  <div className="skeleton h-4 w-11/12" />
                  <div className="skeleton h-4 w-3/4" />
                </div>
              </div>
            )}

            {/* Footer stats */}
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border-subtle bg-surface-1/60 text-[11px] text-text-muted">
              <div className="flex items-center gap-3 tabular-nums">
                <span>{stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}</span>
                <span className="text-border-normal">|</span>
                <span>{stats.characters.toLocaleString()} characters</span>
                <span className="text-border-normal hidden sm:inline">|</span>
                <span className="hidden sm:inline">~{readingMinutes} min read</span>
              </div>
              <div className="hidden sm:flex items-center gap-1.5">
                <span className="kbd">Ctrl</span>
                <span className="kbd">B</span>
                <span className="mx-0.5">bold</span>
                <span className="kbd">Ctrl</span>
                <span className="kbd">Z</span>
                <span className="mx-0.5">undo</span>
              </div>
            </div>
          </div>
        </div>

        {/* Whiteboard pane */}
        {whiteboardMounted && collab && (
          <div className={view === "whiteboard" ? "flex-1 flex flex-col min-h-[560px] animate-in fade-in duration-200" : "hidden"}>
            <Whiteboard
              ydoc={collab.ydoc}
              provider={collab.provider}
              user={{ id: collab.user.id, name: collab.user.name, color: collab.user.color }}
              canEdit={canEdit}
              title={title}
              active={view === "whiteboard"}
            />
          </div>
        )}
      </main>

      {/* Access Revoked Overlay */}
      {isAccessRevoked && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="card p-6 sm:p-8 max-w-md w-full bg-surface-1 border border-red-500/30 text-center shadow-2xl rounded-2xl space-y-4 animate-in zoom-in-95">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">Access Revoked</h2>
              <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
                Your permission to access this document has been revoked by the owner.
              </p>
            </div>
            <div className="pt-2">
              <Link href="/dashboard" className="btn btn-primary text-xs px-5 py-2.5 shadow-lg shadow-brand-500/20">
                Return to Dashboard
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Trash confirmation */}
      <ConfirmDialog
        open={confirmTrash}
        title="Move this document to trash?"
        description="You can restore it from the Trash tab on the dashboard. Collaborators will lose access until it is restored."
        confirmLabel="Move to trash"
        tone="danger"
        loading={isTrashing}
        onConfirm={handleTrash}
        onCancel={() => setConfirmTrash(false)}
      />

      {/* Remove collaborator confirmation */}
      <ConfirmDialog
        open={confirmRemoveUserId !== null}
        title="Revoke access?"
        description={
          collaboratorPendingRemoval ? (
            <>
              <strong className="text-text-primary">
                {collaboratorPendingRemoval.user.name || collaboratorPendingRemoval.user.email}
              </strong>{" "}
              will be disconnected immediately and will no longer be able to open this document.
            </>
          ) : undefined
        }
        confirmLabel="Revoke access"
        tone="danger"
        loading={isRemovingCollaborator !== null}
        onConfirm={() => {
          if (confirmRemoveUserId) void handleRemoveCollaborator(confirmRemoveUserId);
        }}
        onCancel={() => setConfirmRemoveUserId(null)}
      />

      {/* Share Document Modal */}
      <Modal open={isShareModalOpen} onClose={closeShareModal} labelledBy="share-dialog-title" size="lg">
        <div className="p-6 space-y-5">
          {/* Modal Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-500/10 text-brand-400 flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div>
                <h3 id="share-dialog-title" className="text-sm font-bold text-text-primary">Share Document</h3>
                <p className="text-[11px] text-text-muted truncate max-w-[280px]">{title || "Untitled Document"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeShareModal}
              data-modal-close
              className="btn btn-ghost text-xs p-1 text-text-muted hover:text-text-primary"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Quick Copy Link */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-secondary">Document link</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={typeof window !== "undefined" ? window.location.href : ""}
                className="input flex-1 text-xs py-1.5 px-2.5 text-text-muted select-all truncate"
                aria-label="Document link"
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
                  <span>Copy link</span>
                )}
              </button>
            </div>
          </div>

          {/* Invite by Email Form */}
          <form onSubmit={handleInviteCollaborator} className="space-y-3 pt-2 border-t border-border-subtle">
            <label className="text-xs font-semibold text-text-secondary block" htmlFor="share-email">
              Invite by email
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                id="share-email"
                type="email"
                required
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder="collaborator@example.com"
                className="input flex-1 text-xs py-1.5 px-2.5"
              />
              <select
                value={shareRole}
                onChange={(e) => setShareRole(e.target.value as "EDITOR" | "VIEWER")}
                className="select text-xs py-1.5 px-2.5 sm:w-44"
                aria-label="Role"
              >
                <option value="EDITOR">Editor (can edit)</option>
                <option value="VIEWER">Viewer (read only)</option>
              </select>
              <button
                type="submit"
                disabled={isSharing || !shareEmail.trim()}
                className="btn btn-primary text-xs px-3.5 py-1.5 flex items-center justify-center gap-1.5 flex-shrink-0"
              >
                {isSharing ? <Spinner className="text-white" /> : <span>Invite</span>}
              </button>
            </div>

            {shareMessage && (
              <div
                role="status"
                className={`p-2 rounded-md text-xs border animate-in fade-in ${
                  shareMessage.isError
                    ? "bg-red-500/10 text-red-300 border-red-500/20"
                    : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                }`}
              >
                {shareMessage.text}
              </div>
            )}

            {/* Generated Invitation Link Display */}
            {generatedInviteUrl && (
              <div className="p-2.5 rounded-lg bg-surface-2 border border-brand-500/30 space-y-1.5 animate-in fade-in">
                <div className="text-[11px] font-semibold text-brand-300">Invitation link — works without an account</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedInviteUrl}
                    className="input flex-1 text-[11px] py-1 px-2 bg-surface-1 text-text-secondary select-all truncate"
                    aria-label="Invitation link"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (await copyToClipboard(generatedInviteUrl)) {
                        setCopiedInviteToken(generatedInviteUrl);
                        setTimeout(() => setCopiedInviteToken(null), 2000);
                      }
                    }}
                    className="btn btn-primary text-[11px] py-1 px-2.5 flex-shrink-0"
                  >
                    {copiedInviteToken === generatedInviteUrl ? "Copied!" : "Copy link"}
                  </button>
                </div>
              </div>
            )}
          </form>

          {/* People with Access List */}
          <div className="space-y-2 pt-2 border-t border-border-subtle">
            <div className="text-xs font-semibold text-text-secondary">People with access</div>
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {/* Document Owner */}
              {initialDoc.owner && (
                <div className="flex items-center justify-between p-2 rounded-md bg-surface-2/60">
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="font-medium text-text-primary truncate">
                      {initialDoc.owner.name || "Owner"}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {initialDoc.owner.email}
                    </div>
                  </div>
                  <span className="badge badge-brand">Owner</span>
                </div>
              )}

              {/* Active Collaborators */}
              {collaborators.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-2 rounded-md bg-surface-2/60 gap-2"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="font-medium text-text-primary truncate">
                      {c.user.name || c.user.email}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {c.user.email}
                    </div>
                  </div>

                  {initialDoc.userRole === "OWNER" ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={c.role}
                        disabled={isUpdatingRole === c.user.id}
                        onChange={(e) =>
                          handleUpdateCollaboratorRole(c.user.id, e.target.value as "EDITOR" | "VIEWER")
                        }
                        className="select text-[11px] py-0.5 px-2 w-auto bg-surface-1"
                        aria-label={`Role for ${c.user.email}`}
                      >
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveUserId(c.user.id)}
                        disabled={isRemovingCollaborator === c.user.id}
                        className="btn btn-ghost text-[11px] py-0.5 px-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md"
                        title="Revoke access"
                      >
                        {isRemovingCollaborator === c.user.id ? "..." : "Remove"}
                      </button>
                    </div>
                  ) : (
                    <span className={`badge ${c.role === "EDITOR" ? "badge-accent" : "badge-muted"}`}>
                      {c.role}
                    </span>
                  )}
                </div>
              ))}

              {collaborators.length === 0 && (
                <p className="text-[11px] text-text-muted italic py-1">
                  No additional collaborators added yet.
                </p>
              )}
            </div>
          </div>

          {/* Pending Invitations List */}
          {pendingInvitations.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border-subtle">
              <div className="text-xs font-semibold text-text-secondary flex items-center justify-between">
                <span>Pending invitations ({pendingInvitations.length})</span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 text-xs">
                {pendingInvitations.map((inv) => {
                  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${inv.token}`;
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between p-2 rounded-md bg-surface-2/40 border border-border-subtle/50 gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-text-primary truncate">{inv.email}</div>
                        <div className="text-[10px] text-text-muted">
                          Offered: {inv.role.toLowerCase()} • Expires {relativeTime(inv.expiresAt)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            if (await copyToClipboard(inviteUrl)) {
                              setCopiedInviteToken(inv.id);
                              setTimeout(() => setCopiedInviteToken(null), 2000);
                            }
                          }}
                          className="btn btn-secondary text-[10px] py-0.5 px-2"
                          title="Copy invitation link"
                        >
                          {copiedInviteToken === inv.id ? "Copied!" : "Copy link"}
                        </button>

                        {initialDoc.userRole === "OWNER" && (
                          <button
                            type="button"
                            onClick={() => handleRevokeInvitation(inv.id)}
                            disabled={isRevokingInvite === inv.id}
                            className="btn btn-ghost text-[10px] py-0.5 px-1.5 text-text-muted hover:text-red-400"
                            title="Cancel invitation"
                          >
                            {isRevokingInvite === inv.id ? "..." : "Revoke"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Note */}
          <p className="text-[10px] text-text-muted pt-1 border-t border-border-subtle">
            Editors can change content, the whiteboard and the title with live collaboration. Viewers have read-only access.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Small presentational helpers                                            */
/* ---------------------------------------------------------------------- */

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin w-3 h-3 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function StatusRow({
  label,
  detail,
  badge,
  tone,
}: {
  label: string;
  detail: string;
  badge: string;
  tone: "accent" | "brand" | "amber" | "red";
}) {
  const toneClass =
    tone === "accent"
      ? "badge-accent"
      : tone === "brand"
      ? "badge-brand"
      : tone === "amber"
      ? "badge-amber"
      : "badge-red";
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="font-medium text-text-primary">{label}</div>
        <div className="text-[11px] text-text-secondary">{detail}</div>
      </div>
      <span className={`badge ${toneClass} flex-shrink-0`}>{badge}</span>
    </div>
  );
}
