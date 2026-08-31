import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { filterConnectors, parseStrapiCollections, SourcesPanel } from './SourcesPanel';

/**
 * The Sources panel has two jobs a reviewer would notice being wrong: the
 * source-type picker has to stay usable as the connector registry grows (search
 * + a capped first page, one card per row), and picking a connector has to
 * offer the fields that connector's config schema actually requires — Strapi
 * asked for a crawl URL before VEERIO-235 and every submit failed validation.
 */

type ConnectorFixture = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  authKind: 'none' | 'apikey' | 'oauth';
};

function connector(slug: string, name: string, description: string): ConnectorFixture {
  return { slug, name, description, icon: name, authKind: 'apikey' };
}

const CONNECTORS: ConnectorFixture[] = [
  connector('web', 'Web', 'Crawl a site from one URL — same-origin BFS.'),
  connector('strapi', 'Strapi', 'Ingest entries from one or more Strapi CMS collections — incremental by updatedAt.'),
  connector('google-ads', 'Google Ads', 'Ingest Google Ads campaign performance by day.'),
  connector('hubspot', 'HubSpot', 'Ingest HubSpot CRM records (contacts, deals, companies).'),
];

/**
 * Stand in for the two endpoints the panel talks to, recording what it posts.
 * @param connectors
 */
