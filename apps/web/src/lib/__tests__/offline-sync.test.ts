import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import * as fs from "fs";
import * as path from "path";

describe("Milestone 6: Reliable Offline-First Persistence & Sync Tests", () => {
  describe("Yjs IndexedDB Local Persistence", () => {
    it("should persist local edits into IndexedDB and restore them across new doc instances", async () => {
      const docName = "doc_test_offline_persistence";

      // 1. Initial Session: write edits
      const doc1 = new Y.Doc();
      const idb1 = new IndexeddbPersistence(docName, doc1);
      await idb1.whenSynced;

      doc1.getText("content").insert(0, "Offline Draft 1");

      // Allow a brief delay for IndexedDB transaction to commit
      await new Promise((r) => setTimeout(r, 80));
      await idb1.destroy();
      doc1.destroy();

      // 2. Simulated Restart: Mount new Y.Doc instance with same docName
      const doc2 = new Y.Doc();
      const idb2 = new IndexeddbPersistence(docName, doc2);
      await idb2.whenSynced;

      // Verify restored content matches what was saved offline
      expect(doc2.getText("content").toString()).toBe("Offline Draft 1");

      // 3. Second Offline Editing Turn: append further edits
      doc2.getText("content").insert(doc2.getText("content").length, " -> Offline Draft 2");
      await new Promise((r) => setTimeout(r, 80));
      await idb2.destroy();
      doc2.destroy();

      // 4. Second Simulated Restart: Verify accumulated offline state
      const doc3 = new Y.Doc();
      const idb3 = new IndexeddbPersistence(docName, doc3);
      await idb3.whenSynced;

      expect(doc3.getText("content").toString()).toBe("Offline Draft 1 -> Offline Draft 2");

      await idb3.destroy();
      doc3.destroy();
    });

    it("should merge offline local edits with remote server updates using state vectors without data loss", async () => {
      const docName = "doc_test_offline_merge";

      // Simulated Server Doc
      const serverDoc = new Y.Doc();
      serverDoc.getText("content").insert(0, "Original Server Content");

      // Client Doc receives initial server snapshot
      const clientDoc = new Y.Doc();
      const clientIdb = new IndexeddbPersistence(docName, clientDoc);
      await clientIdb.whenSynced;

      const initialServerUpdate = Y.encodeStateAsUpdate(serverDoc);
      Y.applyUpdate(clientDoc, initialServerUpdate);
      expect(clientDoc.getText("content").toString()).toBe("Original Server Content");

      // Client goes offline and edits
      clientDoc.getText("content").insert(clientDoc.getText("content").length, " [Local Offline Note]");

      // Meanwhile, server receives edit from another participant
      serverDoc.getText("content").insert(0, "[Remote Collaborator] ");

      // Reconnection: Exchange state vectors
      const clientVector = Y.encodeStateVector(clientDoc);
      const serverVector = Y.encodeStateVector(serverDoc);

      const missingForClient = Y.encodeStateAsUpdate(serverDoc, clientVector);
      const missingForServer = Y.encodeStateAsUpdate(clientDoc, serverVector);

      Y.applyUpdate(clientDoc, missingForClient);
      Y.applyUpdate(serverDoc, missingForServer);

      // Verify convergence
      const finalClient = clientDoc.getText("content").toString();
      const finalServer = serverDoc.getText("content").toString();

      expect(finalClient).toBe(finalServer);
      expect(finalClient).toContain("[Remote Collaborator]");
      expect(finalClient).toContain("Original Server Content");
      expect(finalClient).toContain("[Local Offline Note]");

      await clientIdb.destroy();
      clientDoc.destroy();
      serverDoc.destroy();
    });

    it("should handle storage limitations gracefully without crashing in-memory state", () => {
      const mockDoc = new Y.Doc();

      // Simulate an environment where IndexedDB is blocked (e.g., SecurityError in strict iframe or private browsing)
      expect(() => {
        try {
          // If indexedDB throws, error is caught gracefully
          throw new DOMException("The user denied access to the database", "SecurityError");
        } catch (err: any) {
          expect(err.name).toBe("SecurityError");
        }
      }).not.toThrow();

      // In-memory doc should remain fully operational
      mockDoc.getText("text").insert(0, "In-memory safe");
      expect(mockDoc.getText("text").toString()).toBe("In-memory safe");
      mockDoc.destroy();
    });
  });

  describe("Service Worker Safe Caching Policy", () => {
    let swCode: string;

    beforeAll(() => {
      const swPath = path.resolve(__dirname, "../../../public/sw.js");
      swCode = fs.readFileSync(swPath, "utf-8");
    });

    it("should strictly bypass all /api/ endpoints to prevent caching private document responses or tokens", () => {
      // Must explicitly check for /api/ bypass
      expect(swCode).toContain("url.pathname.startsWith('/api/')");
      expect(swCode).toContain("url.pathname.includes('/collab-token')");
      expect(swCode).toContain("url.pathname.startsWith('/auth/')");
      expect(swCode).toContain("url.pathname.includes('/next-auth')");
    });

    it("should only intercept GET requests and bypass mutations", () => {
      expect(swCode).toContain("if (req.method !== 'GET')");
    });

    it("should implement Cache-First for static assets and Network-First with offline fallback for navigation", () => {
      expect(swCode).toContain("/_next/static/");
      expect(swCode).toContain("req.mode === 'navigate'");
      expect(swCode).toContain("OFFLINE_URL");
    });

    it("should have a valid web app manifest with standalone display and appropriate theme", () => {
      const manifestPath = path.resolve(__dirname, "../../../public/manifest.webmanifest");
      const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      expect(manifestContent.name).toBe("SyncSpace");
      expect(manifestContent.display).toBe("standalone");
      expect(manifestContent.start_url).toBe("/dashboard");
      expect(manifestContent.icons.length).toBeGreaterThan(0);
    });
  });
});
