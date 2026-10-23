import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listDocumentInvitations } from "@/lib/invitation-service";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const invitations = await listDocumentInvitations(id, session.user.id);
    return NextResponse.json({ invitations });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to fetch document invitations" },
      { status: 500 }
    );
  }
}
