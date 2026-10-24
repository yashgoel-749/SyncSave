import { checkRateLimit, resetRateLimitStore, getClientIp, rateLimitResponse } from "../rate-limiter";

describe("rate-limiter utility", () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it("should allow requests within limit", () => {
    const res1 = checkRateLimit("test-key", 3, 1000);
    expect(res1.success).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = checkRateLimit("test-key", 3, 1000);
    expect(res2.success).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = checkRateLimit("test-key", 3, 1000);
    expect(res3.success).toBe(true);
    expect(res3.remaining).toBe(0);
  });

  it("should reject requests exceeding limit", () => {
    checkRateLimit("ip-1", 2, 10000);
    checkRateLimit("ip-1", 2, 10000);

    const blocked = checkRateLimit("ip-1", 2, 10000);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(2);
  });

  it("should isolate different keys", () => {
    checkRateLimit("user-A", 1, 10000);
    const blockedA = checkRateLimit("user-A", 1, 10000);
    expect(blockedA.success).toBe(false);

    const allowedB = checkRateLimit("user-B", 1, 10000);
    expect(allowedB.success).toBe(true);
  });

  it("should extract client IP from x-forwarded-for header", () => {
    const req = new Request("http://localhost/api/test", {
      headers: {
        "x-forwarded-for": "203.0.113.195, 70.41.3.18",
      },
    });
    expect(getClientIp(req)).toBe("203.0.113.195");
  });

  it("should extract client IP from x-real-ip header", () => {
    const req = new Request("http://localhost/api/test", {
      headers: {
        "x-real-ip": "198.51.100.42",
      },
    });
    expect(getClientIp(req)).toBe("198.51.100.42");
  });

  it("should format standard 429 response with rate limit headers", () => {
    const limitResult = {
      success: false,
      limit: 10,
      remaining: 0,
      reset: Math.ceil(Date.now() / 1000) + 60,
    };
    const response = rateLimitResponse(limitResult, "Rate limit exceeded");
    expect(response.status).toBe(429);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("Retry-After")).toBeDefined();
  });
});
