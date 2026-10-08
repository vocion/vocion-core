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
 * The collapsed sidebar shows the switcher as a bare avatar, with no Org
 * line under it, so on a multi-Org deployment its label is the only place the
 * Org can show (vocion-core#128): two "Support" workspaces in two Orgs must
 * not read the same. A single-Org install (the default) never names an Org.
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
 * @param orgsMode
 */
function renderCollapsed(accounts: SwitcherAccount[], orgsMode: 'single' | 'multi' = 'multi') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider defaultOpen={false}>
        <WorkspaceSwitcher
          account={{ id: 'acct-contoso', name: 'Contoso' }}
          accounts={accounts}
          projects={PROJECTS}
          activeId="p-contoso-support"
          collapsed
          orgsMode={orgsMode}
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

  it('never names an Org on a single-Org install', async () => {
    await renderCollapsed(ACCOUNTS, 'single');

    await expect.element(page.getByRole('button', { name: 'Support', exact: true })).toBeInTheDocument();
  });
});

/**
 * The open switcher, expanded, on Contoso's "Support".
 * @param accounts - The accounts the person is in.
 * @param projects - The workspaces it lists.
 * @param orgsMode - The deployment's Org mode.
 * @param scope - Which workspaces to list (`org` when an extension asks).
 */
function renderOpen(accounts: SwitcherAccount[], projects: SwitcherProject[], orgsMode: 'single' | 'multi' = 'multi', scope: 'all' | 'org' = 'all') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider>
        <WorkspaceSwitcher
          account={{ id: 'acct-contoso', name: 'Contoso' }}
          accounts={accounts}
          projects={projects}
          activeId="p-contoso-support"
          defaultOpen
          orgsMode={orgsMode}
          scope={scope}
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

  it('shows no Org eyebrow and no Org headings on a single-Org install', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, contosoOps], 'single');

    await expect.element(page.getByRole('option', { name: /Ops/ })).toBeVisible();
    expect(page.getByRole('group').elements()).toHaveLength(0);
    expect(page.getByText('Contoso', { exact: true }).elements()).toHaveLength(0);
  });

  it('lists only the current Org\'s workspaces, ungrouped, when an extension scopes it to the Org', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, contosoOps], 'multi', 'org');

    await expect.element(page.getByRole('option', { name: /Ops/ })).toBeVisible();
    // Contoso's Support and Ops; the other Org's Support is not offered.
    expect(page.getByRole('option').elements()).toHaveLength(2);
    expect(page.getByRole('group').elements()).toHaveLength(0);
  });

  it('groups a two-account person\'s workspaces under each account\'s name', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, contosoOps]);

    await expect.element(page.getByRole('group', { name: 'Metacto' }).getByRole('option', { name: /Support/ })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Contoso' }).getByRole('option', { name: /Ops/ })).toBeVisible();
  });
});

/**
 * An app's workspace picker is this same switcher (Vocion 5.0): handed only
 * the workspaces that have the app, a placeholder for when the current one is
 * not among them, and the page each switch lands on.
 */
describe('WorkspaceSwitcher as an app\'s picker', () => {
  const contosoOps: SwitcherProject = { id: 'p-contoso-ops', slug: 'ops', name: 'Ops', agentCount: 1, accountId: 'acct-contoso' };

  it('reads as a prompt, not as the first workspace, when the current one does not have the app', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarProvider>
          <WorkspaceSwitcher account={{ id: 'acct-contoso', name: 'Contoso' }} accounts={[ACCOUNTS[1]!]} projects={[contosoOps]} activeId="p-contoso-support" placeholder="Pick a workspace" navigate={() => {}} />
        </SidebarProvider>
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByRole('button', { name: 'Switch workspace' })).toHaveTextContent(/Pick a workspace/);
    expect(page.getByText('Ops').elements()).toHaveLength(0);
  });

  it('switches to the page the picker says, through the workspace entry route', async () => {
    const navigate = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarProvider>
          <WorkspaceSwitcher account={{ id: 'acct-contoso', name: 'Contoso' }} accounts={[ACCOUNTS[1]!]} projects={[PROJECTS[1]!, contosoOps]} activeId="p-contoso-support" defaultOpen side="bottom" targetPath={() => '/dashboard/p/products'} navigate={navigate} />
        </SidebarProvider>
      </NextIntlClientProvider>,
    );

    await page.getByRole('option', { name: /Ops/ }).click();

    expect(navigate).toHaveBeenCalledWith('/w/ops/dashboard/p/products');
  });
});
