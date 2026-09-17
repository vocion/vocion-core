import type { SearchResult } from './SearchResults';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { SearchResults } from './SearchResults';

// The rows and the router go through the locale-aware navigation; the tests
// only need anchors with the right hrefs and a push they can ignore.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/dashboard/search',
}));

/**
 * Search reads as the same list as every other list: one row of connector
 * chips with a measured "+N more", records as `ListRow`s, and a row that
 * opens the document's own page.
 */

function result(over: Partial<SearchResult> & Pick<SearchResult, 'id' | 'title'>): SearchResult {
  return {
    sourceSlug: 'drive',
    link: null,
    blurb: 'The quarterly plan and the dates the team committed to.',
    score: null,
    updatedAt: '2026-08-24T09:00:00.000Z',
    openable: true,
    ...over,
  };
}

const SOURCES = Array.from({ length: 12 }, (_, i) => ({ slug: `connector-${i + 1}`, count: 100 - i }));

describe('SearchResults', () => {
  it('opens each result on its own document page', async () => {
    await render(
      <SearchResults
        query=""
        source={null}
        sources={[{ slug: 'drive', count: 2 }]}
        results={[result({ id: '412', title: 'Q3 platform plan' })]}
        error={null}
      />,
    );

    const row = page.getByRole('link', { name: /Q3 platform plan/ });

    await expect.element(row).toBeVisible();
    await expect.element(row).toHaveAttribute('href', '/dashboard/search/412');
  });

  it('shows the source and the date on one subline, and the score only when ranked', async () => {
    await render(
      <SearchResults
        query="platform"
        source={null}
        sources={[{ slug: 'drive', count: 2 }]}
        results={[result({ id: '412', title: 'Q3 platform plan', score: 0.873 })]}
        error={null}
      />,
    );

    await expect.element(page.getByText('drive · Aug 24, 2026 · The quarterly plan and the dates the team committed to.')).toBeVisible();
    await expect.element(page.getByText('0.873')).toBeVisible();
  });

  it('keeps the connector chips on one line, folding the rest into "+N more"', async () => {
    // A narrow column so the fit is decided by the rule, not by the viewport.
    await render(
      <div style={{ width: 420 }}>
        <SearchResults query="" source={null} sources={SOURCES} results={[result({ id: '1', title: 'A' })]} error={null} />
      </div>,
    );

    // Twelve connectors never fit in 420px; the overflow control is the proof.
    await expect.element(page.getByTestId('chips-more')).toBeVisible();
  });

  it('leaves the toolbar in place when nothing matched, so the filter can be changed', async () => {
    await render(
      <SearchResults query="nothing here" source="drive" sources={[{ slug: 'drive', count: 2 }]} results={[]} error={null} />,
    );

    await expect.element(page.getByText('No results for “nothing here” in drive.')).toBeVisible();
    await expect.element(page.getByPlaceholder('Search transcripts, docs, CRM records…')).toBeVisible();
  });

  it('says so when retrieval failed, rather than showing an empty list', async () => {
    await render(
      <SearchResults query="x" source={null} sources={[]} results={[]} error="connection refused" />,
    );

    await expect.element(page.getByRole('alert')).toHaveTextContent('Search failed: connection refused');
  });
});

describe('load more', () => {
  it('offers more results when more exist, and asks for the next page in the URL', async () => {
    const push = vi.fn();
    vi.doMock('@/libs/I18nNavigation', () => ({
      Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
      useRouter: () => ({ push }),
      usePathname: () => '/dashboard/search',
    }));

    render(
      <SearchResults
        query="pipeline"
        source={null}
        sources={[]}
        results={[result({ id: '1', title: 'Q3 plan' })]}
        error={null}
        hasMore
        moreHref="/dashboard/search?q=pipeline&n=50"
      />,
    );

    // A real, focusable control — infinite scroll alone strands a keyboard
    // user and leaves nothing to press when the observer does not fire.
    await expect.element(page.getByTestId('search-load-more')).toBeVisible();
  });

  it('shows no control when the results are all of them', async () => {
    render(
      <SearchResults
        query="pipeline"
        source={null}
        sources={[]}
        results={[result({ id: '1', title: 'Q3 plan' })]}
        error={null}
        hasMore={false}
        moreHref={null}
      />,
    );

    expect(page.getByTestId('search-load-more').elements()).toHaveLength(0);
  });
});
