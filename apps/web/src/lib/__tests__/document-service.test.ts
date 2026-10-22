import {
  createDocument,
  listDocuments,
  getDocument,
  updateDocument,
  softDeleteDocument,
  restoreDocument,
  permanentDeleteDocument,
} from "../document-service";
import { AuthorizationError, NotFoundError } from "../workspace-service";
import prisma from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    document: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workspaceMember: {
      findFirst: jest.fn(),
    },
    workspace: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe("Document Service & Permissions Enforcement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createDocument", () => {
    it("should create document for authorized user with default title", async () => {
      (prisma.document.create as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        title: "Untitled Document",
        ownerId: "usr_alice",
      });

      const doc = await createDocument("usr_alice", {});
      expect(doc.title).toBe("Untitled Document");
      expect(prisma.document.create).toHaveBeenCalledWith({
        data: {
          title: "Untitled Document",
          ownerId: "usr_alice",
          workspaceId: null,
          content: null,
        },
        include: expect.any(Object),
      });
    });

    it("should reject creation in workspace if user is not a member", async () => {
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.workspace.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        createDocument("usr_alice", { workspaceId: "ws_forbidden" })
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe("getDocument & Permissions Isolation", () => {
    it("should allow document owner to access document", async () => {
      const mockDoc = {
        id: "doc_alice",
        ownerId: "usr_alice",
        collaborators: [],
        workspace: null,
        title: "Alice's Secret Plan",
      };
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(mockDoc);

      const doc = await getDocument("doc_alice", "usr_alice");
      expect(doc.id).toBe("doc_alice");
      expect(doc.userRole).toBe("OWNER");
    });

    it("should deny access to unauthorized user (Cross-User Isolation)", async () => {
      const mockDoc = {
        id: "doc_alice",
        ownerId: "usr_alice",
        collaborators: [],
        workspace: null,
        isPublic: false,
      };
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(mockDoc);

      await expect(getDocument("doc_alice", "usr_eve")).rejects.toThrow(
        AuthorizationError
      );
    });

    it("should throw NotFoundError if document does not exist", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(getDocument("doc_missing", "usr_alice")).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("updateDocument", () => {
    it("should allow document owner to rename document", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        ownerId: "usr_alice",
        collaborators: [],
      });

      (prisma.document.update as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        title: "Renamed Document",
      });

      const updated = await updateDocument("doc_1", "usr_alice", {
        title: "Renamed Document",
      });

      expect(updated.title).toBe("Renamed Document");
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: "doc_1" },
        data: { title: "Renamed Document" },
        include: expect.any(Object),
      });
    });

    it("should deny update from non-collaborator stranger", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        ownerId: "usr_alice",
        collaborators: [],
        workspace: null,
      });

      await expect(
        updateDocument("doc_1", "usr_stranger", { title: "Hacked" })
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe("softDeleteDocument & restoreDocument", () => {
    it("should set deletedAt date when soft deleting", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        ownerId: "usr_alice",
        collaborators: [],
      });

      (prisma.document.update as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        deletedAt: new Date(),
      });

      await softDeleteDocument("doc_1", "usr_alice");
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: "doc_1" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("should clear deletedAt date when restoring document", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        ownerId: "usr_alice",
        collaborators: [],
      });

      (prisma.document.update as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        deletedAt: null,
      });

      await restoreDocument("doc_1", "usr_alice");
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: "doc_1" },
        data: { deletedAt: null },
      });
    });
  });

  describe("permanentDeleteDocument", () => {
    it("should allow OWNER to permanently delete", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        ownerId: "usr_alice",
        collaborators: [],
      });

      await permanentDeleteDocument("doc_1", "usr_alice");
      expect(prisma.document.delete).toHaveBeenCalledWith({
        where: { id: "doc_1" },
      });
    });

    it("should forbid regular collaborator from permanent delete", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        ownerId: "usr_alice",
        collaborators: [{ userId: "usr_bob", role: "EDITOR" }],
        workspace: null,
      });

      await expect(permanentDeleteDocument("doc_1", "usr_bob")).rejects.toThrow(
        AuthorizationError
      );
    });
  });

  describe("listDocuments filters & pagination", () => {
    it("should query active documents with pagination", async () => {
      const mockDocs = [{ id: "doc_1", title: "Active Doc" }];
      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([1, mockDocs]);

      const result = await listDocuments("usr_alice", {
        filter: "all",
        page: 1,
        limit: 10,
      });

      expect(result.documents).toEqual(mockDocs);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });
  });
});
