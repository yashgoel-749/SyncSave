import prisma from "@/lib/prisma";
import {
  AuthorizationError,
  NotFoundError,
  ConflictError,
  verifyWorkspaceAccess,
} from "./workspace-service";
import type { DocumentQueryParams } from "./document-schemas";
import type { Prisma } from "@syncspace/db";

export async function verifyDocumentAccess(
  documentId: string,
  userId: string,
  requiredRole: "VIEW" | "EDIT" | "OWNER" = "VIEW"
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      collaborators: true,
      workspace: {
        include: {
          members: true,
        },
      },
    },
  });

  if (!document) {
    throw new NotFoundError("Document not found");
  }

  // 1. Owner always has full access
  if (document.ownerId === userId) {
    return { document, role: "OWNER" as const };
  }

  // 2. Direct collaborator
  const collaborator = document.collaborators.find((c) => c.userId === userId);
  if (collaborator) {
    if (requiredRole === "OWNER") {
      throw new AuthorizationError("Only the document owner can perform this operation");
    }
    if (requiredRole === "EDIT" && collaborator.role === "VIEWER") {
      throw new AuthorizationError("You have view-only access to this document");
    }
    return { document, role: collaborator.role };
  }

  // 3. Workspace member
  if (document.workspaceId) {
    const wsAccess = await verifyWorkspaceAccess(document.workspaceId, userId);
    if (wsAccess) {
      if (requiredRole === "OWNER" && wsAccess.role !== "OWNER") {
        throw new AuthorizationError("Only workspace or document owners can perform this operation");
      }
      return { document, role: wsAccess.role };
    }
  }

  // 4. Public document (view only)
  if (document.isPublic && requiredRole === "VIEW") {
    return { document, role: "VIEWER" as const };
  }

  throw new AuthorizationError("You do not have access to this document");
}

export async function listDocuments(userId: string, options: DocumentQueryParams) {
  const { workspaceId, search, filter = "all", page = 1, limit = 20 } = options;

  const where: Prisma.DocumentWhereInput = {};

  // 1. Workspace scope vs User scope
  if (workspaceId) {
    const wsAccess = await verifyWorkspaceAccess(workspaceId, userId);
    if (!wsAccess) {
      throw new AuthorizationError("You do not have access to this workspace");
    }
    where.workspaceId = workspaceId;
  } else {
    // Show all user's accessible documents across their personal or accessible workspaces
    where.OR = [
      { ownerId: userId },
      { collaborators: { some: { userId } } },
      { workspace: { members: { some: { userId } } } },
    ];
  }

  // 2. Filter states
  if (filter === "trash") {
    where.deletedAt = { not: null };
  } else {
    where.deletedAt = null;
    if (filter === "archived") {
      where.isArchived = true;
    } else {
      where.isArchived = false;
    }
  }

  // 3. Search query
  if (search && search.trim().length > 0) {
    where.title = {
      contains: search.trim(),
      mode: "insensitive",
    };
  }

  const skip = (page - 1) * limit;

  // Run total count and document fetch in parallel
  const [total, documents] = await prisma.$transaction([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        workspace: { select: { id: true, name: true } },
        _count: { select: { collaborators: true } },
      },
    }),
  ]);

  return {
    documents,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function createDocument(
  userId: string,
  data: { title?: string; workspaceId?: string; content?: string }
) {
  if (data.workspaceId) {
    const wsAccess = await verifyWorkspaceAccess(data.workspaceId, userId);
    if (!wsAccess) {
      throw new AuthorizationError("You do not have access to the specified workspace");
    }
  }

  return prisma.document.create({
    data: {
      title: data.title?.trim() || "Untitled Document",
      ownerId: userId,
      workspaceId: data.workspaceId || null,
      content: data.content || null,
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true } },
    },
  });
}

export async function getDocument(documentId: string, userId: string) {
  const { document, role } = await verifyDocumentAccess(documentId, userId, "VIEW");
  return { ...document, userRole: role };
}

export async function updateDocument(
  documentId: string,
  userId: string,
  data: {
    title?: string;
    content?: string | null;
    isArchived?: boolean;
    isPublic?: boolean;
    clientUpdatedAt?: string;
  }
) {
  const { document } = await verifyDocumentAccess(documentId, userId, "EDIT");

  // Prevent stale requests from overwriting newer edits:
  // If client provided a baseline updatedAt timestamp, ensure server's updatedAt hasn't advanced past it (allowing 1000ms clock skew)
  if (data.clientUpdatedAt) {
    const clientDate = new Date(data.clientUpdatedAt).getTime();
    const serverDate = new Date(document.updatedAt).getTime();
    if (!isNaN(clientDate) && serverDate - clientDate > 1000) {
      throw new ConflictError(
        "Document has been updated by another session. Please reload to avoid overwriting newer edits."
      );
    }
  }

  return prisma.document.update({
    where: { id: documentId },
    data: {
      ...(data.title !== undefined && { title: data.title.trim() }),
      ...(data.content !== undefined && { content: data.content }),
      ...(data.isArchived !== undefined && { isArchived: data.isArchived }),
      ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true } },
    },
  });
}

export async function softDeleteDocument(documentId: string, userId: string) {
  await verifyDocumentAccess(documentId, userId, "EDIT");

  return prisma.document.update({
    where: { id: documentId },
    data: { deletedAt: new Date() },
  });
}

export async function restoreDocument(documentId: string, userId: string) {
  await verifyDocumentAccess(documentId, userId, "EDIT");

  return prisma.document.update({
    where: { id: documentId },
    data: { deletedAt: null },
  });
}

export async function permanentDeleteDocument(documentId: string, userId: string) {
  await verifyDocumentAccess(documentId, userId, "OWNER");

  return prisma.document.delete({
    where: { id: documentId },
  });
}
