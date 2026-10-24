import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDocument } from "@/lib/document-service";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";
import { signCollabToken, getUserColor } from "@/lib/collab-token";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limiter";
import { webLogger } from "@/lib/logger";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 60 tokens per minute per user/IP
    const ip = getClientIp(request);
    const rateKey = `collab-token:${session.user.id}:${ip}`;
    const limit = process.env.NODE_ENV === "test" ? 100 : 60;
    const rateCheck = checkRateLimit(rateKey, limit, 60 * 1000);

    if (!rateCheck.success) {
      webLogger.warn(`Collab token rate limit exceeded for user: ${session.user.id}`);
      return rateLimitResponse(
        rateCheck,
        "Too many token requests. Please try again shortly."
      );
    }

    const { id } = await params;
    const document = await getDocument(id, session.user.id);

    const userColor = getUserColor(session.user.id);
    const token = signCollabToken({
      userId: session.user.id,
      name: session.user.name || null,
      email: session.user.email || "",
      documentId: id,
      role: document.userRole as "OWNER" | "EDITOR" | "VIEWER",
      color: userColor,
      exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });

    const serverUrl =
      process.env.NEXT_PUBLIC_COLLAB_WS_URL || "ws://localhost:1234";

    return NextResponse.json({
      token,
      serverUrl,
      documentId: id,
      user: {
        id: session.user.id,
        name: session.user.name || session.user.email?.split("@")[0] || "Anonymous",
        email: session.user.email || "",
        role: document.userRole,
        color: userColor,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    webLogger.error("Error generating collab token", error);
    return NextResponse.json(
      { error: "Failed to generate collaboration token" },
      { status: 500 }
    );
  }
}
