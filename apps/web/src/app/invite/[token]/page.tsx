"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

interface InvitationData {
  id: string;
  email: string;
  role: "EDITOR" | "VIEWER";
  expiresAt: string;
  document: {
    id: string;
    title: string;
    workspaceName: string | null;
  };
  inviter: {
    name: string | null;
    email: string;
  };
}

function InviteAcceptContent() {
  const params = useParams();
  const token = params?.token as string;
  const router = useRouter();
  const { data: session, status } = useSession();

  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    async function loadInvitation() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Failed to load invitation");
          setErrorCode(data.code || "LOAD_FAILED");
          return;
        }

        setInvitation(data.invitation);
      } catch {
        setError("Unable to connect to the server. Please check your connection.");
      } finally {
        setIsLoading(false);
      }
    }

    loadInvitation();
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;

    setIsAccepting(true);
    setError(null);

    try {
      const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to accept invitation");
      }

      // Redirect directly to the document!
      router.push(`/documents/${data.documentId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to accept invitation";
      setError(msg);
      setIsAccepting(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4 bg-bg-dark text-text-primary selection:bg-brand-primary/30">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center">
          <Link href="/" className="inline-block hover:opacity-90 transition-opacity">
            <Logo size="md" />
          </Link>
        </div>

        {/* Card */}
        <div className="card p-6 sm:p-8 border border-border-subtle bg-bg-card/90 shadow-2xl rounded-2xl relative overflow-hidden backdrop-blur-xl">
          {isLoading ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-brand-primary border-t-transparent animate-spin mx-auto" />
              <p className="text-xs text-text-muted">Verifying invitation token...</p>
            </div>
          ) : error && !invitation ? (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>

              <div>
                <h2 className="text-base font-bold text-text-primary">
                  {errorCode === "EXPIRED"
                    ? "Invitation Expired"
                    : errorCode === "ALREADY_ACCEPTED"
                    ? "Invitation Already Accepted"
                    : "Invalid Invitation"}
                </h2>
                <p className="text-xs text-text-muted mt-1 max-w-xs mx-auto">
                  {error}
                </p>
              </div>

              <div className="pt-2">
                <Link href="/dashboard" className="btn btn-secondary text-xs px-4 py-2">
                  Return to Dashboard
                </Link>
              </div>
            </div>
          ) : invitation ? (
            <div className="space-y-6">
              {/* Header */}
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-brand-500/10 text-brand-secondary flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h1 className="text-lg font-bold text-text-primary">
                  Collaborate on Document
                </h1>
                <p className="text-xs text-text-muted">
                  <span className="text-text-secondary font-medium">
                    {invitation.inviter.name || invitation.inviter.email}
                  </span>{" "}
                  has invited you to collaborate in SyncSpace.
                </p>
              </div>

              {/* Document Overview Box */}
              <div className="p-4 rounded-xl bg-surface-1/70 border border-border-subtle space-y-2.5">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Document
                  </span>
                  <div className="font-semibold text-sm text-text-primary truncate">
                    {invitation.document.title || "Untitled Document"}
                  </div>
                </div>

                {invitation.document.workspaceName && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      Workspace
                    </span>
                    <div className="text-xs text-text-secondary">
                      {invitation.document.workspaceName}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-border-subtle/50 flex items-center justify-between">
                  <span className="text-xs text-text-muted">Permission Offered:</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                      invitation.role === "EDITOR"
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                        : "bg-surface-2 text-text-muted border border-border-subtle"
                    }`}
                  >
                    {invitation.role === "EDITOR" ? "Editor (Can edit)" : "Viewer (Read only)"}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              {status === "loading" ? (
                <div className="h-10 bg-surface-2 rounded-lg animate-pulse" />
              ) : session?.user ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={isAccepting}
                    className="btn btn-primary w-full py-2.5 text-xs font-semibold shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2"
                  >
                    {isAccepting ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Accepting & Opening...</span>
                      </>
                    ) : (
                      <span>Accept Invitation & Open</span>
                    )}
                  </button>

                  <div className="text-center">
                    <span className="text-[11px] text-text-muted">
                      Signed in as <strong className="text-text-secondary">{session.user.email}</strong>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Link
                    href={`/login?callbackUrl=/invite/${encodeURIComponent(token)}`}
                    className="btn btn-primary w-full py-2.5 text-xs font-semibold shadow-lg shadow-brand-primary/20 text-center block"
                  >
                    Sign In to Accept
                  </Link>

                  <Link
                    href={`/register?callbackUrl=/invite/${encodeURIComponent(token)}`}
                    className="btn btn-secondary w-full py-2 text-xs text-center block"
                  >
                    Create New Account
                  </Link>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                  {error}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-bg-canvas text-text-primary p-4">
          <div className="animate-spin w-8 h-8 rounded-full border-2 border-brand-primary border-t-transparent" />
        </div>
      }
    >
      <InviteAcceptContent />
    </React.Suspense>
  );
}
