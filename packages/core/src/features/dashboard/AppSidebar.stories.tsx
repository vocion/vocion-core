import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SessionProvider } from 'next-auth/react';
import { NextIntlClientProvider } from 'next-intl';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import en from '@/locales/en.json';

/**
 * The left sidebar after the airy pass: Workspace (permanent pages), Pinned
 * (per-user pins — hover any Pages/Manage row for the pin icon), Pages (the
 * workspace's own pages, seven then "More pages ›"), the dismissible invite
 * card, the workspace row; and the 56px icon rail it collapses to (tooltips
 * carry the labels). Pins/dismissals come from `nav.getPrefs` at runtime, so
 * the story shows the unpinned state; `Expanded` has nine pages to exercise
 * the overflow submenu.
 */
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

function Frame({ defaultOpen, needsYouCount, withPages = true }: { defaultOpen: boolean; needsYouCount?: number; withPages?: boolean }) {
  return (
    // The workspace switcher in the sidebar footer reads `useSession()`.
    <SessionProvider session={{ user: { id: 'user_1', name: 'Chris Fitkin', email: 'chris@example.com', accountId: 'acct_1', projectId: 'proj_1', role: 'admin' }, expires: '2099-01-01T00:00:00.000Z' }}>
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarProvider defaultOpen={defaultOpen}>
          <div className="flex h-[640px] w-[900px] overflow-hidden rounded-xl border border-border">
            <AppSidebar collapsible="icon" isAdmin needsYouCount={needsYouCount} workspacePages={withPages ? PAGES : []} className="relative! h-full" />
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
