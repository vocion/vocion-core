import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { WorkspaceSlugProvider } from './workspaceSlug';

const route = vi.hoisted(() => ({ path: '/w/northwind/dashboard/artifacts/8', query: 'app=seo' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path, useSearchParams: () => new URLSearchParams(route.query) }));
const { AppContextProvider, useAppContext } = await import('./appContext');
const apps = [
  { id: 'core', name: 'Workforce', core: true, entry: '/dashboard/chat', href: '/dashboard/chat', owns: [], sections: [], icon: 'home', order: 0 },
  { id: 'seo', name: 'SEO', core: false, entry: '/dashboard/apps/seo/home', href: '/dashboard/apps/seo/home', owns: ['/dashboard/apps/seo'], sections: [], icon: 'search', order: 1 },
];
function ContextValue() {
  return <output data-testid="app-context">{useAppContext()}</output>;
}
function Harness() {
  const [n, setN] = useState(0);
  return (
    <WorkspaceSlugProvider slug="northwind">
      <AppContextProvider apps={apps}>
        <ContextValue />
        <button onClick={() => {
          route.query = 'app=missing';
          setN(n + 1);
        }}
        >
          Change tab URL
        </button>
      </AppContextProvider>
    </WorkspaceSlugProvider>
  );
}

it('keeps the deep-linked app and rejects apps absent from the workspace', async () => {
  await render(<Harness />);

  await expect.element(page.getByTestId('app-context')).toHaveTextContent('seo');

  await page.getByRole('button', { name: 'Change tab URL' }).click();

  await expect.element(page.getByTestId('app-context')).toHaveTextContent('core');
});
