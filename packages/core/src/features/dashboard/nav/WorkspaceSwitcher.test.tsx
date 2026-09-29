import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SidebarProvider } from '@/components/ui/sidebar';
import en from '@/locales/en.json';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => '/dashboard',
}));

/**
 * The collapsed sidebar shows the switcher as a bare avatar, with no account
 * line under it, so its label is the only place the account can show
 * (vocion-core#128): two "Support" workspaces on two accounts must not read
 * the same.
 */

const ACCOUNTS: SwitcherAccount[] = [
  { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
  { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
];
const PROJECTS: SwitcherProject[] = [
  { id: 'p-metacto-support', slug: 'support', name: 'Support', agentCount: 2, accountId: 'acct-metacto' },
  { id: 'p-contoso-support', slug: 'support', name: 'Support', agentCount: 2, accountId: 'acct-contoso' },
];

/**
 * The collapsed switcher on Contoso's "Support".
 * @param accounts - The accounts the person is in.
 */
function renderCollapsed(accounts: SwitcherAccount[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider defaultOpen={false}>
        <WorkspaceSwitcher
          account={{ id: 'acct-contoso', name: 'Contoso' }}
          accounts={accounts}
          projects={PROJECTS}
          activeId="p-contoso-support"
          collapsed
          navigate={() => {}}
        />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

describe('WorkspaceSwitcher, collapsed', () => {
  it('names the account next to the workspace when the person is in two', async () => {
    await renderCollapsed(ACCOUNTS);

    await expect.element(page.getByRole('button', { name: 'Support · Contoso' })).toBeInTheDocument();
  });

  it('shows the workspace alone for a person in one account', async () => {
    await renderCollapsed([ACCOUNTS[1]!]);

    await expect.element(page.getByRole('button', { name: 'Support', exact: true })).toBeInTheDocument();
  });
});

/**
 * The open switcher, expanded, on Contoso's "Support".
 * @param accounts - The accounts the person is in.
 * @param projects - The workspaces it lists.
 */
function renderOpen(accounts: SwitcherAccount[], projects: SwitcherProject[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider>
        <WorkspaceSwitcher
          account={{ id: 'acct-contoso', name: 'Contoso' }}
          accounts={accounts}
          projects={projects}
          activeId="p-contoso-support"
          defaultOpen
          navigate={() => {}}
        />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

describe('WorkspaceSwitcher, open', () => {
  const contosoOps: SwitcherProject = { id: 'p-contoso-ops', slug: 'ops', name: 'Ops', agentCount: 1, accountId: 'acct-contoso' };

  it('lists a one-account person\'s workspaces as before, with no account headings', async () => {
    await renderOpen([ACCOUNTS[1]!], [PROJECTS[1]!, contosoOps]);

    await expect.element(page.getByRole('option', { name: /Ops/ })).toBeVisible();
    expect(page.getByRole('group').elements()).toHaveLength(0);
    expect(page.getByText('Metacto').elements()).toHaveLength(0);
  });

  it('groups a two-account person\'s workspaces under each account\'s name', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, contosoOps]);

    await expect.element(page.getByRole('group', { name: 'Metacto' }).getByRole('option', { name: /Support/ })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Contoso' }).getByRole('option', { name: /Ops/ })).toBeVisible();
  });
});
