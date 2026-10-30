import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  describeInvitation,
  acceptDocumentInvitation,
  InvitationError,
} from "@/lib/invitation-service";
import { NotFoundError } from "@/lib/workspace-service";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limiter";
import { webLogger } from "@/lib/logger";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(request);
    const limit = process.env.NODE_ENV === "test" ? 100 : 30;
    const rateCheck = checkRateLimit(`invitation-get:${ip}`, limit, 60 * 1000);

    if (!rateCheck.success) {
      webLogger.warn(`Invitation lookup rate limit exceeded for IP: ${ip}`);
      return rateLimitResponse(
        rateCheck,
        "Too many invitation requests. Please try again shortly."
      );
    }

    const { token } = await params;
    const { invitation, alreadyAccepted, requiresSignIn, guestSignInAvailable } =
      await describeInvitation(token);

    return NextResponse.json({
      alreadyAccepted,
      requiresSignIn,
      guestSignInAvailable,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        document: {
          id: invitation.document.id,
          title: invitation.document.title,
          workspaceName: invitation.document.workspace?.name || null,
        },
        inviter: {
          name: invitation.inviter.name,
          email: invitation.inviter.email,
        },
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InvitationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }
    webLogger.error("Failed to retrieve invitation", error);
    return NextResponse.json(
      { error: "Failed to retrieve invitation" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(request);
    const limit = process.env.NODE_ENV === "test" ? 100 : 20;
    const rateCheck = checkRateLimit(`invitation-accept:${ip}`, limit, 60 * 1000);

    if (!rateCheck.success) {
      webLogger.warn(`Invitation accept rate limit exceeded for IP: ${ip}`);
      return rateLimitResponse(
        rateCheck,
        "Too many attempts. Please try again shortly."
      );
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "You must be signed in to accept an invitation" },
        { status: 401 }
      );
    }

    const { token } = await params;
    const result = await acceptDocumentInvitation(token, session.user.id);

    webLogger.info("Invitation accepted successfully", {
      documentId: result.documentId,
      userId: session.user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InvitationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }
    webLogger.error("Failed to accept invitation", error);
    const message =
      error instanceof Error ? error.message : "Failed to accept invitation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
