import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import prisma from "@/lib/prisma";
import { authConfig } from "./auth.config";
import { loginSchema, verifyPassword } from "@/lib/auth-utils";
import { signInWithInvitationToken } from "@/lib/invitation-service";

const providers: Provider[] = [
  Credentials({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const parsed = loginSchema.safeParse(credentials);
      if (!parsed.success) {
        return null;
      }

      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash) {
        // User not found or OAuth user without password
        return null;
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      };
    },
  }),
  // Passwordless guest access from an invitation link. The token is a 32-byte random
  // secret that only the invitee receives; it can never sign in to a full account.
  Credentials({
    id: "invite-token",
    name: "Invitation link",
    credentials: {
      token: { label: "Invitation token", type: "text" },
    },
    async authorize(credentials) {
      const token = typeof credentials?.token === "string" ? credentials.token : "";
      if (!token) return null;
      return signInWithInvitationToken(token);
    },
  }),
];

const githubClientId = process.env.GITHUB_CLIENT_ID || process.env.AUTH_GITHUB_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET;

if (githubClientId && githubClientSecret) {
  providers.push(
    GitHub({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  session: { strategy: "jwt" },
  providers,
});
