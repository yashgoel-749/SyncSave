import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export const instant = false;

export const metadata = {
  title: "Dashboard — SyncSpace",
  description: "Your synchronized documents and collaborative workspace",
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const { user } = session;

  return (
    <div className="min-h-dvh flex flex-col bg-bg-dark text-text-primary">
      {/* Dashboard Header */}
      <header className="border-b border-border-subtle bg-bg-surface/50 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="hover:opacity-90 transition-opacity">
              <Logo size="sm" />
            </Link>
            <span className="hidden sm:inline-block h-4 w-px bg-border-subtle" />
            <span className="hidden sm:inline-block text-xs font-semibold uppercase tracking-wider text-text-muted">
              Workspace
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-brand-primary/20 border border-brand-primary/30 flex items-center justify-center text-brand-secondary font-medium text-xs">
                {user.name ? user.name[0]?.toUpperCase() : user.email?.[0]?.toUpperCase()}
              </div>
              <div className="hidden md:flex flex-col text-left">
                <span className="text-xs font-medium text-text-primary leading-tight">
                  {user.name || "User"}
                </span>
                <span className="text-[11px] text-text-muted leading-tight">
                  {user.email}
                </span>
              </div>
            </div>

            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                id="signout-button"
                className="btn btn-ghost text-xs text-text-muted hover:text-red-400 py-1.5 px-3 border border-border-subtle hover:border-red-500/30 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-10">
        {/* Welcome Banner */}
        <div className="card p-6 sm:p-8 bg-gradient-to-r from-bg-card via-bg-surface to-bg-card border border-border-subtle relative overflow-hidden mb-8">
          <div className="absolute right-0 top-0 w-80 h-full bg-brand-primary/5 blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-accent-emerald/10 border border-accent-emerald/20 text-accent-emerald text-xs font-medium mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse" />
                Active Protected Session
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                Welcome, {user.name || user.email?.split("@")[0]}!
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                Your authenticated session is active and securely verified on the server.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="btn btn-secondary text-xs px-4 py-2"
              >
                Back to Landing
              </Link>
            </div>
          </div>
        </div>

        {/* User Session Info Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card p-5 border border-border-subtle bg-bg-card/60">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
              Account Identifier
            </div>
            <div className="font-mono text-xs text-text-primary break-all bg-bg-surface/80 p-2 rounded border border-border-subtle">
              {user.id || "N/A"}
            </div>
          </div>

          <div className="card p-5 border border-border-subtle bg-bg-card/60">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
              Registered Email
            </div>
            <div className="text-sm font-medium text-text-primary">
              {user.email}
            </div>
            <div className="text-xs text-accent-emerald mt-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Verified via Session
            </div>
          </div>

          <div className="card p-5 border border-border-subtle bg-bg-card/60">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
              Session Security
            </div>
            <div className="text-sm font-medium text-text-primary">
              Encrypted JWT Cookie
            </div>
            <div className="text-xs text-text-muted mt-1">
              Server-enforced via Auth.js
            </div>
          </div>
        </div>

        {/* Next Milestone Readiness */}
        <div className="card p-8 border border-dashed border-border-subtle bg-bg-surface/30 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-secondary mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-1">
            Documents Workspace
          </h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto mb-4">
            Milestone 2 authentication is complete. In Milestone 3, real-time TipTap editor, Yjs document persistence, and offline storage will be connected here.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-card border border-border-subtle text-xs text-text-muted">
            <span className="w-2 h-2 rounded-full bg-brand-primary" />
            Awaiting Milestone 3
          </div>
        </div>
      </main>
    </div>
  );
}
