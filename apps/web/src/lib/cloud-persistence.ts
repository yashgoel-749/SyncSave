import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";

export type CloudPersistenceStatus =
  | { kind: "pending" | "checking" | "offline" | "failed" }
  | { kind: "saved"; verifiedAt: Date };

/** Compare full CRDT histories, including deletes, without touching the editor. */
export function persistedStateCovers(persisted: Uint8Array, captured: Uint8Array): boolean {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, persisted);
    const before = Y.encodeStateAsUpdate(scratch);
    Y.applyUpdate(scratch, captured);
    const after = Y.encodeStateAsUpdate(scratch);
    return before.length === after.length && before.every((byte, i) => byte === after[i]);
  } finally {
    scratch.destroy();
  }
}

export function observeCloudPersistence({ doc, provider, documentId, onStatus }: {
  doc: Y.Doc;
  provider: Pick<WebsocketProvider, "wsconnected" | "synced" | "on" | "off">;
  documentId: string;
  onStatus: (status: CloudPersistenceStatus) => void;
}): () => void {
  let disposed = false;
  let generation = 0;
  let connected = provider.wsconnected;
  let synced = provider.synced;
  let retryDelay = 2000;
  let forbidden = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;

  function cancel() {
    clearTimeout(timer);
    request?.abort();
    request = undefined;
  }

  function schedule(delay = 2000) {
    cancel();
    if (disposed) return;
    onStatus({ kind: !connected ? "offline" : forbidden ? "failed" : "pending" });
    if (connected && synced && !forbidden) timer = setTimeout(() => { void verify(); }, delay);
  }

  async function verify() {
    const capturedGeneration = generation;
    const captured = Y.encodeStateAsUpdate(doc);
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    const current = () => !disposed && connected && synced && generation === capturedGeneration && request === controller;
    onStatus({ kind: "checking" });
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/persistence`, {
        cache: "no-store", signal: controller.signal,
      });
      if (!current()) return;
      if ([401, 403, 404].includes(response.status)) {
        forbidden = true;
        onStatus({ kind: "failed" });
        return;
      }
      if (!response.ok) throw new Error("Cloud readback failed");
      const persisted = response.status === 204 ? null : new Uint8Array(await response.arrayBuffer());
      if (!current()) return;
      if (persisted && persistedStateCovers(persisted, captured)) {
        retryDelay = 2000;
        onStatus({ kind: "saved", verifiedAt: new Date() });
        return;
      }
      onStatus({ kind: "pending" });
    } catch {
      if (!current()) return;
      onStatus({ kind: "failed" });
    } finally {
      clearTimeout(timeout);
    }
    if (current()) {
      request = undefined;
      timer = setTimeout(() => { void verify(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10000);
    }
  }

  function updated() {
    generation++;
    retryDelay = 2000;
    schedule();
  }
  function statusChanged({ status }: { status: "connected" | "connecting" | "disconnected" }) {
    generation++;
    connected = status === "connected";
    synced = provider.synced;
    forbidden = false;
    schedule(0);
  }
  function syncChanged(value: boolean) {
    generation++;
    synced = value;
    schedule();
  }

  doc.on("update", updated);
  provider.on("status", statusChanged);
  provider.on("sync", syncChanged);
  schedule();
  return () => {
    disposed = true;
    cancel();
    doc.off("update", updated);
    provider.off("status", statusChanged);
    provider.off("sync", syncChanged);
  };
}
