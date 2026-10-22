import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listDocuments, createDocument } from "@/lib/document-service";
import { createDocumentSchema, documentQuerySchema } from "@/lib/document-schemas";
import { AuthorizationError } from "@/lib/workspace-service";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryObj = {
      workspaceId: searchParams.get("workspaceId") || undefined,
      search: searchParams.get("search") || undefined,
      filter: searchParams.get("filter") || "all",
      page: searchParams.get("page") || "1",
      limit: searchParams.get("limit") || "20",
    };

    const parsedQuery = documentQuerySchema.safeParse(queryObj);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: parsedQuery.error.issues[0]?.message || "Invalid query parameters" },
        { status: 400 }
      );
    }

    const result = await listDocuments(session.user.id, parsedQuery.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error listing documents:", error);
    return NextResponse.json(
      { error: "Failed to list documents" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Validation failed" },
        { status: 400 }
      );
    }

    const document = await createDocument(session.user.id, parsed.data);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error creating document:", error);
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    );
  }
}
