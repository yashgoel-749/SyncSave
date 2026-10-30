import * as dotenv from "dotenv";
dotenv.config();

import * as Y from "yjs";
import { PrismaClient } from "@syncspace/db";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import {
  yDocToProsemirrorJSON,
  prosemirrorJSONToYXmlFragment,
} from "@tiptap/y-tiptap";
import { logger } from "./logger";

// y-websocket ships utils as CJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const utils = require("y-websocket/bin/utils") as {
  WSSharedDoc: new (name: string) => any;
  docs: Map<string, any>;
};

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

/**
 * ProseMirror schema mirroring the client editor configuration. Used to hydrate
 * a Yjs document faithfully (headings, lists, marks, links…) from the TipTap JSON
 * snapshot when no binary Yjs state exists or it is corrupt.
 */
const editorSchema = getSchema([
  StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }),
  Underline,
  Link.configure({ openOnClick: false }),
]);

/** Delay before an idle (empty) room is released from memory. */
const EVICTION_GRACE_MS = parseInt(process.env.DOC_EVICTION_GRACE_MS || "30000", 10);

export class DocumentManager {
  public docs: Map<string, any>;
  private initLocks: Map<string, Promise<any>>;
  private persistenceTimers: Map<string, NodeJS.Timeout>;
  private evictionTimers: Map<string, NodeJS.Timeout>;
  private dirtyDocs: Set<string>;
  private activeFlushes: Map<string, Promise<boolean>>;

  constructor() {
    this.docs = utils.docs;
    this.initLocks = new Map();
    this.persistenceTimers = new Map();
    this.evictionTimers = new Map();
    this.dirtyDocs = new Set();
    this.activeFlushes = new Map();
  }

  /**
   * Coordinated loading of a document.
   * If document is already in memory, returns immediately.
   * If another connection is concurrently loading it, awaits the same promise
   * to prevent concurrent first-connection races.
   */
  async getOrLoadDocument(docId: string): Promise<any | null> {
    // 1. In memory
    const existing = this.docs.get(docId);
    if (existing) {
      this.cancelEviction(docId);
      return existing;
    }

    // 2. Already loading concurrently
    const inFlight = this.initLocks.get(docId);
    if (inFlight) {
      return inFlight;
    }

    // 3. Initiate first-connection load
    const loadPromise = (async () => {
      try {
        const docRecord = await prisma.document.findUnique({
          where: { id: docId },
        });

        if (!docRecord || docRecord.deletedAt !== null) {
          logger.warn(`Document ${docId} not found or in trash.`);
          return null;
        }

        const ydoc = new utils.WSSharedDoc(docId);
        let hydratedFromBinary = false;

        // Load persisted Yjs state if available
        if (docRecord.yjsState && docRecord.yjsState.length > 0) {
          try {
            Y.applyUpdate(ydoc, new Uint8Array(docRecord.yjsState));
            hydratedFromBinary = true;
            logger.info(`Loaded persisted Yjs state for ${docId} (${docRecord.yjsState.length} bytes)`);
          } catch (err) {
            logger.error(`Error applying persisted Yjs binary state for ${docId}. Attempting fallback hydration.`, err);
          }
        }

        // Fallback to TipTap JSON if binary was missing or corrupted
        if (!hydratedFromBinary && docRecord.content) {
          this.hydrateFromJson(docId, ydoc, docRecord.content);
        }

        // Attach update listener for debounced persistence
        ydoc.on("update", () => {
          this.scheduleSave(docId, ydoc);
        });

        // Store into y-websocket's shared docs map
        this.docs.set(docId, ydoc);
        return ydoc;
      } finally {
        this.initLocks.delete(docId);
      }
    })();

    this.initLocks.set(docId, loadPromise);
    return loadPromise;
  }

  /**
   * Hydrates the shared "default" XML fragment from a TipTap JSON snapshot.
   * Uses the full editor schema; falls back to a plain paragraph import if the
   * snapshot contains nodes the schema does not know about.
   */
  private hydrateFromJson(docId: string, ydoc: any, content: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (jsonErr) {
      logger.warn(`Failed to parse content JSON fallback for ${docId}:`, jsonErr);
      return;
    }

    if (!parsed || parsed.type !== "doc" || !Array.isArray(parsed.content)) {
      return;
    }

    const xmlFragment = ydoc.getXmlFragment("default");

    try {
      prosemirrorJSONToYXmlFragment(editorSchema, parsed, xmlFragment);
      logger.info(`Hydrated document ${docId} from TipTap JSON snapshot (schema-aware)`);
      return;
    } catch (schemaErr) {
      logger.warn(
        `Schema-aware hydration failed for ${docId}; falling back to plain paragraphs.`,
        schemaErr
      );
    }

    // Plain paragraph fallback (lossy but never throws)
    ydoc.transact(() => {
      for (const node of parsed.content) {
        if (node.type !== "paragraph" && node.type !== "heading") continue;
        const p = new Y.XmlElement(node.type);
        if (node.type === "heading" && node.attrs?.level) {
          p.setAttribute("level", String(node.attrs.level));
        }
        xmlFragment.push([p]);
        if (Array.isArray(node.content)) {
          for (const textNode of node.content) {
            if (textNode.type === "text" && typeof textNode.text === "string") {
              p.push([new Y.XmlText(textNode.text)]);
            }
          }
        }
      }
    });
  }

