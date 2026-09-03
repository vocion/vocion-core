/**
 * The old `/dashboard/sources` URLs, kept alive after "Sources" became
 * "Connectors".
 *
 * Worth a test rather than a manual check: the pages exist only to redirect, so
 * nothing else in the app would notice if one stopped. Somebody's bookmark
 * would.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { redirect } = await import('next/navigation');
const { default: SourcesPage } = await import('./page');
const { default: SourceDetailPage } = await import('./[slug]/page');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/dashboard/sources', () => {
  it('sends the list page to the connectors list', () => {
    SourcesPage();

    expect(redirect).toHaveBeenCalledWith('/dashboard/connectors');
  });

  it('sends a bookmarked detail page to the same connector', async () => {
    await SourceDetailPage({ params: Promise.resolve({ slug: 'strapi', locale: 'en' }) });

    expect(redirect).toHaveBeenCalledWith('/dashboard/connectors/strapi');
  });

  it('escapes a slug rather than letting it shape the URL', async () => {
    await SourceDetailPage({ params: Promise.resolve({ slug: 'a b/c', locale: 'en' }) });

    expect(redirect).toHaveBeenCalledWith('/dashboard/connectors/a%20b%2Fc');
  });
});
