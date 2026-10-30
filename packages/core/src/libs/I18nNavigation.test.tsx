import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { NAV_WHERE_KEY, rememberPlace } from '@/features/dashboard/nav/workspaceMemory';
import { AppContextProvider } from './appContext';
import { Link } from './I18nNavigation';
import { WorkspaceSlugProvider } from './workspaceSlug';

vi.mock('next/navigation', () => ({ usePathname: () => '/w/revenue/dashboard/projects/98', useSearchParams: () => new URLSearchParams('app=gtm') }));
vi.mock('next-intl/navigation', () => ({
  createNavigation: () => ({ Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }),
}));

const apps = [
  { id: 'core', core: true, entry: '/dashboard/scorecard', owns: [] },
  { id: 'gtm', core: false, entry: '/dashboard/apps/gtm/home', owns: ['/dashboard/apps/gtm'] },
  { id: 'seo', core: false, entry: '/dashboard/apps/seo/home', owns: ['/dashboard/apps/seo'] },
];

afterEach(() => localStorage.removeItem(NAV_WHERE_KEY));

it('keeps project links in their originating workspace and app after another tab changes memory', async () => {
  rememberPlace(localStorage, 'revenue', { app: 'seo', path: '/dashboard/apps/seo/home' });
  rememberPlace(localStorage, 'finance', { app: 'core', path: '/dashboard/scorecard' });
  await render(
    <WorkspaceSlugProvider slug="revenue">
      <AppContextProvider apps={apps}>
        <Link href="/dashboard/projects/98#instructions">Instructions</Link>
        <Link href="/dashboard/projects/98#wiki">Wiki</Link>
        <Link href="/dashboard/inbox/483">Open item</Link>
        <Link href="/dashboard/connectors?project=98">Connect for project</Link>
        <Link href="/dashboard/artifacts/12">Milestone</Link>
        <Link href="/w/finance/dashboard/projects/9">Other workspace</Link>
      </AppContextProvider>
    </WorkspaceSlugProvider>,
  );

  await expect.element(page.getByRole('link', { name: 'Instructions' })).toHaveAttribute('href', '/w/revenue/dashboard/projects/98?app=gtm#instructions');
  await expect.element(page.getByRole('link', { name: 'Wiki' })).toHaveAttribute('href', '/w/revenue/dashboard/projects/98?app=gtm#wiki');
  await expect.element(page.getByRole('link', { name: 'Open item' })).toHaveAttribute('href', '/w/revenue/dashboard/inbox/483?app=gtm');
  await expect.element(page.getByRole('link', { name: 'Connect for project' })).toHaveAttribute('href', '/w/revenue/dashboard/connectors?project=98&app=gtm');
  await expect.element(page.getByRole('link', { name: 'Milestone' })).toHaveAttribute('href', '/w/revenue/dashboard/artifacts/12?app=gtm');
  await expect.element(page.getByRole('link', { name: 'Other workspace' })).toHaveAttribute('href', '/w/finance/dashboard/projects/9');
});
