import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  updateCollaboratorRole,
  removeDocumentCollaborator,
} from "@/lib/document-service";
import { updateCollaboratorSchema } from "@/lib/document-schemas";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, userId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateCollaboratorSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Validation failed" },
        { status: 400 }
      );
    }

    const updated = await updateCollaboratorRole(
      id,
      session.user.id,
      userId,
      parsed.data.role
    );

    return NextResponse.json({ collaborator: updated });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Failed to update collaborator";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, userId } = await params;
    await removeDocumentCollaborator(id, session.user.id, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Failed to remove collaborator";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
