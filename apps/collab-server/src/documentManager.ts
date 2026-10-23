import * as dotenv from "dotenv";
dotenv.config();

import * as Y from "yjs";
import { PrismaClient } from "@syncspace/db";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
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

export class DocumentManager {
  public docs: Map<string, any>;
  private initLocks: Map<string, Promise<any>>;
  private persistenceTimers: Map<string, NodeJS.Timeout>;
  private dirtyDocs: Set<string>;

  constructor() {
    this.docs = utils.docs;
    this.initLocks = new Map();
    this.persistenceTimers = new Map();
    this.dirtyDocs = new Set();
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

        // Load persisted Yjs state if available
        if (docRecord.yjsState && docRecord.yjsState.length > 0) {
          try {
            Y.applyUpdate(ydoc, new Uint8Array(docRecord.yjsState));
            logger.info(`Loaded persisted Yjs state for ${docId} (${docRecord.yjsState.length} bytes)`);
          } catch (err) {
            logger.error(`Error applying persisted Yjs state for ${docId}:`, err);
          }
        } else if (docRecord.content) {
          // Hydrate from initial TipTap JSON if yjsState was empty
          try {
            const parsed = JSON.parse(docRecord.content);
            if (parsed && parsed.type === "doc" && Array.isArray(parsed.content)) {
              const xmlFragment = ydoc.getXmlFragment("default");
              for (const node of parsed.content) {
                if (node.type === "paragraph") {
                  const p = new Y.XmlElement("paragraph");
                  if (Array.isArray(node.content)) {
                    for (const textNode of node.content) {
                      if (textNode.type === "text" && typeof textNode.text === "string") {
                        const t = new Y.XmlText(textNode.text);
                        p.push([t]);
                      }
                    }
                  }
                  xmlFragment.push([p]);
                }
              }
            }
          } catch {
            // Ignore format errors on initial text parse
          }
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
   * Durably writes document state to PostgreSQL
   */
  async flushDocument(docId: string, ydoc: any): Promise<boolean> {
    if (!this.dirtyDocs.has(docId)) {
      return false;
    }
    this.dirtyDocs.delete(docId);

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
      // Re-mark as dirty so next flush will retry
      this.dirtyDocs.add(docId);
      return false;
    }
  }

  /**
   * Flushes all pending documents to PostgreSQL (used on shutdown or disconnects)
   */
  async flushAll(): Promise<void> {
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
    await Promise.all(promises);
    logger.info("All dirty documents flushed to PostgreSQL.");
  }
}

export const documentManager = new DocumentManager();
