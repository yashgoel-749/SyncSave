import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { getUserWorkspaces } from "@/lib/workspace-service";
import DashboardView from "@/components/DashboardView";
import { NotificationBell } from "@/components/NotificationBell";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
  description: "Your synchronized documents and collaborative workspace",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const user = session.user;
  const userId = session.user.id as string;
  const [workspaces, { workspaceId }] = await Promise.all([getUserWorkspaces(userId), searchParams]);

  const totalDocuments = workspaces.reduce((sum, ws) => sum + (ws._count?.documents ?? 0), 0);
  const firstName = user.name ? user.name.split(" ")[0] : "there";
  const initial = (user.name?.[0] || user.email?.[0] || "?").toUpperCase();

  return (
    <div className="min-h-dvh flex flex-col bg-surface-0 text-text-primary">
      {/* Dashboard Header */}
      <header className="border-b border-border-subtle bg-surface-1/70 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="hover:opacity-90 transition-opacity" aria-label="SyncSpace home">
              <Logo size="sm" />
            </Link>
            <span className="hidden sm:inline-block h-4 w-px bg-border-subtle" />
            <span className="hidden sm:inline-block text-xs font-semibold uppercase tracking-wider text-text-muted">
              Workspace
            </span>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <NotificationBell />
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 border border-brand-400/30 flex items-center justify-center text-white font-semibold text-xs shadow-md shadow-brand-500/20">
                {initial}
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
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome strip */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6 pb-5 border-b border-border-subtle/50 animate-fade-up">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
              Welcome back, {firstName}
            </h1>
            <p className="text-xs text-text-muted mt-1">
              Pick up where you left off, or start something new with your team.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-subtle text-text-secondary">
              <span className="font-semibold text-text-primary tabular-nums">{workspaces.length}</span>
              {workspaces.length === 1 ? "workspace" : "workspaces"}
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-subtle text-text-secondary">
              <span className="font-semibold text-text-primary tabular-nums">{totalDocuments}</span>
              {totalDocuments === 1 ? "document" : "documents"}
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-500/10 border border-accent-500/20 text-accent-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
              <span>Signed in</span>
            </div>
          </div>
        </div>

        {/* Interactive Workspace & Document Manager */}
        <DashboardView
          initialWorkspaces={workspaces.map((ws) => ({
            id: ws.id,
            name: ws.name,
            description: ws.description,
            ownerId: ws.ownerId,
            _count: ws._count,
          }))}
          userId={userId}
          initialWorkspaceId={workspaceId}
        />
      </main>
    </div>
  );
}
