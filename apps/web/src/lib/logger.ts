type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info") as LogLevel;

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = new Set([
  "token",
  "authtoken",
  "collabtoken",
  "password",
  "passwordhash",
  "secret",
  "authsecret",
  "jwt",
  "database_url",
  "direct_url",
  "authorization",
  "cookie",
  "content",
  "yjsstate",
]);

export function sanitizeWebValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 5) return "[MAX_DEPTH]";

  const lowerKey = key.toLowerCase();

  if (SENSITIVE_KEYS.has(lowerKey)) {
    if (lowerKey === "content" || lowerKey === "yjsstate") {
      return "[REDACTED_DOCUMENT_DATA]";
    }
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    // Redact query parameter tokens
    let sanitized = value.replace(
      /([?&](?:token|secret|password|key)=)[^&]+/gi,
      "$1[REDACTED]"
    );
    // Redact Bearer tokens
    sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9_.-]+/gi, "$1[REDACTED]");
    // Redact database credentials
    sanitized = sanitized.replace(/(:\/\/[^:]+:)([^@]+)(@)/g, "$1[REDACTED]$3");
    return sanitized;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeWebValue("message", value.message, depth + 1),
      stack: process.env.NODE_ENV === "production" ? undefined : value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item, idx) => sanitizeWebValue(String(idx), item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      cleaned[k] = sanitizeWebValue(k, v, depth + 1);
    }
    return cleaned;
  }

  return value;
}

function writeLog(level: LogLevel, message: string, meta?: unknown): void {
  if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message: typeof message === "string" ? sanitizeWebValue("message", message) : message,
  };

  if (meta !== undefined) {
    entry.meta = sanitizeWebValue("meta", meta);
  }

  const out = JSON.stringify(entry);

  if (level === "error" || level === "warn") {
    console.error(out);
  } else {
    console.log(out);
  }
}

export const webLogger = {
  debug: (msg: string, meta?: unknown) => writeLog("debug", msg, meta),
  info: (msg: string, meta?: unknown) => writeLog("info", msg, meta),
  warn: (msg: string, meta?: unknown) => writeLog("warn", msg, meta),
  error: (msg: string, meta?: unknown) => writeLog("error", msg, meta),
};
