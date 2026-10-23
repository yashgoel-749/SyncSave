import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  addDocumentCollaborator,
  getDocumentCollaborators,
} from "@/lib/document-service";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";
import { addCollaboratorSchema } from "@/lib/document-schemas";

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
    const collaborators = await getDocumentCollaborators(id, session.user.id);
    return NextResponse.json({ collaborators });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Error fetching collaborators:", error);
    return NextResponse.json(
      { error: "Failed to fetch collaborators" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = addCollaboratorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Validation failed" },
        { status: 400 }
      );
    }

    const collaborator = await addDocumentCollaborator(
      id,
      session.user.id,
      parsed.data.email,
      parsed.data.role
    );

    return NextResponse.json({ collaborator }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to add collaborator";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
