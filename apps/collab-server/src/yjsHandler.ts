import * as http from "http";
import WebSocket from "ws";
import { verifyCollabToken } from "./auth";
import { documentManager } from "./documentManager";
import { logger } from "./logger";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupWSConnection: yjsSetup } = require("y-websocket/bin/utils") as {
  setupWSConnection: (ws: WebSocket, req: http.IncomingMessage, opts?: unknown) => void;
};

/**
 * Parses and verifies incoming WebSocket connection for collaborative editing.
 * Enforces token authentication, document room authorization,
 * coordinated first-connection loading from PostgreSQL, and cleanup on disconnect.
 */
export async function handleWSConnection(
  ws: WebSocket,
  req: http.IncomingMessage
): Promise<void> {
  try {
    const url = new URL(req.url || "", "http://localhost");
    const rawPath = url.pathname.replace(/^\//, "");
    const docId = rawPath.startsWith("documents/")
      ? rawPath.slice("documents/".length)
      : rawPath;
    const token = url.searchParams.get("token");

    if (!docId) {
      logger.warn("WebSocket rejected: missing documentId in path");
      ws.close(4400, "Missing documentId");
      return;
    }

    if (!token) {
      logger.warn(`WebSocket rejected for ${docId}: missing auth token`);
      ws.close(4401, "Authentication token required");
      return;
    }

    // 1. Verify signed token & room authorization
    const tokenPayload = verifyCollabToken(token);
    if (!tokenPayload) {
      logger.warn(`WebSocket rejected for ${docId}: invalid or expired token`);
      ws.close(4401, "Invalid or expired token");
      return;
    }

    if (tokenPayload.documentId !== docId) {
      logger.warn(
        `WebSocket rejected for ${docId}: token documentId (${tokenPayload.documentId}) mismatch`
      );
      ws.close(4403, "Token not authorized for this document room");
      return;
    }

    // 2. Coordinated first-connection loading (prevents race condition)
    const ydoc = await documentManager.getOrLoadDocument(docId);
    if (!ydoc) {
      logger.warn(`WebSocket rejected for ${docId}: document not found or deleted`);
      ws.close(4404, "Document not found or inaccessible");
      return;
    }

    logger.info(
      `Authorized connection for user ${tokenPayload.userId} (${tokenPayload.role}) in document ${docId}`
    );

    // 3. Delegate to y-websocket for Yjs synchronization and Awareness protocol
    yjsSetup(ws, req, { docName: docId });

    // 4. On disconnect: if no active connections remain in room, flush changes to DB
    ws.on("close", () => {
      logger.info(`Connection closed for user ${tokenPayload.userId} on ${docId}`);
      if (ydoc.conns && ydoc.conns.size === 0) {
        documentManager.flushDocument(docId, ydoc).catch((err) => {
          logger.error(`Error flushing document ${docId} on empty room:`, err);
        });
      }
    });
  } catch (error) {
    logger.error("Unexpected error handling WS connection:", error);
    ws.close(1011, "Internal server error");
  }
}

// Backward-compatible export
export function setupWSConnection(ws: WebSocket, req: http.IncomingMessage): void {
  handleWSConnection(ws, req);
}
