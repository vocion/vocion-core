import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { SidebarProvider } from '@/components/ui/sidebar';
import en from '@/locales/en.json';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => '/dashboard',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

/**
 * ONE control says where you are (founder, 2026-10-08: "Double switcher"), and
 * on a multi-Org deployment it is two levels, iOS style (2026-10-09: "pick
 * org, then pick workspace on next? For orgs with 1 workspace, I should just
 * be able to click on the top level entry"). The chip names the workspace
 * alone, never "S.. › Squatch"; the Org is said inside the picker.
 */

const ACCOUNTS: SwitcherAccount[] = [
  { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
  { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
];
const PERSONAL: SwitcherProject = { id: 'p-personal', slug: 'personal-1a2b', name: 'Personal', agentCount: 1, accountId: 'acct-metacto', kind: 'personal' };
const PROJECTS: SwitcherProject[] = [
  { id: 'p-metacto-support', slug: 'support', name: 'Support', agentCount: 2, accountId: 'acct-metacto' },
  { id: 'p-contoso-support', slug: 'support', name: 'Support', agentCount: 2, accountId: 'acct-contoso' },
];
const CONTOSO_OPS: SwitcherProject = { id: 'p-contoso-ops', slug: 'ops', name: 'Ops', agentCount: 1, accountId: 'acct-contoso' };

/**
 * The collapsed switcher on Contoso's "Support".
 * @param orgsMode - The deployment's Org mode.
 */
function renderCollapsed(orgsMode: 'single' | 'multi' = 'multi') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider defaultOpen={false}>
        <WorkspaceSwitcher account={{ id: 'acct-contoso', name: 'Contoso' }} accounts={ACCOUNTS} projects={PROJECTS} activeId="p-contoso-support" collapsed orgsMode={orgsMode} navigate={() => {}} />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

describe('WorkspaceSwitcher, the chip', () => {
  it('names the workspace alone, on a multi-Org deployment too', async () => {
    await renderCollapsed('multi');

    await expect.element(page.getByRole('button', { name: 'Support', exact: true })).toBeInTheDocument();
  });

  it('never names an Org on a single-Org install', async () => {
    await renderCollapsed('single');

    await expect.element(page.getByRole('button', { name: 'Support', exact: true })).toBeInTheDocument();
  });
});

/**
 * The open switcher, expanded, on Contoso's "Support".
 * @param accounts - The accounts the person is in.
 * @param projects - The workspaces it lists.
 * @param orgsMode - The deployment's Org mode.
 * @param navigate - Where a switch goes.
 */
function renderOpen(accounts: SwitcherAccount[], projects: SwitcherProject[], orgsMode: 'single' | 'multi' = 'multi', navigate: (href: string) => void = () => {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider>
        <WorkspaceSwitcher
          account={{ id: 'acct-contoso', name: 'Contoso' }}
          accounts={accounts}
          projects={projects}
          activeId="p-contoso-support"
          defaultOpen
          side="bottom"
          orgsMode={orgsMode}
          navigate={navigate}
          details={{ 'p-contoso-ops': { leadName: 'Atlas', lastActiveAt: null, waiting: 2 } }}
        />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

describe('WorkspaceSwitcher, one Org', () => {
  it('skips the Org level: the workspaces, Personal first, with no Org anywhere', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS, PERSONAL], 'single');

    const names = page.getByTestId('switcher-workspace').elements().map(e => e.textContent ?? '');

    expect(names[0]).toMatch(/Personal/);
    expect(page.getByTestId('switcher-org').elements()).toHaveLength(0);
    expect(page.getByText('Contoso', { exact: true }).elements()).toHaveLength(0);
  });

  it('lists a one-Org person\'s workspaces with what each is', async () => {
    await renderOpen([ACCOUNTS[1]!], [PROJECTS[1]!, CONTOSO_OPS]);

    await expect.element(page.getByRole('option', { name: /Ops/ })).toHaveTextContent(/Atlas · 1 agent/);
    expect(page.getByTestId('switcher-org').elements()).toHaveLength(0);
  });
});

describe('WorkspaceSwitcher, several Orgs', () => {
  it('opens on Personal, then one row per Org, the current one checked', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS, PERSONAL]);

    const orgs = page.getByTestId('switcher-org');

    await expect.element(page.getByTestId('switcher-workspace').first()).toHaveTextContent(/Personal/);
    await expect.element(orgs.nth(0)).toHaveTextContent(/Metacto.*Support/);
    await expect.element(orgs.nth(1)).toHaveTextContent(/Contoso.*2 workspaces/);
    await expect.element(orgs.nth(1)).toHaveAttribute('aria-selected', 'true');
    // What waits on the person across the Org.
    await expect.element(orgs.nth(1).getByTestId('switcher-row-waiting')).toHaveTextContent('2');
  });

  it('opens an Org\'s one workspace straight from its row', async () => {
    const navigate = vi.fn();
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS], 'multi', navigate);

    await page.getByTestId('switcher-org').filter({ hasText: 'Metacto' }).click();

    // Its home, Chat: never this page or its query.
    expect(navigate).toHaveBeenCalledWith('/w/support/dashboard/chat?org=metacto');
  });

  it('drills into an Org with several, and comes back with ‹ Orgs, ← or Esc', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS]);

    await page.getByTestId('switcher-org').filter({ hasText: 'Contoso' }).click();

    await expect.element(page.getByTestId('switcher-level-title')).toHaveTextContent('Contoso');
    await expect.element(page.getByRole('option', { name: /Ops/ })).toBeVisible();

    await page.getByTestId('switcher-back').click();

    await expect.element(page.getByTestId('switcher-level-orgs')).toBeVisible();

    // → on an Org drills; Esc comes back without closing.
    (page.getByTestId('switcher-org').filter({ hasText: 'Contoso' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');

    await expect.element(page.getByTestId('switcher-level-workspaces')).toBeVisible();

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByTestId('switcher-level-orgs')).toBeVisible();
  });

  it('searches every Org at once, flat, each row saying its Org', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS]);

    await page.getByRole('textbox', { name: 'Search workspaces' }).fill('sup');

    const rows = page.getByTestId('switcher-workspace').elements().map(e => e.textContent ?? '');

    expect(rows).toHaveLength(2);
    expect(rows.join('|')).toMatch(/Support · Metacto/);
    expect(rows.join('|')).toMatch(/Support · Contoso/);
  });

  it('moves through the picker with the arrow keys, from the search box', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS]);

    await page.getByRole('textbox', { name: 'Search workspaces' }).click();
    await userEvent.keyboard('{ArrowDown}');
    const options = page.getByRole('option').elements();

    expect(document.activeElement).toBe(options[0]);

    await userEvent.keyboard('{ArrowDown}');

    expect(document.activeElement).toBe(options[1]);
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