  /**
   * Schedules debounced persistence to PostgreSQL (1.5 seconds)
   */
  scheduleSave(docId: string, ydoc: any, delayMs = 1500): void {
    this.dirtyDocs.add(docId);

    const existingTimer = this.persistenceTimers.get(docId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.persistenceTimers.delete(docId);
      await this.flushDocument(docId, ydoc);
    }, delayMs);

    this.persistenceTimers.set(docId, timer);
  }

  /**
   * Durably writes document state to PostgreSQL with sequential ordering guarantee.
   * If a flush is already active for this docId, queues sequentially to prevent race conditions.
   */
  async flushDocument(docId: string, ydoc: any): Promise<boolean> {
    // Wait for any existing flush on this doc to complete first to guarantee ordering
    const existingFlush = this.activeFlushes.get(docId);
    if (existingFlush) {
      await existingFlush.catch(() => false);
    }

    if (!this.dirtyDocs.has(docId)) {
      return false;
    }
    this.dirtyDocs.delete(docId);

    const flushPromise = (async () => {
      try {
        const stateUpdate = Buffer.from(Y.encodeStateAsUpdate(ydoc));
        let serializedContent: string | null = null;

        try {
          const pmJson = yDocToProsemirrorJSON(ydoc, "default");
          if (pmJson && pmJson.content && pmJson.content.length > 0) {
            serializedContent = JSON.stringify(pmJson);
          }
        } catch {
          // TipTap serialization fallback
        }

        await prisma.document.update({
          where: { id: docId },
          data: {
            yjsState: stateUpdate,
            ...(serializedContent ? { content: serializedContent } : {}),
            updatedAt: new Date(),
          },
        });

        logger.info(`Durable save complete for ${docId} (${stateUpdate.length} bytes)`);
        return true;
      } catch (error) {
        logger.error(`Failed to persist document ${docId}:`, error);
        // Re-mark as dirty so next flush attempt will retry
        this.dirtyDocs.add(docId);
        return false;
      } finally {
        this.activeFlushes.delete(docId);
      }
    })();

    this.activeFlushes.set(docId, flushPromise);
    return flushPromise;
  }

  /**
   * Called when the last client leaves a room. Flushes pending changes and, after a
   * grace period (so quick reconnects don't hit the database), releases the Y.Doc
   * from memory. Without this, every document ever opened stays resident forever.
   */
  async releaseIfIdle(docId: string, ydoc: any): Promise<void> {
    try {
      await this.flushDocument(docId, ydoc);
    } catch (err) {
      logger.error(`Error flushing document ${docId} on empty room:`, err);
    }
    this.scheduleEviction(docId, ydoc);
  }

  private scheduleEviction(docId: string, ydoc: any): void {
    this.cancelEviction(docId);
    const timer = setTimeout(() => {
      this.evictionTimers.delete(docId);
      void this.evictDocument(docId, ydoc);
    }, EVICTION_GRACE_MS);
    timer.unref?.();
    this.evictionTimers.set(docId, timer);
  }

  private cancelEviction(docId: string): void {
    const timer = this.evictionTimers.get(docId);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(docId);
    }
  }

  /**
   * Evicts a document from memory if nobody reconnected during the grace period.
   */
  async evictDocument(docId: string, ydoc: any): Promise<boolean> {
    const current = this.docs.get(docId);
    if (!current || current !== ydoc) return false;
    if (ydoc.conns && ydoc.conns.size > 0) return false;

    // Make sure nothing is left unsaved before dropping the in-memory copy.
    const pendingTimer = this.persistenceTimers.get(docId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.persistenceTimers.delete(docId);
    }
    if (this.dirtyDocs.has(docId)) {
      const ok = await this.flushDocument(docId, ydoc);
      if (!ok) {
        // Could not persist – keep it in memory and retry later.
        this.scheduleEviction(docId, ydoc);
        return false;
      }
    }

    // Re-check: a client may have connected while we were flushing.
    if (ydoc.conns && ydoc.conns.size > 0) return false;

    this.docs.delete(docId);
    try {
      ydoc.destroy();
    } catch {
      // ignore
    }
    logger.info(`Evicted idle document ${docId} from memory`);
    return true;
  }

  /**
   * Flushes all pending documents to PostgreSQL (used on shutdown or disconnects)
   */
  async flushAll(): Promise<void> {
    // Clear all pending timers and immediately flush
    for (const [, timer] of this.persistenceTimers) {
      clearTimeout(timer);
    }
    this.persistenceTimers.clear();

    const promises: Promise<boolean>[] = [];
    for (const docId of Array.from(this.dirtyDocs)) {
      const ydoc = this.docs.get(docId);
      if (ydoc) {
        promises.push(this.flushDocument(docId, ydoc));
      }
    }

    // Also wait for any flushes that were already in-flight
    for (const inFlight of Array.from(this.activeFlushes.values())) {
      promises.push(inFlight);
    }

    await Promise.all(promises);
    logger.info("All dirty documents flushed to PostgreSQL.");
  }

  /**
   * Number of documents currently resident in memory (for health reporting).
   */
  getResidentDocumentCount(): number {
    return this.docs.size;
  }

  /**
   * Health check for database connectivity
   */
  async checkDatabaseHealth(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

export const documentManager = new DocumentManager();