function stubSourcesApi(connectors: ConnectorFixture[]) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url === '/rpc/sources' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ sources: [], connectors }), { status: 200 });
    }
    if (url === '/rpc/sources' && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ source: { id: 1 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `unstubbed ${init?.method ?? 'GET'} ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchStub);
  return posts;
}

async function openPicker() {
  await page.getByRole('button', { name: 'Add source' }).first().click();

  await expect.element(page.getByPlaceholder(/Search source types/)).toBeVisible();
}

describe('filterConnectors', () => {
  it('matches on name, slug and description', () => {
    expect(filterConnectors(CONNECTORS, 'strapi').map(c => c.slug)).toEqual(['strapi']);
    expect(filterConnectors(CONNECTORS, 'crm').map(c => c.slug)).toEqual(['hubspot']);
    expect(filterConnectors(CONNECTORS, 'google-ads').map(c => c.slug)).toEqual(['google-ads']);
  });

  it('matches every word in any order, so "ads google" still finds Google Ads', () => {
    expect(filterConnectors(CONNECTORS, 'ads google').map(c => c.slug)).toEqual(['google-ads']);
  });

  it('returns everything for an empty or whitespace query', () => {
    expect(filterConnectors(CONNECTORS, '')).toHaveLength(CONNECTORS.length);
    expect(filterConnectors(CONNECTORS, '   ')).toHaveLength(CONNECTORS.length);
  });

  it('returns nothing when no connector matches', () => {
    expect(filterConnectors(CONNECTORS, 'salesforce')).toEqual([]);
  });
});

describe('parseStrapiCollections', () => {
  it('splits on commas and newlines and drops blanks', () => {
    expect(parseStrapiCollections('events, venues')).toEqual(['events', 'venues']);
    expect(parseStrapiCollections('events\nvenues\n')).toEqual(['events', 'venues']);
    expect(parseStrapiCollections('events,,  ,venues,')).toEqual(['events', 'venues']);
  });

  it('is empty for an empty or whitespace-only list', () => {
    expect(parseStrapiCollections('')).toEqual([]);
    expect(parseStrapiCollections('  \n ')).toEqual([]);
  });
});

describe('connector picker', () => {
  it('narrows the list as you type and says how many of the total match', async () => {
    stubSourcesApi(CONNECTORS);
    render(<SourcesPanel />);
    await openPicker();

    await expect.element(page.getByText('4 source types')).toBeVisible();

    await userEvent.fill(page.getByPlaceholder(/Search source types/), 'strapi');

    await expect.element(page.getByText('1 of 4 source types')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Strapi/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /HubSpot/ })).not.toBeInTheDocument();
  });

  it('tells the operator when nothing matches instead of showing an empty modal', async () => {
    stubSourcesApi(CONNECTORS);
    render(<SourcesPanel />);
    await openPicker();

    await userEvent.fill(page.getByPlaceholder(/Search source types/), 'salesforce');

    await expect.element(page.getByText(/No source type matches/)).toBeVisible();
  });

  it('caps the first page at 25 cards and reveals the rest on demand', async () => {
    const many = Array.from({ length: 30 }, (_, i) => connector(`c${i}`, `Connector ${i}`, `Ingest system ${i}.`));
    stubSourcesApi(many);
    render(<SourcesPanel />);
    await openPicker();

    // 25 rendered, so the 26th card is absent until "Show more" is clicked.
    await expect.element(page.getByRole('button', { name: /Connector 24/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Connector 25$/ })).not.toBeInTheDocument();

    await page.getByRole('button', { name: /Show 5 more/ }).click();

    await expect.element(page.getByRole('button', { name: /Connector 29/ })).toBeVisible();
  });

  it('drops back to one page of results when the query changes', async () => {
    const many = Array.from({ length: 30 }, (_, i) => connector(`c${i}`, `Connector ${i}`, `Ingest system ${i}.`));
    stubSourcesApi(many);
    render(<SourcesPanel />);
    await openPicker();

    await page.getByRole('button', { name: /Show 5 more/ }).click();

    await expect.element(page.getByRole('button', { name: /Connector 29/ })).toBeVisible();

    await userEvent.fill(page.getByPlaceholder(/Search source types/), 'Connector 1');

    await expect.element(page.getByRole('button', { name: /Show .* more/ })).not.toBeInTheDocument();
  });
});

describe('add Strapi source', () => {
  it('posts the connector config schema\'s shape — base URL plus a collections array', async () => {
    const posts = stubSourcesApi(CONNECTORS);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org/');
    await userEvent.fill(page.getByLabelText(/Collections/), 'events, venues');
    await page.getByRole('button', { name: 'Add source' }).last().click();

    await vi.waitFor(() => expect(posts).toHaveLength(1));

    expect(posts[0]!.body).toEqual({
      kind: 'strapi',
      configJson: {
        baseUrl: 'https://cms.partner.org',
        collections: ['events', 'venues'],
        populate: '*',
        pageSize: 100,
      },
    });
  });

  it('keeps submit disabled until both the instance and one collection are given', async () => {
    stubSourcesApi(CONNECTORS);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    const submit = page.getByRole('button', { name: 'Add source' }).last();

    await expect.element(submit).toBeDisabled();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');

    await expect.element(submit).toBeDisabled();

    await userEvent.fill(page.getByLabelText(/Collections/), 'events');

    await expect.element(submit).toBeEnabled();
  });

  it('surfaces the server error instead of closing the dialog', async () => {
    stubSourcesApi(CONNECTORS);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url === '/rpc/sources' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ sources: [], connectors: CONNECTORS }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Unreachable host' }), { status: 400 });
    }));
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');
    await userEvent.fill(page.getByLabelText(/Collections/), 'events');
    await page.getByRole('button', { name: 'Add source' }).last().click();

    await expect.element(page.getByText('Unreachable host')).toBeVisible();
  });

  it('still offers the crawl form for the web connector', async () => {
    const posts = stubSourcesApi(CONNECTORS);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Web/ }).click();

    await userEvent.fill(page.getByLabelText('URL'), 'https://example.com/docs');
    await page.getByRole('button', { name: 'Add source' }).last().click();

    await vi.waitFor(() => expect(posts).toHaveLength(1));

    expect(posts[0]!.body).toEqual({
      kind: 'web',
      configJson: { crawl: { startUrl: 'https://example.com/docs', maxDepth: 1, maxPages: 20 } },
    });
  });
});
