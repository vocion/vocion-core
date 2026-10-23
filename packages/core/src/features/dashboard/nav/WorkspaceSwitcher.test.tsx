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
  it('lists Personal under You, then the workspaces, with no Org anywhere', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS, PERSONAL], 'single');

    const names = page.getByTestId('switcher-workspace').elements().map(e => e.textContent ?? '');
    const headings = page.getByTestId('switcher-group-heading').elements().map(e => e.textContent ?? '');

    expect(names[0]).toMatch(/Personal/);
    expect(headings[0]).toBe('You');
    expect(headings.slice(1).every(h => h === 'Workspaces')).toBe(true);
    expect(page.getByText('Contoso', { exact: true }).elements()).toHaveLength(0);
  });

  it('lists a one-Org person\'s workspaces with what each is', async () => {
    await renderOpen([ACCOUNTS[1]!], [PROJECTS[1]!, CONTOSO_OPS]);

    await expect.element(page.getByRole('option', { name: /Ops/ })).toHaveTextContent(/Atlas · 1 agent/);
  });
});

describe('WorkspaceSwitcher, several Orgs', () => {
  it('is one list: Personal under You, then every Org\'s workspaces under its name, the current one checked', async () => {
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS, PERSONAL]);

    const headings = page.getByTestId('switcher-group-heading').elements().map(e => e.textContent ?? '');

    expect(headings).toEqual(['You', 'Metacto', 'Contoso']);
    expect(page.getByTestId('switcher-workspace').elements()).toHaveLength(4);
    await expect.element(page.getByTestId('switcher-workspace').first()).toHaveTextContent(/Personal/);
    await expect.element(page.getByRole('group', { name: 'Contoso' }).getByRole('option', { name: /Support/ })).toHaveAttribute('aria-selected', 'true');
    // What waits on the person there.
    await expect.element(page.getByRole('option', { name: /Ops/ }).getByTestId('switcher-row-waiting')).toHaveTextContent('2');
  });

  it('opens another Org\'s workspace from its row, switching Org with it', async () => {
    const navigate = vi.fn();
    await renderOpen(ACCOUNTS, [...PROJECTS, CONTOSO_OPS], 'multi', navigate);

    await page.getByRole('group', { name: 'Metacto' }).getByRole('option', { name: /Support/ }).click();

    // Its home, Chat: never this page or its query.
    expect(navigate).toHaveBeenCalledWith('/w/support/dashboard/chat?org=metacto');
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
 * Workspace first (founder, 2026-10-23): every row says what the workspace
 * has and where it will open, and a switch lands where the sidebar says.
 */
describe('WorkspaceSwitcher, where each workspace opens', () => {
  const finance: SwitcherProject = { id: 'p-finance', slug: 'finance', name: 'Larkfield Finance', agentCount: 3, accountId: 'acct-metacto' };
  const revenue: SwitcherProject = { id: 'p-revenue', slug: 'revenue', name: 'Larkfield Revenue', agentCount: 4, accountId: 'acct-metacto' };
  const lines: Record<string, string> = { 'p-finance': 'Finance · opens in Finance', 'p-revenue': 'GTM · Routines · opens on Review' };

  it('names each workspace\'s apps and where it opens, and goes there', async () => {
    const navigate = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarProvider>
          <WorkspaceSwitcher projects={[revenue, finance]} activeId="p-revenue" defaultOpen side="bottom" rowLine={p => lines[p.id] ?? null} targetPath={p => (p.id === 'p-finance' ? '/dashboard/p/account-rules' : '/dashboard/inbox')} navigate={navigate} />
        </SidebarProvider>
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByRole('option', { name: /Larkfield Finance/ })).toHaveTextContent(/Finance · opens in Finance/);
    await expect.element(page.getByRole('option', { name: /Larkfield Revenue/ })).toHaveTextContent(/GTM · Routines · opens on Review/);

    await page.getByRole('option', { name: /Larkfield Finance/ }).click();

    expect(navigate).toHaveBeenCalledWith('/w/finance/dashboard/p/account-rules');
    // The chip names the workspace alone; the rail beside it shows the app.
    expect(page.getByTestId('workspace-switcher-where').element().textContent).toBe('Larkfield Revenue');
  });
});
