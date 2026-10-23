import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { revokeDocumentInvitation } from "@/lib/invitation-service";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, invitationId } = await params;
    await revokeDocumentInvitation(id, invitationId, session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Failed to revoke invitation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
