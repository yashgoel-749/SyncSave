import crypto from "crypto";
import prisma from "@/lib/prisma";
import type { DocumentRole } from "@syncspace/db";
import { verifyDocumentAccess } from "./document-service";
import { AuthorizationError, NotFoundError } from "./workspace-service";
import { createNotification } from "./notification-service";

export class InvitationError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "InvitationError";
  }
}

/**
 * Creates a secure, expiring invitation to collaborate on a document.
 * If the recipient already has a SyncSpace account, an in-app notification is also sent.
 */
export async function createDocumentInvitation(
  documentId: string,
  inviterUserId: string,
  params: {
    email: string;
    role: "EDITOR" | "VIEWER";
    expiresInDays?: number;
  }
) {
  const email = params.email.trim().toLowerCase();
  const role = params.role as DocumentRole;
  const expiresInDays = params.expiresInDays ?? 7;

  // 1. Verify inviter has permission (OWNER or EDITOR)
  const { document, role: inviterRole } = await verifyDocumentAccess(
    documentId,
    inviterUserId,
    "EDIT"
  );

  if (inviterRole !== "OWNER" && inviterRole !== "EDITOR" && inviterRole !== "ADMIN") {
    throw new AuthorizationError("You do not have permission to invite collaborators to this document");
  }

  // 2. Prevent self-invitation or inviting document owner
  if (email === document.owner.email.toLowerCase()) {
    throw new InvitationError("The specified email belongs to the document owner", "ALREADY_OWNER");
  }

  // 3. Check if target user already exists in DB
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  if (existingUser && existingUser.id === document.ownerId) {
    throw new InvitationError("This user is already the owner of this document", "ALREADY_OWNER");
  }

  // 4. Generate cryptographically secure, random token
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  // 5. Upsert invitation (delete older pending invites for same doc/email to avoid duplicates)
  await prisma.documentInvitation.deleteMany({
    where: {
      documentId,
      email,
      acceptedAt: null,
    },
  });

  const invitation = await prisma.documentInvitation.create({
    data: {
      documentId,
      email,
      role,
      token,
      inviterId: inviterUserId,
      expiresAt,
    },
    include: {
      document: { select: { id: true, title: true } },
      inviter: { select: { id: true, name: true, email: true } },
    },
  });

  // 6. If target user has an account, deliver an in-app notification
  if (existingUser) {
    const inviterName = invitation.inviter.name || invitation.inviter.email;
    await createNotification({
      userId: existingUser.id,
      type: "DOCUMENT_INVITATION",
      title: "Document Invitation",
      message: `${inviterName} invited you to collaborate on "${document.title}" as ${role.toLowerCase()}.`,
      data: {
        documentId: document.id,
        inviteToken: token,
        role,
      },
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const inviteUrl = `${appUrl}/invite/${token}`;

  return {
    invitation,
    inviteUrl,
    isExistingUser: Boolean(existingUser),
  };
}

/**
 * Retrieves invitation metadata for acceptance verification preview.
 */
export async function getInvitationByToken(token: string) {
  if (!token || typeof token !== "string") {
    throw new InvitationError("Invalid invitation token", "INVALID_TOKEN");
  }

  const invitation = await prisma.documentInvitation.findUnique({
    where: { token },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          workspace: { select: { id: true, name: true } },
        },
      },
      inviter: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }

  if (invitation.acceptedAt) {
    throw new InvitationError("This invitation has already been accepted", "ALREADY_ACCEPTED");
  }

  if (new Date() > invitation.expiresAt) {
    throw new InvitationError("This invitation has expired", "EXPIRED");
  }

  return invitation;
}

/**
 * Validates and accepts an invitation, granting collaborator permissions.
 */
export async function acceptDocumentInvitation(token: string, userId: string) {
  const invitation = await getInvitationByToken(token);

  const acceptingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  if (!acceptingUser) {
    throw new NotFoundError("User not found");
  }

  // Atomic acceptance: add collaborator, mark accepted, create notifications
  await prisma.$transaction(async (tx) => {
    // 1. Create or update collaborator record
    await tx.collaborator.upsert({
      where: {
        documentId_userId: {
          documentId: invitation.documentId,
          userId,
        },
      },
      create: {
        documentId: invitation.documentId,
        userId,
        role: invitation.role,
        acceptedAt: new Date(),
      },
      update: {
        role: invitation.role,
        acceptedAt: new Date(),
      },
    });

    // 2. Mark invitation as accepted
    await tx.documentInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
  });

  // 3. Notify inviter
  const acceptedName = acceptingUser.name || acceptingUser.email;
  await createNotification({
    userId: invitation.inviterId,
    type: "INVITATION_ACCEPTED",
    title: "Invitation Accepted",
    message: `${acceptedName} accepted your invitation to "${invitation.document.title}".`,
    data: {
      documentId: invitation.documentId,
      userId,
      role: invitation.role,
    },
  });

  return {
    success: true,
    documentId: invitation.documentId,
    role: invitation.role,
  };
}

/**
 * Lists pending (unaccepted, non-expired) invitations for a document.
 */
export async function listDocumentInvitations(documentId: string, userId: string) {
  await verifyDocumentAccess(documentId, userId, "VIEW");

  return prisma.documentInvitation.findMany({
    where: {
      documentId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      inviter: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Revokes / cancels a pending document invitation.
 */
export async function revokeDocumentInvitation(
  documentId: string,
  invitationId: string,
  userId: string
) {
  const { role } = await verifyDocumentAccess(documentId, userId, "EDIT");
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new AuthorizationError("Only the document owner can revoke invitations");
  }

  const invitation = await prisma.documentInvitation.findFirst({
    where: { id: invitationId, documentId },
  });

  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }

  return prisma.documentInvitation.delete({
    where: { id: invitationId },
  });
}
