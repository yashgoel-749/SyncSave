import prisma from "@/lib/prisma";
import type { WorkspaceRole } from "@syncspace/db";

export class AuthorizationError extends Error {
  constructor(message = "You are not authorized to perform this operation") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(
    message = "Document was modified by another session. Please reload to avoid overwriting changes."
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export async function getUserWorkspaces(userId: string) {
  let workspaces = await prisma.workspace.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { documents: true, members: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Automatically provision a default workspace if user has none
  if (workspaces.length === 0) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    const defaultName = user?.name
      ? `${user.name.split(" ")[0]}'s Workspace`
      : "Personal Workspace";

    const newWorkspace = await createWorkspace(userId, {
      name: defaultName,
      description: "Default personal workspace",
    });

    workspaces = [
      {
        ...newWorkspace,
        owner: { id: userId, name: user?.name || null, email: user?.email || "" },
        _count: { documents: 0, members: 1 },
      },
    ];
  }

  return workspaces;
}

export async function createWorkspace(
  userId: string,
  data: { name: string; description?: string }
) {
  // Use Prisma transaction to create workspace and owner membership record
  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: data.name,
        description: data.description || null,
        ownerId: userId,
      },
    });

    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: "OWNER",
      },
    });

    return workspace;
  });
}

export async function verifyWorkspaceAccess(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
    },
  });

  if (membership) return membership;

  const isOwner = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      ownerId: userId,
    },
  });

  if (isOwner) {
    return { workspaceId, userId, role: "OWNER" as WorkspaceRole };
  }

  return null;
}

export async function getWorkspace(workspaceId: string, userId: string) {
  const access = await verifyWorkspaceAccess(workspaceId, userId);
  if (!access) {
    throw new AuthorizationError("You do not have access to this workspace");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
      _count: { select: { documents: true } },
    },
  });

  if (!workspace) {
    throw new NotFoundError("Workspace not found");
  }

  return { ...workspace, userRole: access.role };
}

export async function addWorkspaceMember(
  workspaceId: string,
  requesterUserId: string,
  email: string,
  role: "ADMIN" | "MEMBER" = "MEMBER"
) {
  const access = await verifyWorkspaceAccess(workspaceId, requesterUserId);
  if (!access || (access.role !== "OWNER" && access.role !== "ADMIN")) {
    throw new AuthorizationError("Only workspace owners or admins can add members");
  }

  const targetUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new NotFoundError("No user registered with this email address");
  }

  const existingMember = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: targetUser.id,
      },
    },
  });

  if (existingMember) {
    throw new Error("This user is already a member of this workspace");
  }

  const newMember = await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: targetUser.id,
      role: role as WorkspaceRole,
    },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  return newMember;
}
