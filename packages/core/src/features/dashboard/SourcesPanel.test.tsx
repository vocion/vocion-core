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

/**
 * A numbered fixture whose name is zero-padded, so its alphabetical position
 * matches its number — "Connector 2" would otherwise sort after "Connector 19".
 * @param index - Which connector in the run of fixtures.
 */
function paddedConnector(index: number): ConnectorFixture {
  const label = String(index).padStart(2, '0');
  return connector(`c${label}`, `Connector ${label}`, `Ingest system ${label}.`);
}

const CONNECTORS: ConnectorFixture[] = [
  connector('web', 'Web', 'Crawl a site from one URL — same-origin BFS.'),
  connector('strapi', 'Strapi', 'Ingest entries from one or more Strapi CMS collections — incremental by updatedAt.'),
  connector('google-ads', 'Google Ads', 'Ingest Google Ads campaign performance by day.'),
  connector('hubspot', 'HubSpot', 'Ingest HubSpot CRM records (contacts, deals, companies).'),
];

type Inspection = {
  reachable: boolean;
  authorized: boolean;
  detectedVersion: 4 | 5 | null;
  collections: string[] | null;
  enumerationNote: string | null;
  checks: { collection: string; status: string; entryCount: number | null; message: string | null }[];
  error: string | null;
};

/**
 * An inspect reply where the instance let us enumerate its collections.
 * @param collections
 */
function enumerated(collections: string[]): Inspection {
  return {
    reachable: true,
    authorized: true,
    detectedVersion: 5,
    collections,
    enumerationNote: null,
    checks: [],
    error: null,
  };
}

/**
 * An inspect reply from an instance that keeps its content-type list admin-only.
 * @param checks
 */
function notEnumerable(checks: Inspection['checks']): Inspection {
  return {
    reachable: checks.length > 0,
    authorized: checks.some(check => check.status === 'ok'),
    detectedVersion: checks.some(check => check.status === 'ok') ? 5 : null,
    collections: null,
    enumerationNote: 'This instance keeps its content-type list behind the admin API (403), so the collections can\'t be listed with an API token. Type the plural ids instead and each one will be checked.',
    checks,
    error: null,
  };
}

/**
 * Stand in for the endpoints the panel talks to, recording what it posts.
 * @param connectors - Tiles the picker should offer.
 * @param inspections - Replies for successive /rpc/connectors/strapi/inspect calls; the last repeats.
 */
