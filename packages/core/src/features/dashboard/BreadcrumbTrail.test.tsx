import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { Breadcrumb } from './Breadcrumb';
import { BreadcrumbTrailProvider, PageBreadcrumbs, useExplicitBreadcrumbTrail } from './BreadcrumbTrail';
import '@/styles/global.css';

const location = vi.hoisted(() => ({ pathname: '/w/team-a/dashboard/objects/42' }));
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }));
vi.mock('@/libs/I18nNavigation', () => ({
  usePathname: () => location.pathname,
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

function Reader() {
  const trail = useExplicitBreadcrumbTrail();
  return <p>{trail?.map(c => c.label).join(' / ') ?? 'fallback'}</p>;
}

function Fixture({ show = true, title = 'Trail shoes' }: { show?: boolean; title?: string }) {
  return (
    <BreadcrumbTrailProvider>
      {show && <PageBreadcrumbs pathname="/w/team-a/dashboard/objects/42" crumbs={[{ label: 'Pages', url: '/w/team-a/dashboard/p/pages' }, { label: title, url: '/w/team-a/dashboard/objects/42' }]} />}
      <Reader />
    </BreadcrumbTrailProvider>
  );
}

describe('explicit page breadcrumbs', () => {
  it('keeps the meaningful path reachable on a phone', async () => {
    location.pathname = '/w/team-a/dashboard/objects/42';
    await page.viewport(390, 844);
    await render(
      <BreadcrumbTrailProvider>
        <PageBreadcrumbs
          pathname="/w/team-a/dashboard/objects/42"
          crumbs={[
            { label: 'Pages', url: '/w/team-a/dashboard/p/pages' },
            { label: 'Trail shoes', url: '/w/team-a/dashboard/objects/42' },
          ]}
        />
        <Breadcrumb workspaceName="Editorial team" />
      </BreadcrumbTrailProvider>,
    );

    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/w/team-a/dashboard/p/pages');
    await expect.element(page.getByText('Trail shoes')).toHaveAttribute('aria-current', 'page');
    await expect.element(page.getByRole('link', { name: 'Objects', exact: true })).not.toBeInTheDocument();
  });

  it('replaces raw route names and ignores the old trail immediately on another route or workspace', async () => {
    location.pathname = '/w/team-a/dashboard/objects/42';
    const view = await render(<Fixture />);

    await expect.element(page.getByText('Pages / Trail shoes')).toBeVisible();

    location.pathname = '/w/team-a/dashboard/projects/9';
    await view.rerender(<Fixture />);

    await expect.element(page.getByText('fallback')).toBeVisible();

    location.pathname = '/w/team-b/dashboard/objects/42';
    await view.rerender(<Fixture />);

    await expect.element(page.getByText('fallback')).toBeVisible();

    location.pathname = '/w/team-a/dashboard/objects/42';
    await view.rerender(<Fixture title="Updated title" />);

    await expect.element(page.getByText('Pages / Updated title')).toBeVisible();

    await view.rerender(<Fixture show={false} />);

    await expect.element(page.getByText('fallback')).toBeVisible();
  });
});
