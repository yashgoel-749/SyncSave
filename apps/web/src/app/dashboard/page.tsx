import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { getUserWorkspaces } from "@/lib/workspace-service";
import DashboardView from "@/components/DashboardView";
import { NotificationBell } from "@/components/NotificationBell";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — SyncSpace",
  description: "Your synchronized documents and collaborative workspace",
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const user = session.user;
  const userId = session.user.id as string;
  const workspaces = await getUserWorkspaces(userId);

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
              Workspace & Docs
            </span>
          </div>

          <div className="flex items-center gap-4">
            <NotificationBell />
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

            <SignOutButton redirectTo="/" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-8">
        {/* User Status Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 pb-4 border-b border-border-subtle/50">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
              Welcome back, {user.name ? user.name.split(" ")[0] : "Writer"}
            </h1>
            <p className="text-xs text-text-muted mt-0.5">
              Manage your workspaces, organize collaborative documents, and view team activity.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-emerald/10 border border-accent-emerald/20 text-accent-emerald text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse" />
              <span>Session Verified</span>
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
        />
      </main>
    </div>
  );
}
