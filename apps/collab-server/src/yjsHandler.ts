import * as http from "http";
import WebSocket from "ws";
import { verifyCollabToken } from "./auth";
import { documentManager } from "./documentManager";
import { logger } from "./logger";
import { config } from "./config";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupWSConnection: yjsSetup } = require("y-websocket/bin/utils") as {
  setupWSConnection: (ws: WebSocket, req: http.IncomingMessage, opts?: unknown) => void;
};

interface ActiveConnection {
  ws: WebSocket;
  userId: string;
  ip: string;
  roleRef: { role: "OWNER" | "EDITOR" | "VIEWER" };
}

// Map: docId -> Set of ActiveConnection
const activeConnections = new Map<string, Set<ActiveConnection>>();

// Map: IP -> count of active connections
const connectionsByIp = new Map<string, number>();

export function getActiveConnectionCount(): number {
  let count = 0;
  for (const set of activeConnections.values()) {
    count += set.size;
  }
  return count;
}

export function getActiveRoomCount(): number {
  return activeConnections.size;
}

export function getIpConnectionCount(ip: string): number {
  return connectionsByIp.get(ip) ?? 0;
}

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
 * Parses client IP address from request headers or socket.
 */
export function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

/**
 * Closes all active connections gracefully with code 1001 (Server going away).
 */
export function closeAllConnections(code = 1001, reason = "Server shutting down"): number {
  let closed = 0;
  for (const [, conns] of activeConnections) {
    for (const conn of conns) {
      try {
        conn.ws.close(code, reason);
        closed++;
      } catch {
        // Socket may already be closed
      }
    }
  }
  activeConnections.clear();
  connectionsByIp.clear();
  return closed;
}

/**
 * Converts an incoming ws message payload into a Uint8Array view (no copy when possible).
 */
function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw instanceof Uint8Array) return raw;
  if (Buffer.isBuffer(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return null;
}

/**
 * Parses and verifies incoming WebSocket connection for collaborative editing.
 * Enforces rate limiting, connection limits, token authentication,
 * document room authorization, viewer write restrictions, and coordinated loading.
 */
export async function handleWSConnection(
  ws: WebSocket,
  req: http.IncomingMessage
): Promise<void> {
  const clientIp = getClientIp(req);

  try {
    // 1. Connection Limits Check
    const totalConnections = getActiveConnectionCount();
    if (totalConnections >= config.maxConnections) {
      logger.warn(`Rejected WebSocket from ${clientIp}: server connection limit (${config.maxConnections}) reached`);
      ws.close(1013, "Server overloaded. Please retry shortly.");
      return;
    }

    const currentIpConns = getIpConnectionCount(clientIp);
    if (currentIpConns >= config.maxConnectionsPerIp) {
      logger.warn(`Rejected WebSocket from ${clientIp}: per-IP limit (${config.maxConnectionsPerIp}) exceeded`);
      ws.close(4429, "Too many connections from your IP address");
      return;
    }

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

    // 2. Verify signed token & room authorization
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

    // Buffer early messages arriving before async document hydration completes,
    // and remember if the client went away while we were loading.
    const earlyMessages: Array<{ data: any; isBinary: boolean }> = [];
    let closedWhileLoading = false;
    const earlyMsgHandler = (data: any, isBinary: boolean) => {
      earlyMessages.push({ data, isBinary });
    };
    const earlyCloseHandler = () => {
      closedWhileLoading = true;
    };
    ws.on("message", earlyMsgHandler);
    ws.once("close", earlyCloseHandler);

    // 3. Coordinated first-connection loading (prevents race condition)
    let ydoc: any;
    try {
      ydoc = await documentManager.getOrLoadDocument(docId);
    } finally {
      ws.off("message", earlyMsgHandler);
      ws.off("close", earlyCloseHandler);
    }

    if (closedWhileLoading || ws.readyState !== WebSocket.OPEN) {
      logger.info(`Client for ${docId} disconnected before hydration completed; skipping registration`);
      if (ydoc && ydoc.conns && ydoc.conns.size === 0) {
        void documentManager.releaseIfIdle(docId, ydoc);
      }
      return;
    }

    if (!ydoc) {
      logger.warn(`WebSocket rejected for ${docId}: document not found or deleted`);
      ws.close(4404, "Document not found or inaccessible");
      return;
    }

    logger.info(
      `Authorized connection for user ${tokenPayload.userId} (${tokenPayload.role}) in document ${docId}`
    );

    // 4. Track active connection and increment IP count
    const roleRef: { role: "OWNER" | "EDITOR" | "VIEWER" } = {
      role: tokenPayload.role as "OWNER" | "EDITOR" | "VIEWER",
    };
    const activeConn: ActiveConnection = {
      ws,
      userId: tokenPayload.userId,
      ip: clientIp,
      roleRef,
    };

    if (!activeConnections.has(docId)) {
      activeConnections.set(docId, new Set());
    }
    activeConnections.get(docId)!.add(activeConn);
    connectionsByIp.set(clientIp, (connectionsByIp.get(clientIp) ?? 0) + 1);

    // 5. Message Rate Limiting per WebSocket connection
    let messageCount = 0;
    let windowStart = Date.now();

    // 6. Intercept incoming messages: enforce Viewer restrictions and rate limits
    const originalEmit = ws.emit.bind(ws);
    ws.emit = function (event: string, ...args: unknown[]): boolean {
      if (event === "message") {
        const now = Date.now();
        if (now - windowStart > 1000) {
          messageCount = 0;
          windowStart = now;
        }
        messageCount++;

        // Drop messages exceeding rate limit
        if (messageCount > config.messageRateLimitPerSec) {
          if (messageCount === config.messageRateLimitPerSec + 1) {
            logger.warn(`Throttling messages from user ${tokenPayload.userId} (${messageCount} msg/sec)`);
          }
          // Terminate abusive connection if flooding 2x limit
          if (messageCount > config.messageRateLimitPerSec * 2) {
            logger.warn(`Closing connection for abusive message rate from user ${tokenPayload.userId}`);
            ws.close(4429, "Rate limit exceeded");
          }
          return false;
        }

        // Viewer write protection
        if (roleRef.role === "VIEWER") {
          const bytes = toBytes(args[0]);

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
      }
      return originalEmit(event, ...args);
    };

    // 7. Delegate to y-websocket for Yjs synchronization and Awareness protocol
    yjsSetup(ws, req, { docName: docId });

    // 7b. Replay any early messages received before document loading finished
    for (const msg of earlyMessages) {
      ws.emit("message", msg.data, msg.isBinary);
    }

    // 8. On disconnect: cleanup connection registry and flush changes if room is empty
    ws.on("close", () => {
      logger.info(`Connection closed for user ${tokenPayload.userId} on ${docId}`);

      // Decrement IP count
      const currentCount = connectionsByIp.get(clientIp) ?? 1;
      if (currentCount <= 1) {
        connectionsByIp.delete(clientIp);
      } else {
        connectionsByIp.set(clientIp, currentCount - 1);
      }

      // Cleanup room connection
      const roomConns = activeConnections.get(docId);
      if (roomConns) {
        roomConns.delete(activeConn);
        if (roomConns.size === 0) {
          activeConnections.delete(docId);
        }
      }

      if (ydoc.conns && ydoc.conns.size === 0) {
        void documentManager.releaseIfIdle(docId, ydoc);
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
