import type { AppNav } from '@/features/navigation/apps';
import { SessionProvider } from 'next-auth/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * The sidebar drawer on a phone (founder, 2026-10-08, Metacto's drawer:
 * "funky and overstuffed"): one logo, the one switcher as the header, no
 * "Workforce" row and no "Workspace" label, no pin icons, a lone Wiki in the
 * main list, no rail, a footer that never sits on the nav, and no tooltip the
 * moment it opens (one covered the switcher).
 */

vi.mock('@/libs/Orpc', () => ({
  client: {
    projects: { list: vi.fn(async () => ({ projects: [{ id: 'p-nw', accountId: 'acct-nw', slug: 'northwind', name: 'Northwind', agentCount: 4 }], accounts: [{ id: 'acct-nw', name: 'Northwind', slug: 'northwind' }], account: { id: 'acct-nw', name: 'Northwind' }, orgsMode: 'single' })) },
    apps: { forUser: vi.fn(async () => ({ apps: [{ id: 'software-factory', name: 'Software Factory', icon: 'git-branch', tint: 'mint', order: 2, core: false }], workspacesByApp: {} })) },
    nav: { getPrefs: vi.fn(async () => ({ pins: [], dismissed: [] })), setPins: vi.fn(), dismiss: vi.fn(), gettingStarted: vi.fn(async () => ({ steps: [{ id: 'connect', done: true }, { id: 'app', done: true }, { id: 'hire', done: false }, { id: 'invite', done: false }, { id: 'brand', done: false }], done: 2, total: 5, fresh: true })) },
  },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => '/dashboard/chat',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { SidebarProvider, SidebarTrigger } = await import('@/components/ui/sidebar');
const { BrandChromeProvider, OrgBrandProvider } = await import('@/features/branding/BrandContext');
const { AppSidebar } = await import('./AppSidebar');

const APPS: AppNav[] = [
  { id: 'workforce', name: 'Workforce', icon: 'users', tint: 'sky', order: 0, core: true, entry: '/dashboard/chat', href: '/dashboard/chat', sections: [], owns: [] },
];
const SESSION = {
  user: { id: 'usr-sam', name: 'Sam Rivera', email: 'sam@northwind.example', accountId: 'acct-nw', projectId: 'p-nw', role: 'admin' as const, workspaceRole: 'admin' as const },
  expires: '2999-01-01T00:00:00.000Z',
};

function Shell({ fresh, branded = false, lead = 'org' }: { fresh: boolean; branded?: boolean; lead?: 'org' | 'vocion' }) {
  return (
    <OrgBrandProvider value={branded ? { name: 'Northwind', logo: {}, mark: {}, accent: null, headingFont: null, poweredBy: true } : null}>
      <BrandChromeProvider value={branded && lead === 'org' ? { lead: 'org', footer: 'powered-by' } : { lead: 'vocion', footer: 'vocion-wordmark' }}>
        <SessionProvider session={SESSION}>
          <NextIntlClientProvider locale="en" messages={en}>
            <SidebarProvider>
              <SidebarTrigger />
              <AppSidebar
                isAdmin
                needsYouCount={4}
                apps={APPS}
                workspacePages={[{ title: 'Wiki', url: '/dashboard/p/wiki', section: 'Pages' }]}
                gettingStarted={{ steps: [{ id: 'connect', done: true }, { id: 'app', done: true }, { id: 'hire', done: false }, { id: 'invite', done: false }, { id: 'brand', done: false }], done: 2, total: 5, fresh }}
              />
            </SidebarProvider>
          </NextIntlClientProvider>
        </SessionProvider>
      </BrandChromeProvider>
    </OrgBrandProvider>
  );
}

async function openDrawer(fresh = false, branded = false, lead: 'org' | 'vocion' = 'org') {
  await page.viewport(390, 844);
  await render(<Shell fresh={fresh} branded={branded} lead={lead} />);
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();

  await expect.element(page.getByRole('dialog')).toBeVisible();
}

beforeEach(() => {
  localStorage.clear();
});

describe('the sidebar drawer on a phone', () => {
  it('opens with no tooltip showing and focus on the drawer, not a control in it', async () => {
    await openDrawer();

    expect(document.querySelectorAll('[data-slot="tooltip-content"]')).toHaveLength(0);
    expect(document.activeElement?.getAttribute('data-mobile')).toBe('true');
  });

  it('is the one switcher, a plain main list with Wiki in it, and no rail, pins, labels or second logo', async () => {
    await openDrawer();
    const drawer = page.getByRole('dialog');

    await expect.element(drawer.getByRole('button', { name: 'Switch workspace' })).toBeVisible();
    expect(drawer.getByTestId('app-rail').elements()).toHaveLength(0);
    expect(drawer.getByTestId('app-header').elements()).toHaveLength(0);
    expect(drawer.getByText('Workforce', { exact: true }).elements()).toHaveLength(0);
    expect(drawer.getByText('Workspace', { exact: true }).elements()).toHaveLength(0);
    expect(drawer.getByText('Pages', { exact: true }).elements()).toHaveLength(0);
    // No pin icons on rows.
    expect(drawer.getByRole('button', { name: /^(Pin|Unpin)/ }).elements()).toHaveLength(0);

    const rows = drawer.getByRole('link').elements().map(a => a.textContent?.trim());

    expect(rows.slice(0, 6)).toEqual(['Chat', 'Review', 'Briefings', 'Goals', 'Scorecard', 'Wiki']);
  });

  it('pins from a long press, through a small menu', async () => {
    await openDrawer();
    const wiki = page.getByRole('dialog').getByRole('link', { name: 'Wiki' });
    const el = wiki.element() as HTMLElement;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));

    await expect.element(page.getByTestId('pin-menu-toggle')).toBeVisible();
  });

  it('shows Getting started only on a new workspace, as one slim row', async () => {
    await openDrawer(false);

    expect(page.getByTestId('getting-started').elements()).toHaveLength(0);
  });

  it('keeps the footer below the nav, never on top of it', async () => {
    await openDrawer(true);

    await expect.element(page.getByTestId('getting-started-count')).toHaveTextContent('Getting started · 2 of 5');

    const footer = (await page.getByTestId('sidebar-footer').element()).getBoundingClientRect();
    const content = (document.querySelector('[data-mobile="true"] [data-slot="sidebar-content"]') as HTMLElement).getBoundingClientRect();

    expect(footer.top).toBeGreaterThanOrEqual(content.bottom - 1);
    await expect.element(page.getByTestId('sidebar-user')).toHaveTextContent('Sam Rivera');
  });
});

describe('the footer of a branded install', () => {
  it('carries a small "Powered by Vocion" under who is signed in, below the nav and never on it', async () => {
    await openDrawer(true, true);

    const user = (await page.getByTestId('sidebar-user').element()).getBoundingClientRect();
    const powered = (await page.getByTestId('powered-by-vocion').element()).getBoundingClientRect();
    const content = (document.querySelector('[data-mobile="true"] [data-slot="sidebar-content"]') as HTMLElement).getBoundingClientRect();

    expect(powered.top).toBeGreaterThanOrEqual(user.bottom - 1);
    expect(user.top).toBeGreaterThanOrEqual(content.bottom - 1);
    expect(page.getByTestId('vocion-wordmark').elements()).toHaveLength(0);
  });

  it('where Vocion leads (Cloud), the footer is Vocion\'s wordmark instead — never both', async () => {
    await openDrawer(true, true, 'vocion');

    await expect.element(page.getByTestId('vocion-wordmark')).toBeVisible();
    expect(page.getByTestId('powered-by-vocion').elements()).toHaveLength(0);
  });
});

describe('the rail on a desktop', () => {
  it('names every icon, and a tooltip opens on keyboard focus', async () => {
    await page.viewport(1440, 900);
    await render(<Shell fresh={false} />);
    const rail = page.getByTestId('app-rail');

    await expect.element(rail.getByRole('link', { name: 'Workforce' })).toBeVisible();

    (rail.getByRole('link', { name: 'Workforce' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Tab}{Shift>}{Tab}{/Shift}');

    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Workforce');
  });
});
