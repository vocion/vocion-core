import type { WorkspacePauseView } from '@/features/dashboard/WorkspaceOffSwitch';
import type { SurfaceId } from '@/features/navigation/surfaces';
import { eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AgentBudgetBanner } from '@/features/dashboard/AgentBudgetBanner';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { AppSidebarHeader } from '@/features/dashboard/AppSidebarHeader';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { AgentSurfaceHotkey } from '@/features/dashboard/chat/AgentSurfaceHotkey';
import { PageDock } from '@/features/dashboard/chat/PageDock';
import { PageContextProvider } from '@/features/dashboard/context/PageContextProvider';
import { PageWidth } from '@/features/dashboard/PageWidth';
import { ShellBarActionsProvider } from '@/features/dashboard/ShellBarActions';
import { WorkspaceDriftBanner } from '@/features/dashboard/WorkspaceDriftBanner';
import { WorkspacePausedBanner } from '@/features/dashboard/WorkspaceOffSwitch';
import { WorkspaceTour } from '@/features/dashboard/WorkspaceTour';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { pluginNav } from '@/features/navigation/pluginNav';
import { isSurfaceId } from '@/features/navigation/surfaces';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { readWorkspacePages } from '@/libs/workspace/pages';
import { listPlugins } from '@/libs/workspace/plugins';
import { readWorkspaceTour } from '@/libs/workspace/tour';
import { projectSchema } from '@/models/Schema';
import { agentBudgetStatuses, listAgentBudgets, orgUsageTotals } from '@/services/BudgetService';
import { needsYouCount } from '@/services/InboxService';
import { mountedWorkspaceIsProjects, projectPagesFolder } from '@/services/WorkspaceMountService';
import { readWorkspacePauseWithName } from '@/services/workspacePause';
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
  // Plugins the workspace turned on (workspace.yaml `plugins:`), same row —
  // plugin-owned nav rows (Data rooms) show only while their plugin is on.
  let enabledPlugins: string[] = [];
  // The workspace the shell is showing — named in the top bar so "where am I"
  // is answered without opening the switcher (design principle 8).
  let workspace: { slug: string; name: string } | null = null;
  // The off switch, read on the server with the project row the stale-session
  // guard already fetches. Server-rendered on purpose: a banner that arrives
  // after a client fetch shows every page as running for a moment first, and
  // the one state this must never misreport is "stopped".
  let pause: WorkspacePauseView | null = null;
  if (orgId) {
    const [project] = await db
      .select({ id: projectSchema.id, slug: projectSchema.slug, name: projectSchema.name, enabledSurfaces: projectSchema.enabledSurfaces, enabledPlugins: projectSchema.enabledPlugins, pausedAt: projectSchema.pausedAt })
      .from(projectSchema)
      .where(eq(projectSchema.id, orgId))
      .limit(1);
    // Drop ids this core no longer registers, so a stale workspace list can't
    // put a broken link in the sidebar.
    enabledSurfaces = (project?.enabledSurfaces ?? []).filter(isSurfaceId);
    enabledPlugins = project?.enabledPlugins ?? [];
    workspace = project ? { slug: project.slug, name: project.name } : null;
    if (project?.pausedAt) {
      const held = await readWorkspacePauseWithName(orgId);
      pause = held && { byName: held.by.name ?? held.by.id, when: formatPauseTime(held.at), note: held.note };
    }
    if (!project) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">Session expired</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Your session points at a workspace that no longer exists (the database
            was reset or restored). Sign in again to continue.
          </p>
          { }
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

  // Agent picker options for the dock (and the ⌘K palette). Empty outside an
  // org — the dock renders nothing rather than a picker with no agents in it.
  const agents = orgId ? (await loadChatAgentContext(orgId)).agents : [];
  // The "Review queue" badge. Counted in SQL, and a failure here must never take
  // the shell down — a badge that reads 0 is a smaller fault than no page.
  const waiting = orgId ? await needsYouCount(orgId).catch(() => 0) : 0;
  const isAdmin = has({ role: ORG_ROLE.ADMIN });
  // Where each enabled plugin's rows sit (plugin.yaml `nav.section`): its
  // pages, the core routes it owns and its surfaces fold into one section, so
  // the generic Pages and surface groups skip what a plugin claimed. The
  // project's plugins come from the row read above — no second lookup — so a
  // plugin only this project turned on lists its pages under a shared mount.
  // The mounted folder's own pages (and its plugins') list only for the
  // project that folder was applied to; another project under the same mount
  // sees its plugins' pages and nothing of the folder's.
  const mounted = orgId ? await mountedWorkspaceIsProjects(orgId).catch(() => false) : true;
  const ownDir = orgId && !mounted ? await projectPagesFolder(orgId).catch(() => null) : null;
  const pages = readWorkspacePages({ enabledPlugins, mounted, dir: ownDir }).pages;
  const nav = pluginNav({
    plugins: safeListPlugins().filter(p => enabledPlugins.includes(p.manifest.slug)).map(p => p.manifest),
    pages,
    routes: DASHBOARD_ROUTES,
  });
  // This workspace's spend vs cap this period — the header avatar's ring and
  // the menu's usage row. Hidden entirely when no budget exists.
  //
  // Spend is read off the workspace-wide row rather than summed over the
  // agents: before #279 the ring showed agent turns only, so a workspace could
  // sit at a comfortable fraction of its cap while most of the bill — every
  // embedding, rerank and generated image — was not in the number at all. The
  // cap is the workspace's own when an admin set one, and the sum of the agent
  // caps otherwise, which is what the ring meant before.
  const usage = orgId
    ? await Promise.all([orgUsageTotals({ orgId }), listAgentBudgets(orgId)])
        .then(([totals, rows]) => {
          const agentCaps = rows.map(b => b.hardCentsLimit).filter((c): c is number => typeof c === 'number');
          const capCents = totals.hardCentsLimit
            ?? (agentCaps.length > 0 ? agentCaps.reduce((a, c) => a + c, 0) : null);
          const anythingToShow = totals.spentCents > 0 || rows.length > 0 || capCents !== null;
          return anythingToShow ? { spentCents: totals.spentCents, capCents } : null;
        })
        .catch(() => null)
    : null;

  // Agents that have spent through their cap — a default one included, since
  // every agent without a budget of its own runs on one (#272). Loud on
  // purpose: a refused turn is the person's first sign otherwise. A read that
  // fails hides the banner rather than the page.
  const blockedAgents = orgId
    ? await agentBudgetStatuses(orgId)
        .then(status => status.agents.filter(agent => agent.blocked))
        .catch((error: unknown) => {
          console.warn('app shell: could not read agent budgets for the banner', { orgId, error: error instanceof Error ? error.message : String(error) });
          return [];
        })
    : [];

  return (
    // The shell IS the viewport: `h-svh` over `min-h-svh` is what stops the
    // window scrolling and carrying the sidebar and the top bar with it.
    // On a PHONE the document scrolls; from `md` up the shell is the viewport
    // and the gutter scrolls inside it.
    //
    // The desktop rule earned itself: a fixed shell is what stops the sidebar,
    // the top bar and every pane header drifting, and what killed the
    // scroll-in-scroll bug. On a phone it costs more than it buys. There is no
    // second pane to hold still, iOS never collapses its URL bar because the
    // document never moves, and — the reason this changed — the operating
    // system cannot screenshot what it cannot scroll: Safari's Full Page
    // capture reads the DOCUMENT, so on every dashboard page it returned one
    // viewport and grey below it (Chris, 2026-09-22, trying to send feedback:
    // "This full screen capture doesn't work. FIX"). A person who cannot
    // capture a page cannot report what is wrong with it.
    <SidebarProvider defaultOpen={defaultOpen} className="min-h-svh md:h-svh md:overflow-hidden">
      {/* Airy pass (B-034b §3): the sidebar collapses to a 56px icon rail
          instead of sliding off-canvas; the rail toggle / ⌘B persist it. */}
      <AppSidebar
        collapsible="icon"
        isAdmin={isAdmin}
        enabledPlugins={enabledPlugins}
        enabledSurfaces={enabledSurfaces.filter(id => !nav.claimedSurfaces.includes(id))}
        pluginNav={nav}
        needsYouCount={waiting}
        workspacePages={pages.filter(p => !p.nav.hidden && !nav.claimedPages.includes(p.slug)).map(p => ({ title: p.title, url: p.href ?? `/dashboard/p/${p.slug}`, section: p.nav.section, secondary: p.nav.secondary }))}
      />
      <SidebarInset className="md:min-h-0 md:overflow-hidden">
        <ShellBarActionsProvider>
          <AppSidebarHeader workspace={workspace} usage={usage} canPauseWorkspace={Boolean(orgId) && isAdmin && pause === null} />

          {/* The workspace's state, above every page in it until someone
              lifts it. Inside the inset rather than fixed, so it pushes the
              page down instead of covering the first line of it. */}
          {pause && <WorkspacePausedBanner pause={pause} canResume={isAdmin} />}
          <AgentBudgetBanner blocked={blockedAgents} />

          {/* The page, full width, and the one conversation surface (058) as
              an overlay on its right edge — collapsed to an edge tab until
              opened, on a record page too (2026-09-16, docs/design/patterns.md).
              `--rail-inset` is the room an OPEN rail is taking: the gutter
              pads itself by that much so the panel never covers the record,
              and the page is full width again the moment it closes. Record
              pages that mount their own scoped dock inside `children` are
              skipped by PageDock. */}
          <PageContextProvider>
            <div className="flex items-stretch md:min-h-0 md:flex-1">
              {/* The page gutter and the reading-width cap are one owner now
                  (`PageWidth`): it knows the route, so it knows whether the
                  page is capped, and whether the gutter scrolls or the page
                  lays itself out to the height it was given. The gutter pads
                  by `--rail-inset`, so a full-bleed page never sits under an
                  open rail either. */}
              <PageWidth>{props.children}</PageWidth>
              <PageDock agents={agents} />
            </div>
          </PageContextProvider>
        </ShellBarActionsProvider>
        {(() => {
          const tour = readWorkspaceTour();
          return tour
            ? <WorkspaceTour steps={tour.steps} title={tour.title} autoStart={tour.autoStart} />
            : null;
        })()}
        <WorkspaceDriftBanner />
        <AgentSurfaceHotkey isAdmin={isAdmin} enabledPlugins={enabledPlugins} agents={agents.map(a => ({ slug: a.slug, name: a.name, description: a.description }))} />
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * "Sep 21, 3:14 PM UTC". Formatted on the server so the banner's timestamp
 * cannot hydrate to a mismatch against a browser in another locale.
 * @param at - When the switch was pulled.
 */
function formatPauseTime(at: Date): string {
  return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(at)} UTC`;
}

/** The plugin catalogue, or nothing — a broken plugin.yaml must never take the shell down. */
function safeListPlugins(): ReturnType<typeof listPlugins> {
  try {
    return listPlugins();
  } catch {
    return [];
  }
}
