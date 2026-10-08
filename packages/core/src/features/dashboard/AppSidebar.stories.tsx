import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { AppNav } from '@/features/navigation/apps';
import { SessionProvider } from 'next-auth/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { openManageView, writeNavView } from '@/features/dashboard/useNavView';
import en from '@/locales/en.json';

/**
 * The left sidebar after the airy pass: Workspace (permanent pages), Pinned
 * (per-user pins — hover any Pages/Manage row for the pin icon), Pages (the
 * workspace's own pages, seven then "More pages ›"), the dismissible invite
 * card, the "Manage workspace" row, the workspace row; and the 56px icon rail
 * it collapses to (tooltips carry the labels). Pins/dismissals come from
 * `nav.getPrefs` at runtime, so the story shows the unpinned state; `Expanded`
 * has nine pages to exercise the overflow submenu.
 *
 * `ManageView` is the other half of the pair Chris asked back for on
 * 2026-09-15 ("we lost nav access to workspace settings"): the visible row is
 * the way in, "Back to work" the way out, and both survive the icon rail. Its
 * sections (Team · Knowledge · Build · Insights · Organization) and the WORK
 * rows both come from `features/navigation/dashboardNav.ts`.
 */
/**
 * The app rail (Vocion 5.0) for a workspace with the Software Factory on:
 * Workforce, the core app, then the factory with its own sections. In the
 * story runner the directory RPC is absent, so the rail shows this
 * workspace's apps only and every picker lists nothing.
 */
const APPS: AppNav[] = [
  { id: 'workforce', name: 'Workforce', icon: 'users', tint: 'sky', order: 0, core: true, entry: '/dashboard/chat', href: '/dashboard/chat', sections: [], owns: [] },
  {
    id: 'software-factory',
    name: 'Software Factory',
    icon: 'git-branch',
    tint: 'mint',
    order: 2,
    core: false,
    entry: '/dashboard/p/products',
    href: '/dashboard/p/products',
    owns: ['/dashboard/p/products', '/dashboard/p/work', '/dashboard/p/releases', '/dashboard/p/incidents'],
    sections: [
      { label: 'Software factory', items: [
        { title: 'Products', url: '/dashboard/p/products', icon: 'layout-dashboard' },
        { title: 'Work', url: '/dashboard/p/work', icon: 'list-checks' },
        { title: 'Releases', url: '/dashboard/p/releases', icon: 'rocket' },
        { title: 'Evals', url: '/dashboard/evals', icon: 'test-tube', secondary: true },
      ] },
      { label: 'Production Watch', items: [{ title: 'Incidents', url: '/dashboard/p/incidents', icon: 'siren' }] },
    ],
  },
];

/**
 * Enough of a session for `useSession()`. The switcher only needs an
 * authenticated one; the tenancy fields are what this app's `Session` type
 * carries (see libs/Auth.ts), not something the sidebar reads.
 */
const STORY_SESSION = {
  user: {
    id: 'usr-story',
    name: 'E2E Admin',
    email: 'admin@example.test',
    accountId: 'acct-story',
    projectId: 'proj-story',
    role: 'admin' as const,
    workspaceRole: 'admin' as const,
  },
  expires: '2999-01-01T00:00:00.000Z',
};

const PAGES = [
  { title: 'Deal desk', url: '/dashboard/p/deal-desk', section: 'Pages' },
  { title: 'Hiring pipeline', url: '/dashboard/p/hiring', section: 'Pages' },
  { title: 'Weekly brief', url: '/dashboard/p/weekly-brief', section: 'Pages' },
  { title: 'Renewals', url: '/dashboard/p/renewals', section: 'Pages' },
  { title: 'Inbound', url: '/dashboard/p/inbound', section: 'Pages' },
  { title: 'Content calendar', url: '/dashboard/p/content', section: 'Pages' },
  { title: 'Red-team reviews', url: '/dashboard/p/red-team', section: 'Pages' },
  { title: 'Videos', url: '/dashboard/p/videos', section: 'Pages' },
  { title: 'Backlinks', url: '/dashboard/p/backlinks', section: 'Pages' },
];

function Frame({ defaultOpen, needsYouCount, withPages = true, manage = false, withApps = true }: { defaultOpen: boolean; needsYouCount?: number; withPages?: boolean; manage?: boolean; withApps?: boolean }) {
  // The manage view is a sidebar mode restored from localStorage after mount;
  // the story asks for it the way the header's avatar menu does.
  useEffect(() => {
    if (manage) {
      openManageView();
    }
    return () => writeNavView(globalThis.localStorage, 'work');
  }, [manage]);
  return (
    // The workspace switcher inside the sidebar calls `useSession()`, so the
    // story needs the same provider the authenticated layout supplies. The
    // session is passed in rather than fetched: without it the provider hits
    // /api/auth/session, which does not exist under the story runner.
    <SessionProvider session={STORY_SESSION}>
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarProvider defaultOpen={defaultOpen} style={{ '--sidebar-width': '18rem', '--sidebar-width-icon': '7rem' } as React.CSSProperties}>
          <div className="flex h-[640px] w-[900px] overflow-hidden rounded-xl border border-border">
            <AppSidebar collapsible="icon" isAdmin needsYouCount={needsYouCount} workspacePages={withPages ? PAGES : []} apps={withApps ? APPS : []} className="relative! h-full" />
            <SidebarInset className="p-10 text-[13px] text-muted-foreground">Page content</SidebarInset>
          </div>
        </SidebarProvider>
      </NextIntlClientProvider>
    </SessionProvider>
  );
}

const meta: Meta<typeof Frame> = {
  title: 'Shell/AppSidebar',
  component: Frame,
  parameters: { layout: 'centered', nextjs: { appDirectory: true, navigation: { pathname: '/dashboard/briefings' } } },
};

export default meta;

type Story = StoryObj<typeof Frame>;

export const Expanded: Story = { args: { defaultOpen: true, needsYouCount: 3 } };
export const IconRail: Story = { args: { defaultOpen: false, needsYouCount: 3 } };
export const NoCustomPages: Story = { args: { defaultOpen: true, needsYouCount: 0, withPages: false } };

/** Everything configurational, with "Back to work" at the top. */
export const ManageView: Story = { args: { defaultOpen: true, needsYouCount: 3, manage: true } };

/** The manage view in the icon rail — tooltips carry every label, exits included. */
export const ManageViewIconRail: Story = { args: { defaultOpen: false, needsYouCount: 3, manage: true } };

/** The Software Factory picked in the rail: Chat and Review, then only the factory's sections. */
export const SoftwareFactoryApp: Story = {
  args: { defaultOpen: true, needsYouCount: 3 },
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: '/dashboard/p/products' } } },
};

/** No app catalogue: no rail, the brand at the head of the nav, as before 3.0. */
export const WithoutRail: Story = { args: { defaultOpen: true, needsYouCount: 3, withApps: false } };
