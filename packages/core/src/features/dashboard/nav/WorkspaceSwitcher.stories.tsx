import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import { NextIntlClientProvider } from 'next-intl';
import { SidebarProvider } from '@/components/ui/sidebar';
import en from '@/locales/en.json';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * The bottom-left workspace row and its popover: one, three and eight
 * workspaces (with a hidden empty seed project behind the toggle), open and
 * closed, expanded and as the icon-rail avatar, and a person in two accounts
 * whose list is grouped by account. Navigation is stubbed.
 * @param slug
 * @param name
 * @param agentCount
 */
const mk = (slug: string, name: string, agentCount = 5): SwitcherProject => ({ id: `p-${slug}`, slug, name, agentCount });
const ONE = [mk('revenue', 'Revenue Team', 10)];
const THREE = [mk('default', 'Default project', 0), mk('revenue', 'Revenue Team', 10), mk('vocion-workforce', 'Vocion Workforce', 14)];
const EIGHT = [
  ...THREE,
  mk('delivery-stack', 'Delivery Stack'),
  mk('metacto-executive', 'Metacto Executive'),
  mk('daylyte', 'Daylyte Marketing'),
  mk('support-reply', 'Support Reply Demo'),
  mk('kit-verification-qc', 'Kit Verification QC'),
];
const ACCOUNTS: SwitcherAccount[] = [
  { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
  { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
];
// Both accounts have a `sales` workspace: the Contoso one switches with `?account=contoso`.
const TWO_ACCOUNTS: SwitcherProject[] = [
  { ...mk('revenue', 'Revenue Team', 10), accountId: 'acct-metacto' },
  { ...mk('sales', 'Sales'), accountId: 'acct-metacto' },
  { ...mk('sales', 'Sales', 3), id: 'p-contoso-sales', accountId: 'acct-contoso' },
];

function Frame(props: { projects: SwitcherProject[]; accounts?: SwitcherAccount[]; defaultOpen?: boolean; collapsed?: boolean }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider defaultOpen={!props.collapsed}>
        <div className={props.collapsed ? 'flex h-[420px] w-14 flex-col justify-end rounded-xl border border-border bg-sidebar p-1' : 'flex h-[420px] w-64 flex-col justify-end rounded-xl border border-border bg-sidebar p-2'}>
          <WorkspaceSwitcher
            account={{ id: 'acct-metacto', name: 'Metacto' }}
            accounts={props.accounts}
            projects={props.projects}
            activeId="p-revenue"
            defaultOpen={props.defaultOpen}
            collapsed={props.collapsed}
            navigate={href => console.warn('navigate →', href)}
            onManage={() => console.warn('manage')}
          />
        </div>
      </SidebarProvider>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Frame> = {
  title: 'Shell/WorkspaceSwitcher',
  component: Frame,
  parameters: { layout: 'centered', nextjs: { appDirectory: true, navigation: { pathname: '/dashboard/inbox' } } },
};

export default meta;

type Story = StoryObj<typeof Frame>;

export const OneWorkspace: Story = { args: { projects: ONE } };
export const ThreeOpen: Story = { args: { projects: THREE, defaultOpen: true } };
export const EightOpen: Story = { args: { projects: EIGHT, defaultOpen: true } };
export const TwoAccountsOpen: Story = { args: { projects: TWO_ACCOUNTS, accounts: ACCOUNTS, defaultOpen: true } };
export const IconRail: Story = { args: { projects: THREE, collapsed: true } };
