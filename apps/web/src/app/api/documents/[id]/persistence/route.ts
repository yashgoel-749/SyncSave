import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { verifyDocumentAccess } from "@/lib/document-service";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const { id } = await params;
    const { document } = await verifyDocumentAccess(id, session.user.id, "VIEW");
    if (!document.yjsState?.length) return new NextResponse(null, { status: 204, headers });
    return new NextResponse(new Uint8Array(document.yjsState), {
      headers: { ...headers, "Content-Type": "application/octet-stream" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, {
        status: error instanceof AuthorizationError ? 403 : 404, headers,
      });
    }
    console.error("GET document persistence error:", error);
    return NextResponse.json({ error: "Unable to verify cloud save" }, { status: 500, headers });
  }
}
