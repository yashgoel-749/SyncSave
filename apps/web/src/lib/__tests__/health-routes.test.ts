import { GET as healthGet } from "@/app/api/health/route";
import { GET as readyGet } from "@/app/api/ready/route";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn(),
  },
}));

import prisma from "@/lib/prisma";

describe("Health & Readiness Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/health", () => {
    it("returns 200 with service status and timestamp", async () => {
      const res = await healthGet();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(json.service).toBe("@syncspace/web");
      expect(json.timestamp).toBeDefined();
    });
  });

  describe("GET /api/ready", () => {
    it("returns 200 when database query succeeds", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ 1: 1 }]);
      const res = await readyGet();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ready");
      expect(json.database).toBe("connected");
    });

    it("returns 503 when database query fails", async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error("Connection timeout"));
      const res = await readyGet();
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.status).toBe("not_ready");
      expect(json.database).toBe("disconnected");
    });
  });
});
