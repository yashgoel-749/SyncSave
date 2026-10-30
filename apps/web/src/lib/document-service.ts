import prisma from "@/lib/prisma";
import {
  AuthorizationError,
  NotFoundError,
  ConflictError,
  verifyWorkspaceAccess,
} from "./workspace-service";
import type { DocumentQueryParams } from "./document-schemas";
import type { Prisma, DocumentRole } from "@syncspace/db";
import { extractPlainText } from "./editor-utils";

/** Documents touched within this window are shown under the "Recent" filter. */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Max characters of plain-text preview shipped to the dashboard. */
const PREVIEW_LENGTH = 160;

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
      return {
        document,
        role: wsAccess.role === "MEMBER" ? ("EDITOR" as const) : wsAccess.role,
      };
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
      if (filter === "recent") {
        where.updatedAt = { gte: new Date(Date.now() - RECENT_WINDOW_MS) };
      }
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

  // Run total count and document fetch in parallel.
  // Note: the binary Yjs state is deliberately NOT selected – it can be hundreds of KB per
  // document and the list view only needs metadata plus a short text preview.
  const [total, rows] = await prisma.$transaction([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        content: true,
        isPublic: true,
        isArchived: true,
        deletedAt: true,
        ownerId: true,
        workspaceId: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true, email: true } },
        workspace: { select: { id: true, name: true } },
        _count: { select: { collaborators: true } },
      },
    }),
  ]);

  const documents = (rows as Array<Record<string, unknown>>).map((doc) => {
    if (!("content" in doc)) return doc;
    const { content, ...rest } = doc;
    return {
      ...rest,
      preview: extractPlainText(typeof content === "string" ? content : null, {
        maxLength: PREVIEW_LENGTH,
      }),
    };
  });

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

  // Prevent ordinary database last-write-wins saves from overwriting collaborative state:
  // If the document has collaborative Yjs state, plain REST content overwrites are blocked
  // to avoid wiping out concurrent collaborative updates in yjsState.
  const yjsBytes = document.yjsState as Uint8Array | Buffer | null;
  const isCollaborative = Boolean(yjsBytes && yjsBytes.length > 0);
  const contentToUpdate = isCollaborative ? undefined : data.content;

  return prisma.document.update({
    where: { id: documentId },
    data: {
      ...(data.title !== undefined && { title: data.title.trim() }),
      ...(contentToUpdate !== undefined && { content: contentToUpdate }),
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

export async function addDocumentCollaborator(
  documentId: string,
  requesterUserId: string,
  email: string,
  role: "EDITOR" | "VIEWER" = "EDITOR"
) {
  const { document, role: userRole } = await verifyDocumentAccess(
    documentId,
    requesterUserId,
    "EDIT"
  );
  if (userRole !== "OWNER" && userRole !== "ADMIN" && userRole !== "EDITOR") {
    throw new AuthorizationError("You do not have permission to invite collaborators");
  }

  const targetUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new NotFoundError(`No user found with email "${email}". Make sure they have registered an account.`);
  }

  if (targetUser.id === document.ownerId) {
    throw new Error("This user is already the owner of this document");
  }

  const existingCollaborator = await prisma.collaborator.findUnique({
    where: {
      documentId_userId: {
        documentId,
        userId: targetUser.id,
      },
    },
  });

  let collaborator;
  if (existingCollaborator) {
    collaborator = await prisma.collaborator.update({
      where: { id: existingCollaborator.id },
      data: { role: role as DocumentRole },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
  } else {
    collaborator = await prisma.collaborator.create({
      data: {
        documentId,
        userId: targetUser.id,
        role: role as DocumentRole,
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
  }

  // Create in-app notification
  try {
    const { createNotification } = await import("./notification-service");
    await createNotification({
      userId: targetUser.id,
      type: "DOCUMENT_INVITATION",
      title: "Document Invitation",
      message: `You were added as ${role.toLowerCase()} to "${document.title}".`,
      data: { documentId, role },
    });
  } catch (err) {
    console.warn("Failed to create in-app notification for added collaborator:", err);
  }

  return collaborator;
}

export async function updateCollaboratorRole(
  documentId: string,
  requesterUserId: string,
  targetUserId: string,
  newRole: "EDITOR" | "VIEWER"
) {
  const { document, role: userRole } = await verifyDocumentAccess(
    documentId,
    requesterUserId,
    "EDIT"
  );

  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    throw new AuthorizationError("Only the document owner can change collaborator roles");
  }

  if (targetUserId === document.ownerId) {
    throw new Error("Cannot change role of document owner");
  }

  const existing = await prisma.collaborator.findUnique({
    where: {
      documentId_userId: {
        documentId,
        userId: targetUserId,
      },
    },
  });

  if (!existing) {
    throw new NotFoundError("Collaborator not found");
  }

  const updated = await prisma.collaborator.update({
    where: { id: existing.id },
    data: { role: newRole as DocumentRole },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  // Notify collaboration server to immediately update active WebSocket connection restrictions
  try {
    const { notifyCollabServerRoleUpdate } = await import("./collab-server-client");
    await notifyCollabServerRoleUpdate(documentId, targetUserId, newRole);
  } catch (err) {
    console.warn("Failed to notify collab server of role change:", err);
  }

  // Send in-app notification to the collaborator
  try {
    const { createNotification } = await import("./notification-service");
    await createNotification({
      userId: targetUserId,
      type: "ROLE_UPDATED",
      title: "Role Updated",
      message: `Your permission for "${document.title}" was changed to ${newRole.toLowerCase()}.`,
      data: { documentId, role: newRole },
    });
  } catch (err) {
    console.warn("Failed to create in-app notification for role update:", err);
  }

  return updated;
}

export async function removeDocumentCollaborator(
  documentId: string,
  requesterUserId: string,
  targetUserId: string
) {
  const { document, role: userRole } = await verifyDocumentAccess(
    documentId,
    requesterUserId,
    "VIEW"
  );

  // An owner/admin can remove any collaborator; a collaborator can remove themselves (leave)
  const isOwnerOrAdmin = userRole === "OWNER" || userRole === "ADMIN";
  const isSelf = requesterUserId === targetUserId;

  if (!isOwnerOrAdmin && !isSelf) {
    throw new AuthorizationError("You do not have permission to remove this collaborator");
  }

  if (targetUserId === document.ownerId) {
    throw new Error("Cannot remove the owner of a document");
  }

  const existing = await prisma.collaborator.findUnique({
    where: {
      documentId_userId: {
        documentId,
        userId: targetUserId,
      },
    },
  });

  if (!existing) {
    throw new NotFoundError("Collaborator not found");
  }

  await prisma.collaborator.delete({
    where: { id: existing.id },
  });

  // Notify collab-server to immediately close active WebSockets for this user in this room
  try {
    const { notifyCollabServerRevoke } = await import("./collab-server-client");
    await notifyCollabServerRevoke(documentId, targetUserId);
  } catch (err) {
    console.warn("Failed to notify collab server of permission revocation:", err);
  }

  // Send in-app notification if removed by someone else
  if (!isSelf) {
    try {
      const { createNotification } = await import("./notification-service");
      await createNotification({
        userId: targetUserId,
        type: "ACCESS_REVOKED",
        title: "Access Revoked",
        message: `Your access to "${document.title}" has been revoked.`,
        data: { documentId },
      });
    } catch (err) {
      console.warn("Failed to create in-app notification for access revocation:", err);
    }
  }

  return { success: true };
}

export async function getDocumentCollaborators(documentId: string, userId: string) {
  await verifyDocumentAccess(documentId, userId, "VIEW");
  return prisma.collaborator.findMany({
    where: { documentId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { invitedAt: "asc" },
  });
}

