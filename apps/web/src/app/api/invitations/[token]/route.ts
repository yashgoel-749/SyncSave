import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getInvitationByToken,
  acceptDocumentInvitation,
  InvitationError,
} from "@/lib/invitation-service";
import { NotFoundError } from "@/lib/workspace-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const invitation = await getInvitationByToken(token);

    return NextResponse.json({
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
    return NextResponse.json(
      { error: "Failed to retrieve invitation" },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "You must be signed in to accept an invitation" },
        { status: 401 }
      );
    }

    const { token } = await params;
    const result = await acceptDocumentInvitation(token, session.user.id);

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
    const message =
      error instanceof Error ? error.message : "Failed to accept invitation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
