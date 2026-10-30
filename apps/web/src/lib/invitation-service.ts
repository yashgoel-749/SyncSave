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

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://syncsave.vercel.app");
  const inviteUrl = `${appUrl}/invite/${token}`;

  return {
    invitation,
    inviteUrl,
    isExistingUser: Boolean(existingUser),
  };
}

/** A user record with just enough to tell a guest account from a full one. */
type AccountShape = { id: string; email: string; name: string | null; image: string | null; passwordHash: string | null; accounts: Array<{ id: string }> };

/**
 * Guest accounts are created from invitation links: no password and no OAuth
 * provider linked. Only these may be signed in (or claimed) via an invitation token.
 */
export function isGuestAccount(user: { passwordHash: string | null; accounts?: Array<{ id: string }> } | null | undefined): boolean {
  if (!user) return false;
  return user.passwordHash === null && (user.accounts ?? []).length === 0;
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "Guest";
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface InvitationAccessInfo {
  invitation: NonNullable<Awaited<ReturnType<typeof prisma.documentInvitation.findUnique>>> & {
    document: { id: string; title: string; workspace: { id: string; name: string } | null };
    inviter: { id: string; name: string | null; email: string };
  };
  /** The invitation was already accepted. */
  alreadyAccepted: boolean;
  /** The invited email belongs to a full account (password or OAuth) and must sign in normally. */
  requiresSignIn: boolean;
  /** The invitee can enter straight from the link, without creating an account. */
  guestSignInAvailable: boolean;
}

/**
 * Describes what the invite page should offer for a token: pending vs accepted,
 * and whether the invitee can join as a guest or has to sign in.
 */
export async function describeInvitation(token: string): Promise<InvitationAccessInfo> {
  if (!token || typeof token !== "string") {
    throw new InvitationError("Invalid invitation token", "INVALID_TOKEN");
  }

  const invitation = await prisma.documentInvitation.findUnique({
    where: { token },
    include: {
      document: { select: { id: true, title: true, workspace: { select: { id: true, name: true } } } },
      inviter: { select: { id: true, name: true, email: true } },
    },
  });

  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }

  const user = (await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, email: true, name: true, image: true, passwordHash: true, accounts: { select: { id: true } } },
  })) as AccountShape | null;
  const guest = isGuestAccount(user);
  const hasFullAccount = Boolean(user) && !guest;

  if (invitation.acceptedAt) {
    // A guest can keep using the link as their way back in, as long as access was not revoked.
    if (user && guest) {
      const collaborator = await prisma.collaborator.findUnique({
        where: { documentId_userId: { documentId: invitation.documentId, userId: user.id } },
      });
      if (collaborator) {
        return { invitation, alreadyAccepted: true, requiresSignIn: false, guestSignInAvailable: true };
      }
    }
    throw new InvitationError("This invitation has already been accepted", "ALREADY_ACCEPTED");
  }

  if (new Date() > invitation.expiresAt) {
    throw new InvitationError("This invitation has expired", "EXPIRED");
  }

  return {
    invitation,
    alreadyAccepted: false,
    requiresSignIn: hasFullAccount,
    guestSignInAvailable: !hasFullAccount,
  };
}

/**
 * Signs an invitee in using only the invitation token (passwordless guest access).
 *
 * - New email: a guest account is created, the invitation is accepted, the user is returned.
 * - Existing guest account: the link doubles as a magic link while the collaborator record exists.
 * - Existing full account (password or OAuth): returns null — the owner of that account must
 *   sign in normally so an invitation link can never take over a real account.
 *
 * Returns the minimal user shape NextAuth expects from a Credentials provider, or null.
 */
export async function signInWithInvitationToken(
  token: string
): Promise<{ id: string; email: string; name: string | null; image: string | null } | null> {
  if (!token || typeof token !== "string") return null;

  const invitation = await prisma.documentInvitation.findUnique({ where: { token } });
  if (!invitation) return null;

  let user = (await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, email: true, name: true, image: true, passwordHash: true, accounts: { select: { id: true } } },
  })) as AccountShape | null;

  if (user && !isGuestAccount(user)) {
    return null;
  }

  if (invitation.acceptedAt) {
    if (!user) return null;
    const collaborator = await prisma.collaborator.findUnique({
      where: { documentId_userId: { documentId: invitation.documentId, userId: user.id } },
    });
    if (!collaborator) return null; // access was revoked
    return { id: user.id, email: user.email, name: user.name, image: user.image };
  }

  if (new Date() > invitation.expiresAt) return null;

  if (!user) {
    const created = await prisma.user.create({
      data: {
        email: invitation.email,
        name: displayNameFromEmail(invitation.email),
        passwordHash: null,
      },
      select: { id: true, email: true, name: true, image: true, passwordHash: true },
    });
    user = { ...created, accounts: [] };
  }

  await acceptDocumentInvitation(token, user.id);

  return { id: user.id, email: user.email, name: user.name, image: user.image };
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
