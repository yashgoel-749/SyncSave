import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { restoreDocument } from "@/lib/document-service";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const document = await restoreDocument(id, session.user.id);
    return NextResponse.json({ document, message: "Document restored successfully" });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Error restoring document:", error);
    return NextResponse.json(
      { error: "Failed to restore document" },
      { status: 500 }
    );
  }
}
