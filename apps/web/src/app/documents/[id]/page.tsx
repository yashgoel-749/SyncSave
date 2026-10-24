import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import Link from "next/link";
import { getDocument } from "@/lib/document-service";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";
import { signCollabToken, getUserColor } from "@/lib/collab-token";
import DocumentEditor from "@/components/editor/DocumentEditor";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: `Document ${id.slice(-6)} — SyncSpace`,
  };
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const { id } = await params;

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/documents/${id}`);
  }

  let doc;
  try {
    doc = await getDocument(id, session.user.id);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return (
        <div className="min-h-dvh flex items-center justify-center p-4 bg-surface-0 text-text-primary">
          <div className="card p-8 max-w-md w-full text-center border border-red-500/20 bg-surface-1">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-11a4 4 0 00-8 0v4h8V6z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold">Access Denied</h2>
            <p className="mt-1 text-xs text-text-secondary">
              You do not have permission to view this document. Contact the document or workspace owner.
            </p>
            <div className="mt-6">
              <Link href="/dashboard" className="btn btn-secondary text-xs px-4 py-2">
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      );
    }
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const serializedDoc = {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    isArchived: doc.isArchived,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    owner: doc.owner,
    workspace: doc.workspace ? { id: doc.workspace.id, name: doc.workspace.name } : null,
    userRole: doc.userRole,
  };

  const userColor = getUserColor(session.user.id);
  const collabToken = signCollabToken({
    userId: session.user.id,
    name: session.user.name || null,
    email: session.user.email || "",
    documentId: id,
    role: doc.userRole as "OWNER" | "EDITOR" | "VIEWER",
    color: userColor,
    exp: new Date(doc.updatedAt).getTime() + 7 * 24 * 60 * 60 * 1000,
  });

  const collabConfig = {
    token: collabToken,
    serverUrl: process.env.NEXT_PUBLIC_COLLAB_WS_URL || "ws://localhost:1234",
    user: {
      id: session.user.id,
      name: session.user.name || session.user.email?.split("@")[0] || "Anonymous",
      email: session.user.email || "",
      color: userColor,
      role: doc.userRole,
    },
  };

  return (
    <DocumentEditor
      document={serializedDoc}
      userId={session.user.id}
      collabConfig={collabConfig}
    />
  );
}
