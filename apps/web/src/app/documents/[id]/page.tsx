import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import Link from "next/link";
import { getDocument } from "@/lib/document-service";
import { relativeTime } from "@/lib/utils";
import { AuthorizationError, NotFoundError } from "@/lib/workspace-service";
import DocumentHeaderActions from "./DocumentHeaderActions";

export const instant = false;

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
        <div className="min-h-dvh flex items-center justify-center p-4 bg-bg-dark text-text-primary">
          <div className="card p-8 max-w-md w-full text-center border border-red-500/20 bg-bg-card">
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

  return (
    <div className="min-h-dvh flex flex-col bg-bg-dark text-text-primary">
      {/* Top Navigation Bar */}
      <header className="border-b border-border-subtle bg-bg-surface/60 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="btn btn-ghost text-xs p-1.5 text-text-muted hover:text-text-primary"
              title="Back to Dashboard"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>

            <span className="h-4 w-px bg-border-subtle" />

            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm font-semibold text-text-primary truncate max-w-[240px] sm:max-w-md">
                {doc.title || "Untitled Document"}
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wider bg-brand-primary/10 text-brand-secondary border border-brand-primary/20 flex-shrink-0">
                {doc.userRole}
              </span>
            </div>
          </div>

          {/* Interactive Document Header Actions */}
          <DocumentHeaderActions
            docId={doc.id}
            initialTitle={doc.title}
            isArchived={doc.isArchived}
            userRole={doc.userRole}
          />
        </div>
      </header>

      {/* Document Workspace Body */}
      <main className="flex-1 mx-auto max-w-4xl w-full px-4 sm:px-6 py-10">
        {/* Document Info Pill */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted pb-6 border-b border-border-subtle/50 mb-8">
          <div className="flex items-center gap-3">
            <span>Owner: <strong className="text-text-secondary">{doc.owner?.name || doc.owner?.email}</strong></span>
            {doc.workspace && (
              <>
                <span>•</span>
                <span>Workspace: <strong className="text-text-secondary">{doc.workspace.name}</strong></span>
              </>
            )}
          </div>
          <div>Last updated {relativeTime(doc.updatedAt)}</div>
        </div>

        {/* Document Canvas / Reading Surface */}
        <article className="card p-8 sm:p-12 border border-border-subtle bg-bg-card/40 min-h-[500px]">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary mb-6">
            {doc.title || "Untitled Document"}
          </h2>

          {doc.content ? (
            <div className="prose prose-invert max-w-none text-text-secondary leading-relaxed whitespace-pre-wrap">
              {doc.content}
            </div>
          ) : (
            <div className="py-16 text-center border border-dashed border-border-subtle rounded-xl bg-bg-surface/20">
              <div className="mx-auto w-10 h-10 rounded-full bg-brand-primary/10 text-brand-secondary flex items-center justify-center mb-3">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-text-primary">Blank Document Canvas</h3>
              <p className="mt-1 text-xs text-text-muted max-w-md mx-auto">
                This document is managed and saved in your database. In Milestone 4, real-time TipTap rich-text editing, live cursor presence, and Yjs WebSocket sync will be mounted here.
              </p>
            </div>
          )}
        </article>
      </main>
    </div>
  );
}