function stubSourcesApi(connectors: ConnectorFixture[], inspections: Inspection[] = []) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  let inspectCall = 0;
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url === '/rpc/sources' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ sources: [], connectors }), { status: 200 });
    }
    if (url === '/rpc/sources' && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ source: { id: 7 } }), { status: 200 });
    }
    if (url === '/rpc/connectors/strapi/inspect' && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      const reply = inspections[Math.min(inspectCall, inspections.length - 1)];
      inspectCall += 1;
      if (!reply) {
        return new Response(JSON.stringify({ error: 'no inspection stubbed' }), { status: 502 });
      }
      return new Response(JSON.stringify({ inspection: reply }), { status: 200 });
    }
    if (/^\/rpc\/sources\/\d+\/credentials$/.test(url) && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ credentialId: 'cred-1' }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `unstubbed ${init?.method ?? 'GET'} ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchStub);
  return posts;
}

/** Open the picker, choose Strapi, and fill in the connection details. */
async function openStrapiForm() {
  await openPicker();
  await page.getByRole('button', { name: /Strapi/ }).click();

  await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');
  await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');
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

  it('sorts matches A–Z by name, not by registry order', () => {
    expect(filterConnectors(CONNECTORS, '').map(c => c.name)).toEqual(['Google Ads', 'HubSpot', 'Strapi', 'Web']);
    expect(filterConnectors(CONNECTORS, 'ingest').map(c => c.name)).toEqual(['Google Ads', 'HubSpot', 'Strapi']);
  });

  it('leaves the caller\'s array untouched while sorting', () => {
    const original = [...CONNECTORS];
    filterConnectors(CONNECTORS, '');

    expect(CONNECTORS).toEqual(original);
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
    const many = Array.from({ length: 30 }, (_, i) => paddedConnector(i));
    stubSourcesApi(many);
    render(<SourcesPanel />);
    await openPicker();

    // 25 rendered, so the 26th card is absent until "Show more" is clicked.
    await expect.element(page.getByRole('button', { name: /Connector 24/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Connector 25/ })).not.toBeInTheDocument();

    await page.getByRole('button', { name: /Show 5 more/ }).click();

    await expect.element(page.getByRole('button', { name: /Connector 29/ })).toBeVisible();
  });

  it('drops back to one page of results when the query changes', async () => {
    const many = Array.from({ length: 30 }, (_, i) => paddedConnector(i));
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
  it('lists the instance\'s collections to tick when the instance can be enumerated', async () => {
    stubSourcesApi(CONNECTORS, [enumerated(['events', 'venues'])]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByText('Connected — Strapi v5, token accepted.')).toBeVisible();
    await expect.element(page.getByText(/2 collections on this instance/)).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'events' })).toBeVisible();
  });

  it('posts only the ticked collections, then stores the token against the new source', async () => {
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events', 'venues', 'organizers'])]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByRole('checkbox', { name: 'events' })).toBeVisible();

    await page.getByRole('checkbox', { name: 'events' }).click();
    await page.getByRole('checkbox', { name: 'organizers' }).click();
    await page.getByRole('button', { name: 'Add source' }).last().click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources')).toHaveLength(1));

    const create = posts.find(post => post.url === '/rpc/sources')!;

    expect(create.body).toEqual({
      kind: 'strapi',
      configJson: {
        baseUrl: 'https://cms.partner.org',
        collections: ['events', 'organizers'],
        populate: '*',
        pageSize: 100,
      },
    });

    const credential = posts.find(post => post.url === '/rpc/sources/7/credentials')!;

    expect(credential.body).toEqual({ credentials: { token: 'tok-123' } });
  });

  it('keeps the typed list and reports on each name when the instance cannot be enumerated', async () => {
    stubSourcesApi(CONNECTORS, [
      notEnumerable([]),
      notEnumerable([
        { collection: 'events', status: 'ok', entryCount: 855, message: null },
        { collection: 'venue', status: 'not-found', entryCount: null, message: 'No such collection on this instance.' },
      ]),
    ]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByText(/keeps its content-type list behind the admin API/)).toBeVisible();

    await userEvent.fill(page.getByLabelText('Collections'), 'events, venue');
    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByText(/events.*855 entries/)).toBeVisible();
    await expect.element(page.getByText(/venue.*No such collection/)).toBeVisible();
  });

  it('keeps submit disabled until the URL, the token and a collection are all given', async () => {
    stubSourcesApi(CONNECTORS, [notEnumerable([])]);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    const submit = page.getByRole('button', { name: 'Add source' }).last();

    await expect.element(submit).toBeDisabled();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');

    await expect.element(submit).toBeDisabled();

    await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');

    await expect.element(submit).toBeDisabled();

    await userEvent.fill(page.getByLabelText('Collections'), 'events');

    await expect.element(submit).toBeEnabled();
  });

  it('cannot load collections before both the URL and the token are given', async () => {
    stubSourcesApi(CONNECTORS, [notEnumerable([])]);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await expect.element(page.getByRole('button', { name: 'Load collections' })).toBeDisabled();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');
    await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');

    await expect.element(page.getByRole('button', { name: 'Load collections' })).toBeEnabled();
  });

  it('warns in place, not as a failure, when the instance is reachable but the token is unproven', async () => {
    const unproven = {
      ...notEnumerable([{ collection: 'events', status: 'ok', entryCount: 855, message: null }]),
      authorized: false,
      error: 'These collections are readable without a credential, so the token could not be confirmed here. The sync still sends it.',
    };
    stubSourcesApi(CONNECTORS, [unproven]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await userEvent.fill(page.getByLabelText('Collections'), 'events');
    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByText(/could not be confirmed here/)).toBeVisible();
    // Reachable, so submit is still allowed — the operator decides.
    await expect.element(page.getByRole('button', { name: 'Add source' }).last()).toBeEnabled();
  });

  it('surfaces an unreachable instance instead of closing the dialog', async () => {
    stubSourcesApi(CONNECTORS, []);
    render(<SourcesPanel />);
    await openStrapiForm();

    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByText('no inspection stubbed')).toBeVisible();
  });

  it('surfaces the create error and does not store a token when the source is rejected', async () => {
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url === '/rpc/sources' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ sources: [], connectors: CONNECTORS }), { status: 200 });
      }
      if (url === '/rpc/connectors/strapi/inspect') {
        return new Response(JSON.stringify({ inspection: enumerated(['events']) }), { status: 200 });
      }
      posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ error: 'Unreachable host' }), { status: 400 });
    }));
    render(<SourcesPanel />);
    await openStrapiForm();

    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByRole('checkbox', { name: 'events' })).toBeVisible();

    await page.getByRole('checkbox', { name: 'events' }).click();
    await page.getByRole('button', { name: 'Add source' }).last().click();

    await expect.element(page.getByText('Unreachable host')).toBeVisible();
    expect(posts.filter(post => post.url.endsWith('/credentials'))).toEqual([]);
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
