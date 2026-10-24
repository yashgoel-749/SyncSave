import { NextResponse } from "next/server";

interface RateLimitRecord {
  timestamps: number[];
}

// In-memory sliding window store
const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < 600000); // retain max 10 min
      if (record.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }, 300000).unref?.();
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
}

/**
 * Sliding window in-memory rate limiter.
 * @param key Unique key for the rate limit subject (e.g. `register:${ip}`)
 * @param limit Max allowed requests within the window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    rateLimitStore.set(key, record);
  }

  // Filter timestamps within current sliding window
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  const currentCount = record.timestamps.length;
  const reset = Math.ceil((now + windowMs) / 1000);

  if (currentCount >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      reset,
    };
  }

  record.timestamps.push(now);

  return {
    success: true,
    limit,
    remaining: Math.max(0, limit - record.timestamps.length),
    reset,
  };
}

/**
 * Extracts client IP address from Next.js / Vercel request headers.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

/**
 * Creates standard HTTP 429 Rate Limit Exceeded response with headers.
 */
export function rateLimitResponse(result: RateLimitResult, message = "Too many requests. Please try again later."): NextResponse {
  const retryAfter = Math.max(1, result.reset - Math.ceil(Date.now() / 1000));
  return NextResponse.json(
    {
      error: message,
      retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset),
      },
    }
  );
}

/**
 * Resets the in-memory store (primarily for unit tests).
 */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}
