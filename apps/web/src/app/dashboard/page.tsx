import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { getUserWorkspaces } from "@/lib/workspace-service";
import DashboardView from "@/components/DashboardView";
import { NotificationBell } from "@/components/NotificationBell";
import { SignOutButton } from "@/components/SignOutButton";
import ThemeToggle from "@/components/ThemeToggle";

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
      <header className="border-b border-border-subtle bg-surface-1 sticky top-0 z-40">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 min-h-16 py-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/" className="shrink-0 hover:opacity-90 transition-opacity" aria-label="SyncSpace home">
              <Logo size="sm" className="[&>span]:hidden sm:[&>span]:inline" />
            </Link>
            <span className="hidden sm:inline-block h-4 w-px bg-border-subtle" />
            <span className="hidden sm:inline-block text-xs font-semibold uppercase tracking-wider text-text-muted">
              Dashboard
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <ThemeToggle />
            <NotificationBell />
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-surface-2 border border-border-normal flex items-center justify-center text-text-primary font-semibold text-xs">
                {initial}
              </div>
              <div className="hidden md:flex min-w-0 max-w-48 flex-col text-left">
                <span className="truncate text-sm font-medium text-text-primary leading-tight">
                  {user.name || "User"}
                </span>
                <span className="truncate text-xs text-text-secondary leading-tight">
                  {user.email}
                </span>
              </div>
            </div>

            <SignOutButton redirectTo="/" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mx-auto max-w-[1440px] min-w-0 w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Welcome strip */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="break-words text-xl sm:text-2xl font-semibold tracking-tight text-text-primary">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary mt-2">
              Pick up where you left off, or start something new with your team.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-subtle text-text-secondary">
              <span className="font-semibold text-text-primary tabular-nums">{workspaces.length}</span>
              {workspaces.length === 1 ? "workspace" : "workspaces"}
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-subtle text-text-secondary">
              <span className="font-semibold text-text-primary tabular-nums">{totalDocuments}</span>
              {totalDocuments === 1 ? "document" : "documents"}
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-subtle text-text-secondary font-medium">
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
