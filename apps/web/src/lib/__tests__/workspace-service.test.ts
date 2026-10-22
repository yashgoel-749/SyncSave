import {
  getUserWorkspaces,
  createWorkspace,
  getWorkspace,
  addWorkspaceMember,
  AuthorizationError,
  NotFoundError,
} from "../workspace-service";
import prisma from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    workspace: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    workspaceMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe("Workspace Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getUserWorkspaces", () => {
    it("should return existing workspaces for user", async () => {
      const mockWorkspaces = [
        { id: "ws_1", name: "Engineering", ownerId: "usr_1" },
      ];
      (prisma.workspace.findMany as jest.Mock).mockResolvedValueOnce(mockWorkspaces);

      const result = await getUserWorkspaces("usr_1");
      expect(result).toEqual(mockWorkspaces);
      expect(prisma.workspace.findMany).toHaveBeenCalled();
    });

    it("should create default workspace if user has none", async () => {
      (prisma.workspace.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        name: "Ada Lovelace",
        email: "ada@example.com",
      });

      const newWs = { id: "ws_new", name: "Ada's Workspace", ownerId: "usr_ada" };
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        return cb({
          workspace: { create: jest.fn().mockResolvedValue(newWs) },
          workspaceMember: { create: jest.fn().mockResolvedValue({}) },
        });
      });

      const result = await getUserWorkspaces("usr_ada");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Ada's Workspace");
    });
  });

  describe("createWorkspace", () => {
    it("should create workspace and owner member within a Prisma transaction", async () => {
      const txMock = {
        workspace: {
          create: jest.fn().mockResolvedValue({
            id: "ws_created",
            name: "Research Labs",
            ownerId: "usr_1",
          }),
        },
        workspaceMember: {
          create: jest.fn().mockResolvedValue({
            workspaceId: "ws_created",
            userId: "usr_1",
            role: "OWNER",
          }),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txMock));

      const ws = await createWorkspace("usr_1", {
        name: "Research Labs",
        description: "Scientific docs",
      });

      expect(ws.id).toBe("ws_created");
      expect(txMock.workspace.create).toHaveBeenCalled();
      expect(txMock.workspaceMember.create).toHaveBeenCalledWith({
        data: {
          workspaceId: "ws_created",
          userId: "usr_1",
          role: "OWNER",
        },
      });
    });
  });

  describe("getWorkspace", () => {
    it("should throw AuthorizationError when requester has no access", async () => {
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.workspace.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(getWorkspace("ws_private", "usr_stranger")).rejects.toThrow(
        AuthorizationError
      );
    });

    it("should return workspace when requester is a verified member", async () => {
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValueOnce({
        workspaceId: "ws_allowed",
        userId: "usr_member",
        role: "MEMBER",
      });

      (prisma.workspace.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "ws_allowed",
        name: "Team",
        ownerId: "usr_owner",
        members: [],
      });

      const ws = await getWorkspace("ws_allowed", "usr_member");
      expect(ws.id).toBe("ws_allowed");
      expect(ws.userRole).toBe("MEMBER");
    });

    it("should throw NotFoundError if workspace is not found", async () => {
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValueOnce({
        workspaceId: "ws_deleted",
        userId: "usr_member",
        role: "MEMBER",
      });

      (prisma.workspace.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(getWorkspace("ws_deleted", "usr_member")).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("addWorkspaceMember", () => {
    it("should throw AuthorizationError if requester is regular MEMBER", async () => {
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValueOnce({
        workspaceId: "ws_1",
        userId: "usr_regular",
        role: "MEMBER",
      });

      await expect(
        addWorkspaceMember("ws_1", "usr_regular", "newbie@example.com")
      ).rejects.toThrow(AuthorizationError);
    });

    it("should add member successfully when requester is OWNER", async () => {
      (prisma.workspaceMember.findFirst as jest.Mock).mockResolvedValueOnce({
        workspaceId: "ws_1",
        userId: "usr_owner",
        role: "OWNER",
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "usr_target",
        email: "target@example.com",
      });

      (prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValueOnce(null);

      (prisma.workspaceMember.create as jest.Mock).mockResolvedValueOnce({
        id: "mem_1",
        workspaceId: "ws_1",
        userId: "usr_target",
        role: "MEMBER",
      });

      const member = await addWorkspaceMember(
        "ws_1",
        "usr_owner",
        "target@example.com"
      );

      expect(member.id).toBe("mem_1");
      expect(prisma.workspaceMember.create).toHaveBeenCalled();
    });
  });
});
