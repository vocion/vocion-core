import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The top progress bar in a real browser (backlog 013): a tap on an in-app
 * link lights it before anything else has moved; the page landing puts it
 * out; a tap that opens a new tab never lights it.
 *
 * `next/navigation` is mocked to a pathname the test can move, which is how
 * "the page landed" is simulated without a router.
 */

const route = { pathname: '/dashboard/p/work' };
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { NavigationProgress } = await import('./NavigationProgress');
const { endNavigation, navigationPending } = await import('./navigationInFlight');

// A const so the lint rule that wants `<Link />` for a page route does not
// fire: the bar listens for ANY anchor, and a plain one is the honest fixture.
const CARD = '/dashboard/p/work/12';

afterEach(() => {
  endNavigation();
});

function Page() {
  return (
    <div>
      <NavigationProgress />
      {/* The click is what is under test, so the navigation itself is stopped:
          otherwise the browser leaves the test page. */}
      <a href={CARD} data-testid="card" onClick={e => e.preventDefault()}>Send has no admin panel</a>
    </div>
  );
}

describe('the top progress bar', () => {
  it('is out until a tap, then lit at once, then out when the page lands', async () => {
    const screen = await render(<Page />);
    const bar = page.getByTestId('navigation-progress');

    await expect.element(bar).toHaveAttribute('data-state', 'idle');
    await expect.element(bar).toHaveAttribute('aria-hidden', 'true');

    // `preventDefault` in the page's own handler runs AFTER the bar's capture
    // listener, so the bar sees the tap as a real navigation.
    await page.getByTestId('card').click();

    await expect.element(bar).toHaveAttribute('data-state', 'active');
    expect(navigationPending()).toBe(true);

    // The page lands: the pathname changes under the bar.
    route.pathname = CARD;
    screen.rerender(<Page />);

    await expect.element(bar).toHaveAttribute('data-state', 'idle');
    expect(navigationPending()).toBe(false);
  });

  it('stays out for a tap that opens a new tab', async () => {
    render(<Page />);
    const bar = page.getByTestId('navigation-progress');

    await page.getByTestId('card').click({ modifiers: ['Meta'] });

    await expect.element(bar).toHaveAttribute('data-state', 'idle');
    expect(navigationPending()).toBe(false);
  });
});
