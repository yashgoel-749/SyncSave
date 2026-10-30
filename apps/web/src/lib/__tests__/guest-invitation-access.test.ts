import {
  describeInvitation,
  signInWithInvitationToken,
  isGuestAccount,
  InvitationError,
} from "../invitation-service";
import prisma from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    documentInvitation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    collaborator: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: "ntf_1" }),
    },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
  },
}));

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

const pendingInvitation = {
  id: "inv_1",
  token: "tok_secret",
  email: "newperson@example.com",
  role: "EDITOR",
  documentId: "doc_1",
  inviterId: "usr_owner",
  expiresAt: future,
  acceptedAt: null,
  createdAt: new Date(),
  document: { id: "doc_1", title: "Roadmap", workspace: null },
  inviter: { id: "usr_owner", name: "Alice", email: "alice@example.com" },
};

const fullAccount = {
  id: "usr_full",
  email: "newperson@example.com",
  name: "Existing",
  image: null,
  passwordHash: "$2a$12$hash",
  accounts: [],
};

const guestAccount = {
  id: "usr_guest",
  email: "newperson@example.com",
  name: "Newperson",
  image: null,
  passwordHash: null,
  accounts: [],
};

describe("Guest access from invitation links", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isGuestAccount", () => {
    it("is true only for passwordless accounts without OAuth providers", () => {
      expect(isGuestAccount(guestAccount)).toBe(true);
      expect(isGuestAccount(fullAccount)).toBe(false);
      expect(isGuestAccount({ passwordHash: null, accounts: [{ id: "acc_github" }] })).toBe(false);
      expect(isGuestAccount(null)).toBe(false);
    });
  });

  describe("describeInvitation", () => {
    it("offers guest sign-in for an email with no account", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce(pendingInvitation);
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const info = await describeInvitation("tok_secret");
      expect(info.guestSignInAvailable).toBe(true);
      expect(info.requiresSignIn).toBe(false);
      expect(info.alreadyAccepted).toBe(false);
    });

    it("requires a normal sign-in when the email belongs to a full account", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce(pendingInvitation);
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(fullAccount);

      const info = await describeInvitation("tok_secret");
      expect(info.guestSignInAvailable).toBe(false);
      expect(info.requiresSignIn).toBe(true);
    });

    it("lets an accepted guest keep using the link while access exists", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        ...pendingInvitation,
        acceptedAt: past,
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(guestAccount);
      (prisma.collaborator.findUnique as jest.Mock).mockResolvedValueOnce({ id: "col_1" });

      const info = await describeInvitation("tok_secret");
      expect(info.alreadyAccepted).toBe(true);
      expect(info.guestSignInAvailable).toBe(true);
    });

    it("rejects an accepted invitation once the guest's access was revoked", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        ...pendingInvitation,
        acceptedAt: past,
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(guestAccount);
      (prisma.collaborator.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(describeInvitation("tok_secret")).rejects.toMatchObject({ code: "ALREADY_ACCEPTED" });
    });

    it("rejects expired pending invitations", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        ...pendingInvitation,
        expiresAt: past,
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(describeInvitation("tok_secret")).rejects.toBeInstanceOf(InvitationError);
    });
  });

  describe("signInWithInvitationToken", () => {
    it("creates a guest account, accepts the invitation and returns the user", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock)
        .mockResolvedValueOnce(pendingInvitation) // signInWithInvitationToken lookup
        .mockResolvedValueOnce(pendingInvitation); // acceptDocumentInvitation -> getInvitationByToken
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // no account yet
        .mockResolvedValueOnce({ id: "usr_new", name: "Newperson", email: "newperson@example.com" }); // acceptingUser
      (prisma.user.create as jest.Mock).mockResolvedValueOnce({
        id: "usr_new",
        email: "newperson@example.com",
        name: "Newperson",
        image: null,
        passwordHash: null,
      });
      (prisma.collaborator.upsert as jest.Mock).mockResolvedValueOnce({ id: "col_new" });
      (prisma.documentInvitation.update as jest.Mock).mockResolvedValueOnce({});

      const user = await signInWithInvitationToken("tok_secret");

      expect(user).toEqual({ id: "usr_new", email: "newperson@example.com", name: "Newperson", image: null });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: "newperson@example.com", passwordHash: null }),
        })
      );
      expect(prisma.collaborator.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ documentId: "doc_1", userId: "usr_new", role: "EDITOR" }),
        })
      );
      expect(prisma.documentInvitation.update).toHaveBeenCalled();
    });

    it("never signs in to a full account via an invitation token", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce(pendingInvitation);
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(fullAccount);

      await expect(signInWithInvitationToken("tok_secret")).resolves.toBeNull();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.collaborator.upsert).not.toHaveBeenCalled();
    });

    it("acts as a magic link for an existing guest whose invitation was already accepted", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        ...pendingInvitation,
        acceptedAt: past,
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(guestAccount);
      (prisma.collaborator.findUnique as jest.Mock).mockResolvedValueOnce({ id: "col_1" });

      const user = await signInWithInvitationToken("tok_secret");
      expect(user?.id).toBe("usr_guest");
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("refuses an accepted token once the guest's access was revoked", async () => {
      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        ...pendingInvitation,
        acceptedAt: past,
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(guestAccount);
      (prisma.collaborator.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(signInWithInvitationToken("tok_secret")).resolves.toBeNull();
    });

    it("refuses unknown, empty and expired tokens", async () => {
      await expect(signInWithInvitationToken("")).resolves.toBeNull();

      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(signInWithInvitationToken("nope")).resolves.toBeNull();

      (prisma.documentInvitation.findUnique as jest.Mock).mockResolvedValueOnce({
        ...pendingInvitation,
        expiresAt: past,
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(signInWithInvitationToken("tok_secret")).resolves.toBeNull();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });
});
