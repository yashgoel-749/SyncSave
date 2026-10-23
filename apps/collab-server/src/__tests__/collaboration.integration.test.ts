import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import * as Y from "yjs";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WebsocketProvider } = require("y-websocket");

// Polyfill WebSocket for node test runner
(global as any).WebSocket = WebSocket;

jest.mock("@syncspace/db", () => {
  const mPrisma = {
    document: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    PrismaClient: jest.fn(() => mPrisma),
  };
});

import { signCollabToken } from "../auth";
import { setupWSConnection, revokeUserConnections, updateUserRole } from "../yjsHandler";
import { documentManager, prisma } from "../documentManager";

describe("Real-time Collaboration & Synchronization Integration Tests", () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let serverPort: number;
  let serverUrl: string;

  beforeAll((done) => {
    server = http.createServer();
    wss = new WebSocketServer({ server });

    wss.on("connection", (ws, req) => {
      setupWSConnection(ws, req);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      serverPort = addr.port;
      serverUrl = `ws://127.0.0.1:${serverPort}`;
      done();
    });
  });

  afterAll((done) => {
    wss.clients.forEach((c) => c.terminate());
    wss.close(() => {
      server.close(() => {
        done();
      });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    documentManager.docs.clear();
  });

  describe("Authentication & Room Access Control", () => {
    it("should reject connection when no token is provided", (done) => {
      const ws = new WebSocket(`${serverUrl}/doc_unauth`);

      ws.on("close", (code) => {
        expect(code).toBe(4401);
        done();
      });
    });

    it("should reject connection when token signature is invalid", (done) => {
      const ws = new WebSocket(`${serverUrl}/doc_invalid?token=fake.invalid_signature`);

      ws.on("close", (code) => {
        expect(code).toBe(4401);
        done();
      });
    });

    it("should reject connection when token documentId does not match room", (done) => {
      const token = signCollabToken({
        userId: "usr_alice",
        name: "Alice",
        email: "alice@test.dev",
        documentId: "doc_room_A",
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      // Connecting to doc_room_B with token for doc_room_A
      const ws = new WebSocket(`${serverUrl}/doc_room_B?token=${token}`);

      ws.on("close", (code) => {
        expect(code).toBe(4403);
        done();
      });
    });

    it("should reject connection when document is not found or deleted in DB", (done) => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const token = signCollabToken({
        userId: "usr_alice",
        name: "Alice",
        email: "alice@test.dev",
        documentId: "doc_404",
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const ws = new WebSocket(`${serverUrl}/doc_404?token=${token}`);

      ws.on("close", (code) => {
        expect(code).toBe(4404);
        done();
      });
    });
  });

  describe("Multi-Client Document Synchronization & Convergence", () => {
    it("should synchronize real-time concurrent edits between multiple independent clients", (done) => {
      const docId = "doc_multi_sync_1";

      (prisma.document.findUnique as jest.Mock).mockResolvedValue({
        id: docId,
        title: "Sprint Goals",
        content: null,
        yjsState: null,
        deletedAt: null,
      });

      const tokenAlice = signCollabToken({
        userId: "usr_alice",
        name: "Alice",
        email: "alice@sync.dev",
        documentId: docId,
        role: "OWNER",
        exp: Date.now() + 60000,
      });

      const tokenBob = signCollabToken({
        userId: "usr_bob",
        name: "Bob",
        email: "bob@sync.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const ydocA = new Y.Doc();
      const ydocB = new Y.Doc();

      const providerA = new WebsocketProvider(serverUrl, docId, ydocA, {
        params: { token: tokenAlice },
      });

      const providerB = new WebsocketProvider(serverUrl, docId, ydocB, {
        params: { token: tokenBob },
      });

      let aSynced = false;
      let bSynced = false;

      function checkReady() {
        if (!aSynced || !bSynced) return;

        // Both clients are connected. Let Alice and Bob edit simultaneously.
        const textA = ydocA.getText("content");
        const textB = ydocB.getText("content");

        textA.insert(0, "SyncSpace ");
        textB.insert(0, "Realtime ");

        // Allow round-trip synchronization
        setTimeout(() => {
          expect(textA.toString()).toBe(textB.toString());
          expect(textA.toString().length).toBeGreaterThan(0);
          expect(textA.toString()).toContain("SyncSpace");
          expect(textA.toString()).toContain("Realtime");

          providerA.destroy();
          providerB.destroy();
          ydocA.destroy();
          ydocB.destroy();
          done();
        }, 300);
      }

      providerA.on("sync", (synced: boolean) => {
        if (synced) {
          aSynced = true;
          checkReady();
        }
      });

      providerB.on("sync", (synced: boolean) => {
        if (synced) {
          bSynced = true;
          checkReady();
        }
      });
    });

    it("should handle simultaneous insertions, deletions, and converge deterministically", (done) => {
      const docId = "doc_convergence_test";

      (prisma.document.findUnique as jest.Mock).mockResolvedValue({
        id: docId,
        title: "Deterministic Convergence",
        content: null,
        yjsState: null,
        deletedAt: null,
      });

      const tokenA = signCollabToken({
        userId: "usr_1",
        name: "User 1",
        email: "u1@sync.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const tokenB = signCollabToken({
        userId: "usr_2",
        name: "User 2",
        email: "u2@sync.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const ydoc1 = new Y.Doc();
      const ydoc2 = new Y.Doc();

      const p1 = new WebsocketProvider(serverUrl, docId, ydoc1, {
        params: { token: tokenA },
      });
      const p2 = new WebsocketProvider(serverUrl, docId, ydoc2, {
        params: { token: tokenB },
      });

      let p1Synced = false;
      let p2Synced = false;

      function onBothSynced() {
        if (!p1Synced || !p2Synced) return;

        const text1 = ydoc1.getText("shared");
        const text2 = ydoc2.getText("shared");

        // Initial setup
        text1.insert(0, "ABCDEF");

        setTimeout(() => {
          // Client 1 deletes "CD" from index 2
          text1.delete(2, 2);
          // Client 2 inserts "123" at index 4 concurrently
          text2.insert(4, "123");

          setTimeout(() => {
            // CRDT convergence guarantee: both replicas MUST have identical content
            expect(text1.toString()).toBe(text2.toString());

            p1.destroy();
            p2.destroy();
            ydoc1.destroy();
            ydoc2.destroy();
            done();
          }, 350);
        }, 150);
      }

      p1.on("sync", (s: boolean) => {
        if (s) {
          p1Synced = true;
          onBothSynced();
        }
      });
      p2.on("sync", (s: boolean) => {
        if (s) {
          p2Synced = true;
          onBothSynced();
        }
      });
    });

    it("should propagate participant awareness and live cursor info between peers", (done) => {
      const docId = "doc_awareness_test";

      (prisma.document.findUnique as jest.Mock).mockResolvedValue({
        id: docId,
        title: "Awareness Room",
        content: null,
        yjsState: null,
        deletedAt: null,
      });

      const tokenA = signCollabToken({
        userId: "usr_alice",
        name: "Alice",
        email: "alice@test.dev",
        documentId: docId,
        role: "OWNER",
        exp: Date.now() + 60000,
      });

      const tokenB = signCollabToken({
        userId: "usr_bob",
        name: "Bob",
        email: "bob@test.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const ydocA = new Y.Doc();
      const ydocB = new Y.Doc();

      const pA = new WebsocketProvider(serverUrl, docId, ydocA, {
        params: { token: tokenA },
      });
      const pB = new WebsocketProvider(serverUrl, docId, ydocB, {
        params: { token: tokenB },
      });

      let pASynced = false;
      let pBSynced = false;
      let finished = false;

      function onReady() {
        if (!pASynced || !pBSynced) return;

        pB.awareness.on("change", () => {
          if (finished) return;
          const states = Array.from(pB.awareness.getStates().values());
          const aliceState: any = states.find((s: any) => s.user?.name === "Alice");
          if (aliceState && aliceState.user) {
            finished = true;
            expect(aliceState.user.name).toBe("Alice");
            expect(aliceState.user.color).toBe("#10b981");

            pA.destroy();
            pB.destroy();
            ydocA.destroy();
            ydocB.destroy();
            done();
          }
        });

        pA.awareness.setLocalStateField("user", {
          userId: "usr_alice",
          name: "Alice",
          color: "#10b981",
        });
      }

      pA.on("sync", (s: boolean) => {
        if (s) {
          pASynced = true;
          onReady();
        }
      });
      pB.on("sync", (s: boolean) => {
        if (s) {
          pBSynced = true;
          onReady();
        }
      });
    });
  });

  describe("Durability, Persistence & Server Restart Convergence", () => {
    it("should flush state to database and rehydrate document state after restart", async () => {
      const docId = "doc_persistence_durability";
      let capturedYjsState: Buffer | null = null;

      (prisma.document.findUnique as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          id: docId,
          title: "Durability Test",
          content: null,
          yjsState: capturedYjsState,
          deletedAt: null,
        })
      );

      (prisma.document.update as jest.Mock).mockImplementation(({ data }) => {
        if (data.yjsState) {
          capturedYjsState = data.yjsState;
        }
        return Promise.resolve({ id: docId, ...data });
      });

      const token = signCollabToken({
        userId: "usr_alice",
        name: "Alice",
        email: "alice@test.dev",
        documentId: docId,
        role: "OWNER",
        exp: Date.now() + 60000,
      });

      // 1. Initial session: Alice connects and writes content
      const ydocInitial = new Y.Doc();
      const pInitial = new WebsocketProvider(serverUrl, docId, ydocInitial, {
        params: { token },
      });

      await new Promise<void>((resolve) => {
        pInitial.on("sync", (synced: boolean) => {
          if (synced) resolve();
        });
      });

      ydocInitial.getText("notes").insert(0, "Durable Yjs Architecture 2026");

      // Wait a moment for server update event and manually flush
      await new Promise((r) => setTimeout(r, 100));
      await documentManager.flushAll();

      expect(prisma.document.update).toHaveBeenCalled();
      expect(capturedYjsState).not.toBeNull();

      pInitial.destroy();
      ydocInitial.destroy();

      // 2. Simulate Server Restart: Wipe server in-memory docs map
      documentManager.docs.clear();

      // 3. New Client connects to the restarted server: Must receive persisted edits
      const ydocReborn = new Y.Doc();
      const pReborn = new WebsocketProvider(serverUrl, docId, ydocReborn, {
        params: { token },
      });

      await new Promise<void>((resolve) => {
        pReborn.on("sync", (synced: boolean) => {
          if (synced) resolve();
        });
      });

      expect(ydocReborn.getText("notes").toString()).toBe("Durable Yjs Architecture 2026");

      pReborn.destroy();
      ydocReborn.destroy();
    });

    it("should converge deterministically without data loss when multiple clients edit while disconnected and reconnect", async () => {
      const docId = "doc_offline_convergence";
      let persistedYjsState: Buffer | null = null;

      (prisma.document.findUnique as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          id: docId,
          title: "Offline Convergence Test",
          content: null,
          yjsState: persistedYjsState,
          deletedAt: null,
        })
      );

      (prisma.document.update as jest.Mock).mockImplementation(({ data }) => {
        if (data.yjsState) {
          persistedYjsState = data.yjsState;
        }
        return Promise.resolve({ id: docId, ...data });
      });

      const tokenA = signCollabToken({
        userId: "usr_alice",
        name: "Alice",
        email: "alice@test.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const tokenB = signCollabToken({
        userId: "usr_bob",
        name: "Bob",
        email: "bob@test.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      // 1. Initial shared session: Alice connects and writes base text
      const ydocA = new Y.Doc();
      const pA1 = new WebsocketProvider(serverUrl, docId, ydocA, { params: { token: tokenA } });

      await new Promise<void>((resolve) => {
        pA1.on("sync", (synced: boolean) => {
          if (synced) resolve();
        });
      });

      ydocA.getText("notes").insert(0, "BaseDocument");

      // Bob connects and synchronizes base state
      const ydocB = new Y.Doc();
      const pB1 = new WebsocketProvider(serverUrl, docId, ydocB, { params: { token: tokenB } });

      await new Promise<void>((resolve) => {
        pB1.on("sync", (synced: boolean) => {
          if (synced) resolve();
        });
      });

      expect(ydocB.getText("notes").toString()).toBe("BaseDocument");

      // 2. Both clients disconnect from the network
      pA1.destroy();
      pB1.destroy();

      // 3. Both clients perform edits while disconnected (offline)
      // Alice appends text
      ydocA.getText("notes").insert(ydocA.getText("notes").length, " + AliceOffline");
      // Bob prepends text
      ydocB.getText("notes").insert(0, "BobOffline + ");

      expect(ydocA.getText("notes").toString()).toBe("BaseDocument + AliceOffline");
      expect(ydocB.getText("notes").toString()).toBe("BobOffline + BaseDocument");

      // 4. Clients reconnect to the server (simulating network return)
      const pA2 = new WebsocketProvider(serverUrl, docId, ydocA, { params: { token: tokenA } });
      const pB2 = new WebsocketProvider(serverUrl, docId, ydocB, { params: { token: tokenB } });

      await Promise.all([
        new Promise<void>((resolve) => {
          pA2.on("sync", (synced: boolean) => {
            if (synced) resolve();
          });
        }),
        new Promise<void>((resolve) => {
          pB2.on("sync", (synced: boolean) => {
            if (synced) resolve();
          });
        }),
      ]);

      // Allow a brief tick for cross-client broadcast exchange
      await new Promise((r) => setTimeout(r, 200));

      const finalTextA = ydocA.getText("notes").toString();
      const finalTextB = ydocB.getText("notes").toString();
      const serverDoc = documentManager.docs.get(docId);
      const finalServerText = serverDoc ? serverDoc.getText("notes").toString() : "";

      // 5. Assert: Both clients and server converge deterministically to the identical state
      expect(finalTextA).toBe(finalTextB);
      expect(finalTextA).toBe(finalServerText);

      // Verify that neither edit was overwritten or lost
      expect(finalTextA).toContain("BobOffline");
      expect(finalTextA).toContain("BaseDocument");
      expect(finalTextA).toContain("AliceOffline");

      // Flush to DB and verify durable persistence
      await documentManager.flushAll();
      expect(persistedYjsState).not.toBeNull();

      pA2.destroy();
      pB2.destroy();
      ydocA.destroy();
      ydocB.destroy();
    });
  });

  describe("Role-Based Restrictions & Permission Eviction", () => {
    it("should immediately disconnect revoked user with code 4403 when permissions are revoked", (done) => {
      const docId = "doc_revocation_test";
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: docId,
        content: null,
        yjsState: null,
        deletedAt: null,
      });

      const token = signCollabToken({
        userId: "usr_revoked",
        name: "Revoked User",
        email: "revoked@test.dev",
        documentId: docId,
        role: "EDITOR",
        exp: Date.now() + 60000,
      });

      const ws = new WebSocket(`${serverUrl}/${docId}?token=${token}`);

      ws.on("open", () => {
        // Wait a small moment to ensure connection registration
        setTimeout(() => {
          // Trigger revocation on collab server
          const count = revokeUserConnections(docId, "usr_revoked");
          expect(count).toBeGreaterThanOrEqual(1);
        }, 50);
      });

      ws.on("close", (code, reason) => {
        expect(code).toBe(4403);
        expect(reason.toString()).toContain("Permission revoked");
        done();
      });
    });

    it("should block document mutation attempts from a VIEWER connection", async () => {
      const docId = "doc_viewer_restriction_test";
      (prisma.document.findUnique as jest.Mock).mockResolvedValue({
        id: docId,
        content: null,
        yjsState: null,
        deletedAt: null,
      });

      const tokenViewer = signCollabToken({
        userId: "usr_viewer_test",
        name: "Viewer Val",
        email: "val@test.dev",
        documentId: docId,
        role: "VIEWER",
        exp: Date.now() + 60000,
      });

      const ydocViewer = new Y.Doc();
      const providerViewer = new WebsocketProvider(serverUrl, docId, ydocViewer, {
        params: { token: tokenViewer },
      });

      await new Promise<void>((resolve) => {
        providerViewer.on("sync", (synced: boolean) => {
          if (synced) resolve();
        });
      });

      // Viewer attempts to write to the document
      ydocViewer.getText("notes").insert(0, "Unauthorized Viewer Text!");

      // Allow brief tick for message transmission to server
      await new Promise((r) => setTimeout(r, 150));

      // Assert server doc was NOT mutated by the viewer's write message
      const serverDoc = documentManager.docs.get(docId);
      const serverText = serverDoc ? serverDoc.getText("notes").toString() : "";
      expect(serverText).not.toContain("Unauthorized Viewer Text!");

      providerViewer.destroy();
      ydocViewer.destroy();
    });
  });
});

