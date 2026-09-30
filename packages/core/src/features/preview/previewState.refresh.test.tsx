import type { ListStateConfig } from '@/components/patterns/listState';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { useListUrlState } from '@/components/patterns/listUrlState';
import { openPreview, useOpenPreviewRef } from './previewState';

/**
 * A REFRESH NEVER CLOSES THE PANE (Chris, 2026-09-30, feature #269: the plan
 * open in the pane closed every ~5 s while the build ran).
 *
 * The app router is not mounted in a browser test, so this stands in for the
 * two things it does to history, as Next 16 does them
 * (`next/dist/client/components/app-router.js`):
 *
 *   - it patches `pushState` / `replaceState`: a write whose state is not its
 *     own (no `__NA`) is folded into the router's URL; a write handed its own
 *     state is passed straight through and the router's URL stays as it was;
 *   - every commit — `router.refresh()` among them — writes the router's URL
 *     back with `replaceState`.
 *
 * Before the fix the preview was written with `window.history.state` (the
 * router's own state), so the router never learnt the param and the next
 * refresh wrote it away.
 */

type Patched = { canonical: string; refresh: () => void; restore: () => void };

function mountRouterStandIn(): Patched {
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  const self: Patched = {
    canonical: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    refresh: () => replace({ __NA: true }, '', self.canonical),
    restore: () => {
      window.history.pushState = push;
      window.history.replaceState = replace;
    },
  };
  const adopt = (url: string | URL | null | undefined) => {
    if (url) {
      const u = new URL(String(url), window.location.href);
      self.canonical = `${u.pathname}${u.search}${u.hash}`;
    }
  };
  window.history.pushState = (data: any, unused: string, url?: string | URL | null) => {
    if (!data?.__NA) {
      adopt(url);
    }
    push({ ...data, __NA: true }, unused, url);
  };
  window.history.replaceState = (data: any, unused: string, url?: string | URL | null) => {
    if (!data?.__NA) {
      adopt(url);
    }
    replace({ ...data, __NA: true }, unused, url);
  };
  // The page as the router left it: its own state on the entry.
  replace({ __NA: true }, '', self.canonical);
  return self;
}

function OpenRef() {
  const ref = useOpenPreviewRef();
  return (
    <div>
      <p data-testid="open-ref">{ref ? `${ref.type}:${ref.id}` : 'closed'}</p>
      <button type="button" onClick={e => openPreview({ type: 'feature_section', id: '269.plan' }, e.currentTarget)}>Open plan</button>
    </div>
  );
}

const LIST: ListStateConfig = { defaults: { tab: '', q: '', sort: 'newest', dir: 'desc', chips: [] }, sorts: ['newest', 'title'] };

function ListSort() {
  const [state, update] = useListUrlState(LIST);
  return <button type="button" onClick={() => update({ sort: 'title' })} data-testid="list-sort">{state.sort}</button>;
}

let router: Patched;

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/p/feature/269');
  router = mountRouterStandIn();
});

afterEach(() => {
  router.restore();
});

describe('a refresh with the pane open', () => {
  it('leaves it open on the same ref', async () => {
    render(<OpenRef />);
    await userEvent.click(page.getByRole('button', { name: 'Open plan' }));

    await expect.element(page.getByTestId('open-ref')).toHaveTextContent('feature_section:269.plan');

    // Two refreshes, as the live refresh does every 5 s.
    router.refresh();
    router.refresh();
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('feature_section:269.plan');
    await expect.element(page.getByTestId('open-ref')).toHaveTextContent('feature_section:269.plan');
  });

  it('keeps a list\'s sort in the URL through a refresh too (the same write)', async () => {
    render(<ListSort />);
    await userEvent.click(page.getByTestId('list-sort'));

    router.refresh();

    expect(window.location.search).toContain('sort=title');
  });
});
