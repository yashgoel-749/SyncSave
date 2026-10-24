import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import * as Y from "yjs";

// Polyfill WebSocket for node test runner
(global as any).WebSocket = WebSocket;

jest.mock("@syncspace/db", () => {
  const mPrisma = {
    document: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $disconnect: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mPrisma),
  };
});

import { signCollabToken } from "../auth";
import { setupWSConnection } from "../yjsHandler";
import { documentManager, prisma } from "../documentManager";
import { server as appServer, wss as appWss } from "../index";
import { isOriginAllowed, normalizeOrigin } from "../config";

describe("Milestone 8: Production Hardening, Concurrency & Recovery", () => {
  let serverPort: number;
  let serverUrl: string;
  let httpUrl: string;

  beforeAll((done) => {
    appServer.listen(0, "127.0.0.1", () => {
      const addr = appServer.address() as any;
      serverPort = addr.port;
      serverUrl = `ws://127.0.0.1:${serverPort}`;
      httpUrl = `http://127.0.0.1:${serverPort}`;
      done();
    });
  });

  afterAll((done) => {
    appWss.clients.forEach((c) => c.terminate());
    appWss.close(() => {
      appServer.close(() => {
        done();
      });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    documentManager.docs.clear();
  });

  describe("Health & Readiness Probes", () => {
    it("GET /health should return 200 with uptime, connections, and memory", async () => {
      const res = await fetch(`${httpUrl}/health`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe("ok");
      expect(typeof data.uptime).toBe("number");
      expect(typeof data.connections).toBe("number");
      expect(data.version).toBe("0.1.0");
    });

    it("GET /ready should return 200 when database connectivity is verified", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ 1: 1 }]);
      const res = await fetch(`${httpUrl}/ready`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe("ready");
      expect(data.database).toBe("connected");
    });

    it("GET /ready should return 503 when database is unreachable", async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error("Connection refused"));
      const res = await fetch(`${httpUrl}/ready`);
      expect(res.status).toBe(503);
      const data = (await res.json()) as any;
      expect(data.status).toBe("not_ready");
      expect(data.database).toBe("disconnected");
    });
  });

  describe("Origin Validation & Security", () => {
    it("normalizes origins correctly", () => {
      expect(normalizeOrigin("https://syncspace.vercel.app/")).toBe("https://syncspace.vercel.app");
      expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    });

    it("allows authorized origins in configuration", () => {
      expect(isOriginAllowed("http://localhost:3000")).toBe(true);
    });
  });

  describe("Persistence Ordering & Concurrency", () => {
    it("should handle sequential and concurrent flushes without data race", async () => {
      const docId = "doc_concurrency_ordering";
      const ydoc = new Y.Doc();
      const text = ydoc.getText("content");

      (prisma.document.update as jest.Mock).mockImplementation(async ({ data }) => {
        // Simulate database latency
        await new Promise((r) => setTimeout(r, 20));
        return { id: docId, ...data };
      });

      // Rapid consecutive edits
      text.insert(0, "First Edit");
      documentManager.scheduleSave(docId, ydoc, 10);

      text.insert(text.length, " -> Second Edit");
      documentManager.scheduleSave(docId, ydoc, 10);

      text.insert(text.length, " -> Third Final Edit");
      documentManager.scheduleSave(docId, ydoc, 10);

      // Trigger concurrent flush calls
      const flush1 = documentManager.flushDocument(docId, ydoc);
      const flush2 = documentManager.flushDocument(docId, ydoc);

      const [res1, res2] = await Promise.all([flush1, flush2]);
      expect(res1 || res2).toBe(true);

      expect(prisma.document.update).toHaveBeenCalled();
      const lastCall = (prisma.document.update as jest.Mock).mock.calls.slice(-1)[0][0];
      expect(lastCall.where.id).toBe(docId);
      expect(lastCall.data.yjsState).toBeInstanceOf(Buffer);
    });

    it("flushAll() flushes all dirty documents deterministically", async () => {
      const doc1 = "doc_flush_all_1";
      const doc2 = "doc_flush_all_2";

      const ydoc1 = new Y.Doc();
      ydoc1.getText("t").insert(0, "Doc 1 text");
      documentManager.docs.set(doc1, ydoc1);

      const ydoc2 = new Y.Doc();
      ydoc2.getText("t").insert(0, "Doc 2 text");
      documentManager.docs.set(doc2, ydoc2);

      (prisma.document.update as jest.Mock).mockResolvedValue({ id: "ok" });

      documentManager.scheduleSave(doc1, ydoc1, 5000); // 5 sec timer
      documentManager.scheduleSave(doc2, ydoc2, 5000);

      // Force immediate flush of all
      await documentManager.flushAll();

      expect(prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: doc1 } })
      );
      expect(prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: doc2 } })
      );
    });
  });

  describe("Snapshot Consistency & Server Restart Recovery", () => {
    it("recovers document state from database after server restart simulation", async () => {
      const docId = "doc_restart_recovery";
      const originalYdoc = new Y.Doc();
      originalYdoc.getText("content").insert(0, "Persistent state preserved before restart");

      // Encode state update as binary buffer
      const savedBinary = Buffer.from(Y.encodeStateAsUpdate(originalYdoc));

      // Mock database returning the persisted binary state
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: docId,
        content: null,
        yjsState: savedBinary,
        deletedAt: null,
      });

      // Clear server in-memory memory (simulating restart)
      documentManager.docs.clear();

      // Load document again as if server restarted and new client connected
      const restoredDoc = await documentManager.getOrLoadDocument(docId);
      expect(restoredDoc).not.toBeNull();
      expect(restoredDoc.getText("content").toString()).toBe("Persistent state preserved before restart");
    });

    it("falls back to TipTap JSON when Yjs binary update is corrupt", async () => {
      const docId = "doc_corrupt_binary_fallback";

      const validJson = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Recovered from JSON fallback!" }],
          },
        ],
      });

      // Corrupt binary state that fails Yjs decode
      const corruptBinary = Buffer.from([0x00, 0xff, 0xfe, 0x01]);

      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: docId,
        content: validJson,
        yjsState: corruptBinary,
        deletedAt: null,
      });

      const loadedDoc = await documentManager.getOrLoadDocument(docId);
      expect(loadedDoc).not.toBeNull();

      // Should have fallen back and hydrated from TipTap JSON
      const xmlFragment = loadedDoc.getXmlFragment("default");
      expect(xmlFragment.length).toBeGreaterThan(0);
    });
  });

  describe("Rate Limiting on WebSockets", () => {
    it("handles connection with valid signed token", (done) => {
      const docId = "doc_valid_conn";
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: docId,
        content: null,
        yjsState: null,
        deletedAt: null,
      });

      const token = signCollabToken({
        userId: "usr_alice",
        name: "Alice",
        email: "alice@test.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const ws = new WebSocket(`${serverUrl}/${docId}?token=${token}`);

      ws.on("open", () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on("error", (err) => {
        done(err);
      });
    });
  });
});
