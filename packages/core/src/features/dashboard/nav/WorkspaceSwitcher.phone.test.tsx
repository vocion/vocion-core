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
 * The picker on a phone, with the app's styles: one list of every workspace,
 * Personal under You and each Org's under its name (workspace first, founder
 * 2026-10-23). `VITE_SHOTS_DIR` saves it for the pull request.
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
  it('lists every workspace at once, grouped by Org, recent first, and opens one from its row', async () => {
    await page.viewport(390, 844);
    const navigate = vi.fn();
    await renderPicker(navigate);
    const shots = (import.meta.env as unknown as Record<string, string | undefined>).VITE_SHOTS_DIR;

    const headings = page.getByTestId('switcher-group-heading').elements().map(e => e.textContent ?? '');

    expect(headings).toEqual(['You', 'Northwind', 'Kestrel Capital']);

    // Recent first; the empty one last.
    const kestrel = page.getByRole('group', { name: 'Kestrel Capital' }).getByTestId('switcher-workspace').elements().map(e => e.textContent ?? '');

    expect(kestrel.map(r => r.replace(/^./, '').split(/[A-Z][a-z]+ ·|\d/)[0])).toEqual(['Kestrel Ops', 'Deal Desk', 'Pilot']);

    if (shots) {
      await new Promise(r => setTimeout(r, 300));
      await page.screenshot({ path: `${shots}/picker-one-list-390.png` });
    }

    // Nothing wider than the phone.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);

    await page.getByRole('option', { name: /Deal Desk/ }).click();

    // The workspace's home, never the page the person was on.
    expect(navigate).toHaveBeenCalledWith('/w/deals/dashboard/chat?org=kestrel');

    navigate.mockClear();
    await page.getByRole('option', { name: /^.?Northwind/ }).click();

    expect(navigate).not.toHaveBeenCalled(); // the current workspace: the picker only closes
  });
});
