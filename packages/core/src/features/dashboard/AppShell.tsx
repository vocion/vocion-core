import type { SurfaceId } from '@/features/navigation/surfaces';
import { eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { AppSidebarHeader } from '@/features/dashboard/AppSidebarHeader';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { AgentSurfaceHotkey } from '@/features/dashboard/chat/AgentSurfaceHotkey';
import { PageDock } from '@/features/dashboard/chat/PageDock';
import { ShellBarActionsProvider } from '@/features/dashboard/ShellBarActions';
import { WorkspaceDriftBanner } from '@/features/dashboard/WorkspaceDriftBanner';
import { WorkspaceTour } from '@/features/dashboard/WorkspaceTour';
import { isSurfaceId } from '@/features/navigation/surfaces';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { readWorkspacePages } from '@/libs/workspace/pages';
import { readWorkspaceTour } from '@/libs/workspace/tour';
import { projectSchema } from '@/models/Schema';
import { listAgentBudgets } from '@/services/BudgetService';
import { needsYouCount } from '@/services/InboxService';
import { ORG_ROLE } from '@/types/Auth';
import { AppConfig } from '@/utils/AppConfig';

/**
 * The signed-in application shell — sidebar, header, drift banner. Shared by
 * every top-level authenticated segment so the surfaces that live outside
 * `/dashboard` (`/gtm/...`, and whatever a later section adds) get the same
 * chrome without the tree being moved or the layout being copy-pasted.
 * @param props
 * @param props.locale
 * @param props.children
 */
export async function AppShell(props: { locale: string; children: React.ReactNode }) {
  setRequestLocale(props.locale);

  // Stale-session guard: a session whose project no longer exists (DB reset,
  // restore, re-provision) used to render a fully-EMPTY dashboard with no
  // error — every query scoped to a ghost org. Force a legible re-auth
  // instead of a silent blank workspace.
  const { orgId, has } = await auth();
  // Surfaces the workspace switched on (workspace.yaml `surfaces:`), read from
  // the same project row the stale-session guard already fetches.
  let enabledSurfaces: SurfaceId[] = [];
  // The workspace the shell is showing — named in the top bar so "where am I"
  // is answered without opening the switcher (MANIFESTO §11).
  let workspace: { slug: string; name: string } | null = null;
  if (orgId) {
    const [project] = await db
      .select({ id: projectSchema.id, slug: projectSchema.slug, name: projectSchema.name, enabledSurfaces: projectSchema.enabledSurfaces })
      .from(projectSchema)
      .where(eq(projectSchema.id, orgId))
      .limit(1);
    // Drop ids this core no longer registers, so a stale workspace list can't
    // put a broken link in the sidebar.
    enabledSurfaces = (project?.enabledSurfaces ?? []).filter(isSurfaceId);
    workspace = project ? { slug: project.slug, name: project.name } : null;
    if (!project) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">Session expired</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Your session points at a workspace that no longer exists (the database
            was reset or restored). Sign in again to continue.
          </p>
          {/* eslint-disable-next-line next/no-html-link-for-pages -- an Auth.js route handler, not a page */}
          <a
            href="/api/auth/signout"
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
          >
            Sign out and sign back in
          </a>
        </div>
      );
    }
  }

  // Get the persisted sidebar state from the cookie
  const cookieStore = await cookies();
  // If the cookie is not set, default to open
  const defaultOpen = cookieStore.get(AppConfig.sidebarCookieName)?.value !== 'false';

  // Agent picker options for the dock. Empty outside an org — the dock
  // renders nothing rather than a picker with no agents in it.
  const agents = orgId ? (await loadChatAgentContext(orgId)).agents : [];
  // The "Needs you" badge. Counted in SQL, and a failure here must never take
  // the shell down — a badge that reads 0 is a smaller fault than no page.
  const waiting = orgId ? await needsYouCount(orgId).catch(() => 0) : 0;
  const isAdmin = has({ role: ORG_ROLE.ADMIN });
  // This workspace's spend vs cap this period — the header avatar's ring and
  // the menu's usage row. Hidden entirely when no budget exists.
  const usage = orgId
    ? await listAgentBudgets(orgId)
        .then((rows) => {
          const spentCents = rows.reduce((acc, b) => acc + (b.currentCents ?? 0), 0);
          const caps = rows.map(b => b.hardCentsLimit).filter((c): c is number => typeof c === 'number');
          const capCents = caps.length > 0 ? caps.reduce((a, c) => a + c, 0) : null;
          return rows.length > 0 ? { spentCents, capCents } : null;
        })
        .catch(() => null)
    : null;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      {/* Airy pass (B-034b §3): the sidebar collapses to a 56px icon rail
          instead of sliding off-canvas; the rail toggle / ⌘B persist it. */}
      <AppSidebar
        collapsible="icon"
        isAdmin={isAdmin}
        enabledSurfaces={enabledSurfaces}
        needsYouCount={waiting}
        workspacePages={readWorkspacePages().pages.filter(p => !p.nav.hidden).map(p => ({ title: p.title, url: `/dashboard/p/${p.slug}`, section: p.nav.section }))}
      />
      <SidebarInset>
        <ShellBarActionsProvider>
          <AppSidebarHeader workspace={workspace} usage={usage} />

          {/* The page and, beside it, the one conversation surface (058): the
              dock as a third column at a third of the screen, collapsed to a
              button until opened. Record pages that mount their own scoped
              dock inside `children` are skipped by PageDock. */}
          <div className="flex flex-1 items-stretch">
            {/* Page gutter (B-034b §3): 24px → 40px, 32px vertical, reading
                width capped so prose never runs the whole monitor. */}
            <div className="@container min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
              <div className="mx-auto w-full max-w-[1180px]">
                {props.children}
              </div>
            </div>
            <PageDock agents={agents} />
          </div>
        </ShellBarActionsProvider>
        {(() => {
          const tour = readWorkspaceTour();
          return tour
            ? <WorkspaceTour steps={tour.steps} title={tour.title} autoStart={tour.autoStart} />
            : null;
        })()}
        <WorkspaceDriftBanner />
        <AgentSurfaceHotkey isAdmin={isAdmin} agents={agents.map(a => ({ slug: a.slug, name: a.name, description: a.description }))} />
      </SidebarInset>
    </SidebarProvider>
  );
}
