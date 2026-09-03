import type { SurfaceId } from '@/features/navigation/surfaces';
import { eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { AppSidebarHeader } from '@/features/dashboard/AppSidebarHeader';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { AgentSurfaceHotkey } from '@/features/dashboard/chat/AgentSurfaceHotkey';
import { ChatBubble } from '@/features/dashboard/chat/ChatBubble';
import { ShellBarActionsProvider } from '@/features/dashboard/ShellBarActions';
import { WorkspaceDriftBanner } from '@/features/dashboard/WorkspaceDriftBanner';
import { WorkspaceTour } from '@/features/dashboard/WorkspaceTour';
import { isSurfaceId } from '@/features/navigation/surfaces';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { readWorkspacePages } from '@/libs/workspace/pages';
import { readWorkspaceTour } from '@/libs/workspace/tour';
import { projectSchema } from '@/models/Schema';
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
  if (orgId) {
    const [project] = await db
      .select({ id: projectSchema.id, enabledSurfaces: projectSchema.enabledSurfaces })
      .from(projectSchema)
      .where(eq(projectSchema.id, orgId))
      .limit(1);
    // Drop ids this core no longer registers, so a stale workspace list can't
    // put a broken link in the sidebar.
    enabledSurfaces = (project?.enabledSurfaces ?? []).filter(isSurfaceId);
    if (!project) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">Session expired</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Your session points at a workspace that no longer exists (the database
            was reset or restored). Sign in again to continue.
          </p>
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

  // Agent picker options for the floating chat bubble. Empty outside an org —
  // the bubble renders nothing rather than a picker with no agents in it.
  const agents = orgId ? (await loadChatAgentContext(orgId)).agents : [];

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        isAdmin={has({ role: ORG_ROLE.ADMIN })}
        enabledSurfaces={enabledSurfaces}
        workspacePages={readWorkspacePages().pages.filter(p => !p.nav.hidden).map(p => ({ title: p.title, url: `/dashboard/p/${p.slug}`, section: p.nav.section }))}
      />
      <SidebarInset>
        <ShellBarActionsProvider>
          <AppSidebarHeader />

          <div className="@container flex-1 px-4 py-4 sm:px-6">
            {props.children}
          </div>
        </ShellBarActionsProvider>
        {(() => {
          const tour = readWorkspaceTour();
          return tour
            ? <WorkspaceTour steps={tour.steps} title={tour.title} autoStart={tour.autoStart} />
            : null;
        })()}
        <WorkspaceDriftBanner />
        <ChatBubble agents={agents} />
        <AgentSurfaceHotkey />
      </SidebarInset>
    </SidebarProvider>
  );
}
