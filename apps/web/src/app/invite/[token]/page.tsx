"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
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

interface InvitationResponse {
  invitation: InvitationData;
  alreadyAccepted: boolean;
  requiresSignIn: boolean;
  guestSignInAvailable: boolean;
}

function InviteAcceptContent() {
  const params = useParams();
  const token = params?.token as string;
  const router = useRouter();
  const { data: session, status } = useSession();

  const [data, setData] = useState<InvitationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function loadInvitation() {
      try {
        const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
        const body = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError(body.error || "Failed to load invitation");
          setErrorCode(body.code || "LOAD_FAILED");
          return;
        }

        setData(body as InvitationResponse);
      } catch {
        if (!cancelled) setError("Unable to connect to the server. Please check your connection.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadInvitation();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const invitation = data?.invitation ?? null;
  const documentHref = invitation ? `/documents/${invitation.document.id}` : "/dashboard";
  const signedInAsInvitee =
    Boolean(session?.user?.email) &&
    Boolean(invitation) &&
    session!.user!.email!.toLowerCase() === invitation!.email.toLowerCase();

  // Signed-in user accepts the invitation for their own account
  const handleAccept = async () => {
    if (!token) return;
    setIsAccepting(true);
    setError(null);

    try {
      const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to accept invitation");
      }
      router.push(`/documents/${body.documentId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
      setIsAccepting(false);
    }
  };

  // Invitee without an account: passwordless guest sign-in using the invitation token
  const handleJoinAsGuest = async () => {
    if (!token || !invitation) return;
    setIsJoining(true);
    setError(null);

    try {
      const result = await signIn("invite-token", { token, redirect: false });
      if (!result || result.error) {
        throw new Error(
          "This invitation can't be used for instant access. Sign in with your existing account instead."
        );
      }
      router.push(documentHref);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to join");
      setIsJoining(false);
    }
  };

  const loginHref = `/login?callbackUrl=/invite/${encodeURIComponent(token)}`;
  const registerHref = `/register?callbackUrl=/invite/${encodeURIComponent(token)}`;

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4 bg-surface-0 mesh-bg text-text-primary">
      <div className="w-full max-w-md space-y-6 animate-in fade-in zoom-in-95 duration-300">
        <div className="text-center">
          <Link href="/" className="inline-block hover:opacity-90 transition-opacity">
            <Logo size="md" />
          </Link>
        </div>

        <div className="card p-6 sm:p-8 bg-surface-1/90 shadow-2xl rounded-2xl relative overflow-hidden backdrop-blur-xl">
          {isLoading ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin mx-auto" />
              <p className="text-xs text-text-muted">Verifying invitation…</p>
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
                    ? "Invitation expired"
                    : errorCode === "ALREADY_ACCEPTED"
                    ? "Invitation already used"
                    : "Invalid invitation"}
                </h2>
                <p className="text-xs text-text-muted mt-1 max-w-xs mx-auto">{error}</p>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
                {errorCode === "ALREADY_ACCEPTED" && !session?.user && (
                  <Link href={loginHref} className="btn btn-primary text-xs px-4 py-2">
                    Sign in to open it
                  </Link>
                )}
                <Link href="/dashboard" className="btn btn-secondary text-xs px-4 py-2">
                  Go to dashboard
                </Link>
              </div>
            </div>
          ) : invitation ? (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h1 className="text-lg font-bold text-text-primary">
                  {data?.alreadyAccepted ? "Welcome back" : "You're invited to collaborate"}
                </h1>
                <p className="text-xs text-text-muted">
                  <span className="text-text-secondary font-medium">
                    {invitation.inviter.name || invitation.inviter.email}
                  </span>{" "}
                  {data?.alreadyAccepted ? "shared this document with you." : "has invited you to work on a document in SyncSpace."}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-2/70 border border-border-subtle space-y-2.5">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Document</span>
                  <div className="font-semibold text-sm text-text-primary truncate">
                    {invitation.document.title || "Untitled Document"}
                  </div>
                </div>

                {invitation.document.workspaceName && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Workspace</span>
                    <div className="text-xs text-text-secondary">{invitation.document.workspaceName}</div>
                  </div>
                )}

                <div className="pt-2 border-t border-border-subtle/50 flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">Invited email</span>
                  <span className="text-xs text-text-secondary truncate">{invitation.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Permission</span>
                  <span className={`badge ${invitation.role === "EDITOR" ? "badge-accent" : "badge-muted"}`}>
                    {invitation.role === "EDITOR" ? "Editor · can edit" : "Viewer · read only"}
                  </span>
                </div>
              </div>

              {status === "loading" ? (
                <div className="skeleton h-10 rounded-lg" />
              ) : session?.user ? (
                <div className="space-y-3">
                  {data?.alreadyAccepted || signedInAsInvitee ? null : (
                    <p className="text-[11px] text-text-muted text-center">
                      Accepting adds this document to the account you&apos;re signed in with.
                    </p>
                  )}
                  {data?.alreadyAccepted ? (
                    <Link href={documentHref} className="btn btn-primary w-full py-2.5 text-xs font-semibold text-center block">
                      Open document
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAccept}
                      disabled={isAccepting}
                      className="btn btn-primary w-full py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
                    >
                      {isAccepting ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Accepting &amp; opening…</span>
                        </>
                      ) : (
                        <span>Accept invitation &amp; open</span>
                      )}
                    </button>
                  )}
                  <div className="text-center">
                    <span className="text-[11px] text-text-muted">
                      Signed in as <strong className="text-text-secondary">{session.user.email}</strong>
                    </span>
                  </div>
                </div>
              ) : data?.guestSignInAvailable ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleJoinAsGuest}
                    disabled={isJoining}
                    className="btn btn-primary w-full py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    {isJoining ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Opening document…</span>
                      </>
                    ) : (
                      <span>{data?.alreadyAccepted ? "Continue to document" : "Join & open document"}</span>
                    )}
                  </button>
                  <p className="text-[11px] text-text-muted text-center leading-relaxed">
                    No account or password needed — you&apos;ll join as{" "}
                    <strong className="text-text-secondary">{invitation.email}</strong>. You can add a
                    password later from the sign-up page to keep the account.
                  </p>
                  <div className="text-center">
                    <Link href={loginHref} className="text-[11px] text-brand-400 hover:text-brand-300 hover:underline">
                      Have an existing account? Sign in instead
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[11px] text-text-muted text-center">
                    <strong className="text-text-secondary">{invitation.email}</strong> already has a SyncSpace account.
                    Sign in to accept the invitation.
                  </p>
                  <Link href={loginHref} className="btn btn-primary w-full py-2.5 text-xs font-semibold text-center block">
                    Sign in to accept
                  </Link>
                  <Link href={registerHref} className="btn btn-secondary w-full py-2 text-xs text-center block">
                    Use a different account
                  </Link>
                </div>
              )}

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs animate-in fade-in">
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
        <div className="min-h-dvh flex items-center justify-center bg-surface-0 text-text-primary p-4">
          <div className="animate-spin w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      }
    >
      <InviteAcceptContent />
    </React.Suspense>
  );
}
