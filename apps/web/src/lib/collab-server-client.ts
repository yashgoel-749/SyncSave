import { getCollabSecret } from "./collab-token";

function getCollabHttpUrl(): string {
  if (process.env.COLLAB_INTERNAL_URL) {
    return process.env.COLLAB_INTERNAL_URL.replace(/\/$/, "");
  }
  const defaultWs =
    process.env.NODE_ENV === "production"
      ? "wss://syncsave-collab.onrender.com"
      : "ws://localhost:1234";
  const wsUrl = process.env.NEXT_PUBLIC_COLLAB_WS_URL || defaultWs;
  return wsUrl.replace(/^ws:\/\//i, "http://").replace(/^wss:\/\//i, "https://").replace(/\/$/, "");
}

/**
 * Notifies the collaboration server that a user's access has been revoked.
 * Collab server will immediately terminate all active WebSockets for that user in the room.
 */
export async function notifyCollabServerRevoke(documentId: string, userId: string): Promise<boolean> {
  try {
    const url = `${getCollabHttpUrl()}/internal/rooms/${encodeURIComponent(documentId)}/revoke`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getCollabSecret()}`,
      },
      body: JSON.stringify({ userId }),
    });
    return res.ok;
  } catch (err) {
    // If collab server is down or unreachable, fail gracefully (database permission is already revoked)
    console.warn("Failed to notify collab server of permission revocation:", err);
    return false;
  }
}

/**
 * Notifies the collaboration server that a user's role has changed (e.g. EDITOR -> VIEWER).
 * Collab server updates the connection role to enforce viewer restrictions immediately.
 */
export async function notifyCollabServerRoleUpdate(
  documentId: string,
  userId: string,
  role: "EDITOR" | "VIEWER"
): Promise<boolean> {
  try {
    const url = `${getCollabHttpUrl()}/internal/rooms/${encodeURIComponent(documentId)}/update-role`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getCollabSecret()}`,
      },
      body: JSON.stringify({ userId, role }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to notify collab server of role change:", err);
    return false;
  }
}
