import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { registerSchema, hashPassword } from "@/lib/auth-utils";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limiter";
import { webLogger } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    // Rate limit: 5 registrations per 15 minutes per IP (50 in test)
    const ip = getClientIp(request);
    const limit = process.env.NODE_ENV === "test" ? 50 : 5;
    const rateCheck = checkRateLimit(`register:${ip}`, limit, 15 * 60 * 1000);

    if (!rateCheck.success) {
      webLogger.warn(`Registration rate limit exceeded for IP: ${ip}`);
      return rateLimitResponse(
        rateCheck,
        "Too many registration attempts. Please try again later."
      );
    }

    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON request body" },
        { status: 400 }
      );
    }

    const result = registerSchema.safeParse(body);
    if (!result.success) {
      const firstError = result.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { error: firstError, details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { name, email, password } = result.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { accounts: { select: { id: true } } },
    });

    if (existingUser) {
      // Guest accounts (created from an invitation link) have no password and no OAuth
      // provider; registering with that email upgrades them to a full account.
      const isClaimableGuest =
        existingUser.passwordHash === null && (existingUser.accounts ?? []).length === 0;

      if (!isClaimableGuest) {
        return NextResponse.json(
          { error: "An account with this email address already exists" },
          { status: 409 }
        );
      }

      const claimed = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash: await hashPassword(password),
          ...(name ? { name: name.trim() } : {}),
        },
        select: { id: true, name: true, email: true, image: true, createdAt: true },
      });

      webLogger.info("Guest account claimed with a password", { userId: claimed.id });

      return NextResponse.json(
        { message: "Account activated successfully", user: claimed, claimedGuest: true },
        { status: 201 }
      );
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name: name ? name.trim() : null,
        email,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
      },
    });

    webLogger.info("User registered successfully", { userId: user.id });

    return NextResponse.json(
      {
        message: "Account created successfully",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    webLogger.error("Registration error", error);
    // Never surface raw database/driver messages to clients.
    return NextResponse.json(
      { error: "An unexpected error occurred during registration. Please try again." },
      { status: 500 }
    );
  }
}
