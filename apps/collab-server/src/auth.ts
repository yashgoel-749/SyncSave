import * as dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";

export interface CollabTokenPayload {
  userId: string;
  name: string | null;
  email: string;
  documentId: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  color?: string;
  exp: number; // Unix timestamp in ms
}

const PARTICIPANT_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#14b8a6", // teal
  "#a855f7", // purple
  "#6366f1", // indigo
];

export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PARTICIPANT_COLORS.length;
  return PARTICIPANT_COLORS[index];
}

export function getCollabSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "syncspace-collab-secret-2026"
  );
}

export function signCollabToken(
  payload: CollabTokenPayload,
  secret = getCollabSecret()
): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

export function verifyCollabToken(
  token: string,
  secret = getCollabSecret()
): CollabTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [data, signature] = parts;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("base64url");
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return null;
    }
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8")
    ) as CollabTokenPayload;
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
