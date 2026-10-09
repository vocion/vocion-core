import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SidebarProvider } from '@/components/ui/sidebar';
import en from '@/locales/en.json';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => '/dashboard/p/products',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

/**
 * The picker's two levels on a phone, with the app's styles (founder,
 * 2026-10-09: "pick org, then pick workspace on next? For orgs with 1
 * workspace, I should just be able to click on the top level entry").
 * `VITE_SHOTS_DIR` saves each level for the pull request.
 */

const ACCOUNTS: SwitcherAccount[] = [
  { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
  { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel' },
];
const PROJECTS: SwitcherProject[] = [
  { id: 'p-personal', slug: 'personal-1a2b', name: 'Personal', agentCount: 1, accountId: 'acct-northwind', kind: 'personal' },
  { id: 'p-nw', slug: 'northwind', name: 'Northwind', agentCount: 7, accountId: 'acct-northwind' },
  { id: 'p-kc-deals', slug: 'deals', name: 'Deal Desk', agentCount: 4, accountId: 'acct-kestrel' },
  { id: 'p-kc-ops', slug: 'ops', name: 'Kestrel Ops', agentCount: 2, accountId: 'acct-kestrel' },
  { id: 'p-kc-empty', slug: 'pilot', name: 'Pilot', agentCount: 0, accountId: 'acct-kestrel' },
];
const HOUR = 3_600_000;
const DETAILS = {
  'p-personal': { leadName: 'Assistant', lastActiveAt: new Date(Date.now() - 5 * HOUR).toISOString(), waiting: 0 },
  'p-nw': { leadName: 'Atlas', lastActiveAt: new Date(Date.now() - 2 * HOUR).toISOString(), waiting: 1 },
  'p-kc-deals': { leadName: 'Ledger', lastActiveAt: new Date(Date.now() - 26 * HOUR).toISOString(), waiting: 3 },
  'p-kc-ops': { leadName: 'Dispatcher', lastActiveAt: new Date(Date.now() - 0.5 * HOUR).toISOString(), waiting: 0 },
};

function renderPicker(navigate: (href: string) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider>
        <div className="w-full p-3">
          <WorkspaceSwitcher account={ACCOUNTS[0]!} accounts={ACCOUNTS} projects={PROJECTS} activeId="p-nw" defaultOpen side="bottom" orgsMode="multi" navigate={navigate} details={DETAILS} />
        </div>
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

describe('the picker on a phone, several Orgs', () => {
  it('opens a one-workspace Org at once, and drills into one with several', async () => {
    await page.viewport(390, 844);
    const navigate = vi.fn();
    await renderPicker(navigate);
    const shots = (import.meta.env as unknown as Record<string, string | undefined>).VITE_SHOTS_DIR;

    await expect.element(page.getByTestId('switcher-level-orgs')).toBeVisible();

    if (shots) {
      await page.screenshot({ path: `${shots}/picker-orgs-390.png` });
    }

    await page.getByTestId('switcher-org').filter({ hasText: 'Kestrel Capital' }).click();

    await expect.element(page.getByTestId('switcher-level-title')).toHaveTextContent('Kestrel Capital');

    // Recent first; the empty one last.
    const rows = page.getByTestId('switcher-workspace').elements().map(e => e.textContent ?? '');

    expect(rows.map(r => r.replace(/^./, '').split(/[A-Z][a-z]+ ·|\d/)[0])).toEqual(['Kestrel Ops', 'Deal Desk', 'Pilot']);

    if (shots) {
      await new Promise(r => setTimeout(r, 300));
      await page.screenshot({ path: `${shots}/picker-kestrel-390.png` });
    }

    await page.getByRole('option', { name: /Deal Desk/ }).click();

    // The workspace's home, never the page the person was on.
    expect(navigate).toHaveBeenCalledWith('/w/deals/dashboard/chat?org=kestrel');

    navigate.mockClear();
    await page.getByTestId('switcher-back').click();
    await page.getByTestId('switcher-org').filter({ hasText: 'Northwind' }).click();

    expect(navigate).not.toHaveBeenCalled(); // the current workspace: the picker only closes
  });
});
