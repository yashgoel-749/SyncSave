import * as http from "http";
import WebSocket from "ws";
import { verifyCollabToken } from "./auth";
import { documentManager } from "./documentManager";
import { logger } from "./logger";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupWSConnection: yjsSetup } = require("y-websocket/bin/utils") as {
  setupWSConnection: (ws: WebSocket, req: http.IncomingMessage, opts?: unknown) => void;
};

interface ActiveConnection {
  ws: WebSocket;
  userId: string;
  roleRef: { role: "OWNER" | "EDITOR" | "VIEWER" };
}

// Map: docId -> Set of ActiveConnection
const activeConnections = new Map<string, Set<ActiveConnection>>();

/**
 * Revokes all active WebSocket connections for a user in a specific document room.
 * Closes the socket immediately with close code 4403 (Permission revoked).
 */
export function revokeUserConnections(docId: string, userId: string): number {
  const roomConns = activeConnections.get(docId);
  if (!roomConns) return 0;

  let closedCount = 0;
  for (const conn of Array.from(roomConns)) {
    if (conn.userId === userId) {
      logger.info(`Evicting revoked user ${userId} from document room ${docId}`);
      try {
        conn.ws.close(4403, "Permission revoked");
      } catch (err) {
        logger.warn(`Error closing socket for revoked user ${userId}:`, err);
      }
      roomConns.delete(conn);
      closedCount++;
    }
  }
  return closedCount;
}

/**
 * Updates the active role for a user in a specific document room (e.g. EDITOR -> VIEWER).
 * If downgraded to VIEWER, viewer write restrictions take effect immediately.
 */
export function updateUserRole(
  docId: string,
  userId: string,
  newRole: "EDITOR" | "VIEWER"
): number {
  const roomConns = activeConnections.get(docId);
  if (!roomConns) return 0;

  let updatedCount = 0;
  for (const conn of roomConns) {
    if (conn.userId === userId) {
      logger.info(
        `Updating live role for user ${userId} in ${docId} from ${conn.roleRef.role} to ${newRole}`
      );
      conn.roleRef.role = newRole;
      updatedCount++;
    }
  }
  return updatedCount;
}

/**
 * Parses and verifies incoming WebSocket connection for collaborative editing.
 * Enforces token authentication, document room authorization,
 * viewer write restrictions, coordinated first-connection loading from PostgreSQL,
 * and live permission revocation tracking.
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

    // 3. Track active connection for live permission revocation & role updates
    const roleRef: { role: "OWNER" | "EDITOR" | "VIEWER" } = {
      role: tokenPayload.role as "OWNER" | "EDITOR" | "VIEWER",
    };
    const activeConn: ActiveConnection = {
      ws,
      userId: tokenPayload.userId,
      roleRef,
    };

    if (!activeConnections.has(docId)) {
      activeConnections.set(docId, new Set());
    }
    activeConnections.get(docId)!.add(activeConn);

    // 4. Enforce Viewer restrictions: intercept messages to prevent document mutations
    // In Yjs protocol:
    // messageType 0 = messageSync (syncStep1=0 read query, syncStep2=1 update, syncUpdate=2 update)
    // messageType 1 = messageAwareness (cursors/presence)
    const originalEmit = ws.emit.bind(ws);
    ws.emit = function (event: string, ...args: unknown[]): boolean {
      if (event === "message" && roleRef.role === "VIEWER") {
        const raw = args[0];
        const bytes =
          raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : raw instanceof Uint8Array
            ? raw
            : Buffer.isBuffer(raw)
            ? new Uint8Array(raw)
            : null;

        if (bytes && bytes.length > 1) {
          const messageType = bytes[0];
          if (messageType === 0) {
            // messageSync
            const syncType = bytes[1];
            if (syncType === 1 || syncType === 2) {
              // syncStep2 or syncUpdate: viewer trying to submit document changes
              logger.warn(
                `Blocked document modification attempt by VIEWER ${tokenPayload.userId} on ${docId}`
              );
              return false; // Drop update without applying to shared Y.Doc
            }
          }
        }
      }
      return originalEmit(event, ...args);
    };

    // 5. Delegate to y-websocket for Yjs synchronization and Awareness protocol
    yjsSetup(ws, req, { docName: docId });

    // 6. On disconnect: cleanup connection registry and flush changes if room is empty
    ws.on("close", () => {
      logger.info(`Connection closed for user ${tokenPayload.userId} on ${docId}`);

      const roomConns = activeConnections.get(docId);
      if (roomConns) {
        roomConns.delete(activeConn);
        if (roomConns.size === 0) {
          activeConnections.delete(docId);
        }
      }

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
