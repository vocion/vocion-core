import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from 'next-themes';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * The account (avatar) menu, as a person meets it.
 *
 * What it has to get right: switching workspace lives in the sidebar header
 * only, so the menu carries no switcher row; the theme is one click — a
 * radiogroup in the menu that applies at once, leaves the menu open, keeps
 * next-themes' persistence, and works from the keyboard alone (Tab reaches
 * it, arrows move, Enter or Space picks); and the © line names core's licence.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Avery Lane', email: 'avery@northwind.example' } }, status: 'authenticated' }),
  signOut: vi.fn(),
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}));
// The bar's other occupants read the router, the RPC client or the sidebar;
// none of them is what this file tests.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/dashboard' }));
vi.mock('@/features/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/features/dashboard/chat/AgentSurfaceButton', () => ({ AgentSurfaceButton: () => null }));
vi.mock('@/features/dashboard/Breadcrumb', () => ({ Breadcrumb: ({ workspaceName }: { workspaceName: string | null }) => <span data-testid="bar-title">{workspaceName}</span> }));
vi.mock('./NavigationProgress', () => ({ NavigationProgress: () => null }));
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null }));

const { AppSidebarHeader } = await import('./AppSidebarHeader');
const { BrandChromeProvider, OrgBrandProvider } = await import('@/features/branding/BrandContext');

async function openMenu() {
  await render(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <NextIntlClientProvider locale="en" messages={en}>
        <AppSidebarHeader workspace={{ slug: 'northwind', name: 'Northwind Builders' }} />
      </NextIntlClientProvider>
    </ThemeProvider>,
  );
  await page.getByRole('button', { name: 'Account menu' }).click();

  await expect.element(page.getByRole('menu')).toBeVisible();
}

const radio = (name: string) => page.getByRole('radio', { name });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('AppSidebarHeader account menu', () => {
  it('has no workspace switcher row and no Theme submenu', async () => {
    await openMenu();

    await expect.element(page.getByText('Current workspace:')).not.toBeInTheDocument();
    await expect.element(page.getByRole('menu').getByText('Northwind Builders')).not.toBeInTheDocument();
    await expect.element(page.getByRole('menuitem', { name: 'Theme' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('menuitem', { name: 'Workspace settings' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  });

  it('shows the theme as a labelled radiogroup with the current one checked', async () => {
    localStorage.setItem('theme', 'dark');
    await openMenu();

    await expect.element(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    await expect.element(radio('Dark')).toHaveAttribute('aria-checked', 'true');
    await expect.element(radio('Light')).toHaveAttribute('aria-checked', 'false');
    await expect.element(radio('System')).toHaveAttribute('aria-checked', 'false');
    // One tab stop: the chosen option.
    await expect.element(radio('Dark')).toHaveAttribute('tabindex', '0');
    await expect.element(radio('Light')).toHaveAttribute('tabindex', '-1');
  });

  it('applies a click at once, keeps the menu open and persists it', async () => {
    await openMenu();

    await radio('Dark').click();

    await expect.element(radio('Dark')).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
    await expect.element(page.getByRole('menu')).toBeVisible();
  });

  it('works from the keyboard: Tab reaches it, arrows move, Enter and Space pick', async () => {
    await openMenu();
    (page.getByRole('menuitem', { name: 'Workspace settings' }).element() as HTMLElement).focus();

    await userEvent.keyboard('{Tab}');

    await expect.element(radio('Light')).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');

    await expect.element(radio('Dark')).toHaveFocus();
    // Moving is not choosing.
    await expect.element(radio('Light')).toHaveAttribute('aria-checked', 'true');

    await userEvent.keyboard('{Enter}');

    await expect.element(radio('Dark')).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('theme')).toBe('dark');

    await userEvent.keyboard('{ArrowRight}');

    await expect.element(radio('System')).toHaveFocus();

    await userEvent.keyboard(' ');

    await expect.element(radio('System')).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('theme')).toBe('system');

    // Wraps, and the menu is still open throughout.
    await userEvent.keyboard('{ArrowRight}');

    await expect.element(radio('Light')).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');

    await expect.element(radio('System')).toHaveFocus();
    await expect.element(page.getByRole('menu')).toBeVisible();

    // Tab leaves for the next item, Shift+Tab for the one before.
    await userEvent.keyboard('{Tab}');

    await expect.element(page.getByRole('menuitem', { name: 'Profile' })).toHaveFocus();

    await userEvent.keyboard('{Tab}');

    await expect.element(radio('System')).toHaveFocus();

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');

    await expect.element(page.getByRole('menuitem', { name: 'Workspace settings' })).toHaveFocus();
  });

  it('names core\'s licence on the © line', async () => {
    await openMenu();

    await expect.element(page.getByText(/Vocion · MPL-2\.0/)).toBeVisible();
    await expect.element(page.getByText(/Apache/)).not.toBeInTheDocument();
  });
});

/**
 * The top bar's lead mark sits in a 20px square before the workspace title
 * and never runs into it, whatever the Org saved as its mark — on a phone,
 * a tablet and a desktop (founder, 2026-10-09: a wordmark drawn over
 * "Revenue Team").
 */
describe('AppSidebarHeader lead mark', () => {
  const WIDE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 245 54"><rect width="245" height="54" fill="#f26522"/></svg>')}`;
  const SQUARE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#f26522"/></svg>')}`;

  for (const [label, mark] of [['a square mark', SQUARE], ['a wordmark saved as the mark', WIDE], ['no mark at all', undefined]] as const) {
    for (const width of [390, 768, 1280, 1440]) {
      it(`${label}: mark and title never overlap at ${width}px`, async () => {
        await page.viewport(width, 800);
        await render(
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
            <NextIntlClientProvider locale="en" messages={en}>
              <OrgBrandProvider value={{ name: 'Northwind', logo: { light: WIDE }, mark: mark ? { light: mark } : {}, accent: null, headingFont: null, poweredBy: true }}>
                <BrandChromeProvider value={{ lead: 'org', footer: 'powered-by' }}>
                  <AppSidebarHeader workspace={{ slug: 'revenue', name: 'Revenue Team' }} />
                </BrandChromeProvider>
              </OrgBrandProvider>
            </NextIntlClientProvider>
          </ThemeProvider>,
        );

        await expect.element(page.getByTestId('bar-title')).toBeVisible();

        const markBox = page.getByTestId('lead-mark').element().getBoundingClientRect();
        const titleBox = page.getByTestId('bar-title').element().getBoundingClientRect();

        expect(markBox.width).toBeLessThanOrEqual(20);
        expect(markBox.right).toBeLessThan(titleBox.left);
      });
    }
  }
});
