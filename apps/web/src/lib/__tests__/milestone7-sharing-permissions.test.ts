import {
  verifyDocumentAccess,
  updateDocument,
  permanentDeleteDocument,
  updateCollaboratorRole,
  removeDocumentCollaborator,
} from "../document-service";
import {
  createDocumentInvitation,
  getInvitationByToken,
  acceptDocumentInvitation,
} from "../invitation-service";
import {
  createNotification,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../notification-service";
import { AuthorizationError } from "../workspace-service";
import {
  notifyCollabServerRevoke,
  notifyCollabServerRoleUpdate,
} from "../collab-server-client";
import prisma from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    document: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    collaborator: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    documentInvitation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    workspaceMember: {
      findFirst: jest.fn(),
    },
    workspace: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        return callbackOrArray(prisma);
      }
      return Promise.all(callbackOrArray);
    }),
  },
}));

jest.mock("../collab-server-client", () => ({
  notifyCollabServerRevoke: jest.fn().mockResolvedValue(true),
  notifyCollabServerRoleUpdate: jest.fn().mockResolvedValue(true),
}));

describe("SyncSpace Milestone 7: Sharing, Roles, Permissions & Notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Role Enforcement & Permissions", () => {
    const baseDoc = {
      id: "doc_123",
      title: "Quarterly Strategy",
      ownerId: "usr_owner",
      owner: { id: "usr_owner", name: "Owner Alice", email: "alice@test.dev" },
      workspaceId: "ws_acme",
      collaborators: [],
      workspace: { members: [] },
      isPublic: false,
      updatedAt: new Date(),
    };

    it("should allow OWNER full access to edit and permanently delete", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(baseDoc);
      const access = await verifyDocumentAccess("doc_123", "usr_owner", "OWNER");
      expect(access.role).toBe("OWNER");

      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(baseDoc);
      (prisma.document.delete as jest.Mock).mockResolvedValueOnce({ id: "doc_123" });
      await expect(permanentDeleteDocument("doc_123", "usr_owner")).resolves.toBeDefined();
    });

    it("should allow EDITOR to edit, but reject permanent deletion", async () => {
      const docWithEditor = {
        ...baseDoc,
        collaborators: [{ userId: "usr_editor", role: "EDITOR" }],
      };

      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(docWithEditor);
      const access = await verifyDocumentAccess("doc_123", "usr_editor", "EDIT");
      expect(access.role).toBe("EDITOR");

      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(docWithEditor);
      await expect(permanentDeleteDocument("doc_123", "usr_editor")).rejects.toThrow(
        AuthorizationError
      );
    });

    it("should reject VIEWER from editing document content via updateDocument", async () => {
      const docWithViewer = {
        ...baseDoc,
        collaborators: [{ userId: "usr_viewer", role: "VIEWER" }],
      };

      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce(docWithViewer);
      await expect(
        updateDocument("doc_123", "usr_viewer", { title: "Malicious Edit" })
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe("Invitation Lifecycle & Token Expiration", () => {
    it("should generate expiring invitation with secure token and in-app notification for existing user", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_123",
        title: "Product Roadmap",
        ownerId: "usr_owner",
        owner: { id: "usr_owner", name: "Alice", email: "alice@test.dev" },
        collaborators: [],
        workspace: { members: [] },
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "usr_bob",
        name: "Bob",
        email: "bob@test.dev",
      });

      (prisma.documentInvitation.create as jest.Mock).mockImplementationOnce((args) =>
        Promise.resolve({
          id: "inv_1",
          token: args.data.token,
          expiresAt: args.data.expiresAt,
          role: args.data.role,
          document: { id: "doc_123", title: "Product Roadmap" },
          inviter: { id: "usr_owner", name: "Alice", email: "alice@test.dev" },
        })
      );

      (prisma.notification.create as jest.Mock).mockResolvedValueOnce({ id: "notif_1" });

      const result = await createDocumentInvitation("doc_123", "usr_owner", {
        email: "bob@test.dev",
        role: "EDITOR",
        expiresInDays: 7,
      });

      expect(result.inviteUrl).toContain("/invite/");
      expect(result.isExistingUser).toBe(true);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "usr_bob",
            type: "DOCUMENT_INVITATION",
            title: "Document Invitation",
          }),
        })
      );
    });

    it("should reject acceptance if invitation token is expired", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "inv_expired",
        token: "tok_expired_123",
        acceptedAt: null,
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
        document: { id: "doc_123", title: "Past Plan" },
        inviter: { name: "Alice", email: "alice@test.dev" },
      });

      await expect(getInvitationByToken("tok_expired_123")).rejects.toMatchObject({
        code: "EXPIRED",
      });
    });

    it("should reject acceptance if invitation was already accepted", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "inv_accepted",
        token: "tok_already_used",
        acceptedAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() + 86400000),
        document: { id: "doc_123", title: "Used Plan" },
        inviter: { name: "Alice", email: "alice@test.dev" },
      });

      await expect(getInvitationByToken("tok_already_used")).rejects.toMatchObject({
        code: "ALREADY_ACCEPTED",
      });
    });

    it("should atomically accept valid invitation and grant collaborator access", async () => {
      const validInv = {
        id: "inv_valid",
        token: "tok_valid_999",
        documentId: "doc_123",
        role: "VIEWER",
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        inviterId: "usr_alice",
        document: { id: "doc_123", title: "Secret Spec" },
        inviter: { id: "usr_alice", name: "Alice", email: "alice@test.dev" },
      };

      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce(validInv);
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "usr_charlie",
        name: "Charlie",
        email: "charlie@test.dev",
      });
      (prisma.collaborator.upsert as jest.Mock).mockResolvedValueOnce({
        id: "collab_new",
        documentId: "doc_123",
        userId: "usr_charlie",
        role: "VIEWER",
      });
      (prisma.documentInvitation.update as jest.Mock).mockResolvedValueOnce({
        ...validInv,
        acceptedAt: new Date(),
      });
      (prisma.notification.create as jest.Mock).mockResolvedValueOnce({ id: "notif_accept" });

      const result = await acceptDocumentInvitation("tok_valid_999", "usr_charlie");
      expect(result.success).toBe(true);
      expect(result.role).toBe("VIEWER");
      expect(prisma.collaborator.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            documentId_userId: {
              documentId: "doc_123",
              userId: "usr_charlie",
            },
          },
        })
      );
    });
  });

  describe("Permission Revocation & Real-time Live Eviction", () => {
    it("should allow owner to revoke collaborator access and notify collab server", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_123",
        ownerId: "usr_owner",
        collaborators: [],
        workspace: { members: [] },
      });

      (prisma.collaborator.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "collab_to_remove",
        documentId: "doc_123",
        userId: "usr_bad_actor",
      });

      (prisma.collaborator.delete as jest.Mock).mockResolvedValueOnce({ id: "collab_to_remove" });
      (prisma.notification.create as jest.Mock).mockResolvedValueOnce({ id: "notif_revoked" });

      const result = await removeDocumentCollaborator("doc_123", "usr_owner", "usr_bad_actor");
      expect(result.success).toBe(true);
      expect(prisma.collaborator.delete).toHaveBeenCalledWith({
        where: { id: "collab_to_remove" },
      });
      expect(notifyCollabServerRevoke).toHaveBeenCalledWith("doc_123", "usr_bad_actor");
    });

    it("should reject non-owners from revoking another collaborator", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_123",
        ownerId: "usr_owner",
        collaborators: [{ userId: "usr_editor_1", role: "EDITOR" }],
        workspace: { members: [] },
      });

      await expect(
        removeDocumentCollaborator("doc_123", "usr_editor_1", "usr_editor_2")
      ).rejects.toThrow(AuthorizationError);
    });

    it("should update collaborator role and notify collab server of live restriction change", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_123",
        ownerId: "usr_owner",
        collaborators: [],
        workspace: { members: [] },
      });

      (prisma.collaborator.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "collab_rec",
        documentId: "doc_123",
        userId: "usr_bob",
        role: "EDITOR",
      });

      (prisma.collaborator.update as jest.Mock).mockResolvedValueOnce({
        id: "collab_rec",
        role: "VIEWER",
        user: { id: "usr_bob", name: "Bob", email: "bob@test.dev" },
      });

      (prisma.notification.create as jest.Mock).mockResolvedValueOnce({ id: "notif_role_updated" });

      const updated = await updateCollaboratorRole("doc_123", "usr_owner", "usr_bob", "VIEWER");
      expect(updated.role).toBe("VIEWER");
      expect(notifyCollabServerRoleUpdate).toHaveBeenCalledWith("doc_123", "usr_bob", "VIEWER");
    });
  });

  describe("Cross-Workspace Access Isolation", () => {
    it("should reject document access if user does not belong to the private workspace and is not a collaborator", async () => {
      (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "doc_ws_private",
        title: "Confidential Financials",
        ownerId: "usr_cfo",
        owner: { id: "usr_cfo", name: "CFO", email: "cfo@corp.dev" },
        workspaceId: "ws_executive",
        collaborators: [],
        workspace: {
          members: [{ userId: "usr_cfo" }, { userId: "usr_ceo" }],
        },
        isPublic: false,
      });

      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.workspace.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        verifyDocumentAccess("doc_ws_private", "usr_external_intruder", "VIEW")
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe("Notification Feed & Content Leak Prevention", () => {
    it("should create notifications and sanitize sensitive document content to prevent leaks", async () => {
      (prisma.notification.create as jest.Mock).mockImplementationOnce((args) =>
        Promise.resolve({
          id: "notif_clean",
          ...args.data,
        })
      );

      const notif = await createNotification({
        userId: "usr_bob",
        type: "DOCUMENT_INVITATION",
        title: "Invitation",
        message: "You have been invited to Project X",
        data: {
          documentId: "doc_123",
          content: "CONFIDENTIAL SECRET REVENUE NUMBERS",
          yjsState: Buffer.from("confidential-state"),
          role: "EDITOR",
        },
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "usr_bob",
            data: {
              documentId: "doc_123",
              role: "EDITOR",
            },
          }),
        })
      );
      // Confirmed content and yjsState were stripped to prevent leaks
      expect((notif.data as any)?.content).toBeUndefined();
      expect((notif.data as any)?.yjsState).toBeUndefined();
    });

    it("should track unread count and support marking notifications as read", async () => {
      (prisma.notification.count as jest.Mock).mockResolvedValueOnce(3);
      const unreadCount = await getUnreadNotificationCount("usr_bob");
      expect(unreadCount).toBe(3);

      (prisma.notification.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      await markNotificationAsRead("notif_1", "usr_bob");
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: "notif_1", userId: "usr_bob" },
        data: { isRead: true },
      });

      (prisma.notification.updateMany as jest.Mock).mockResolvedValueOnce({ count: 2 });
      await markAllNotificationsAsRead("usr_bob");
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: "usr_bob", isRead: false },
        data: { isRead: true },
      });
    });
  });
});
