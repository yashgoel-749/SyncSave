/**
 * Pure utility functions for SyncSpace web app.
 * No framework imports — safe for server and client.
 */

/**
 * Generates a display-friendly document title, falling back to "Untitled"
 * if the provided title is blank.
 */
export function resolveDocumentTitle(title: string | null | undefined): string {
  const trimmed = (title ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Untitled";
}

/**
 * Truncates a string to `maxLength` characters, appending an ellipsis if
 * the string was actually shortened.
 */
export function truncate(text: string, maxLength: number): string {
  if (maxLength < 1) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + "…";
}

/**
 * Formats a Date (or ISO string) as a human-readable relative string,
 * e.g. "just now", "5 min ago", "3 days ago".
 */
export function relativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
