import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { describeSyncResult, filterConnectors, parseStrapiCollections, SourcesPanel } from './SourcesPanel';

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
  credentialPlatform: string | null;
};

function connector(slug: string, name: string, description: string): ConnectorFixture {
  return { slug, name, description, icon: name, authKind: 'apikey', credentialPlatform: null };
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
    enumerationNote: 'Nothing wrong with your token — Strapi keeps the list of collections behind its admin API (403), which no API token can reach whatever its scope. Type the plural ids below instead and each one will be checked against this instance.',
    checks,
    error: null,
  };
}

/**
 * Stand in for the endpoints the panel talks to, recording what it posts.
 * @param connectors - Tiles the picker should offer.
 * @param inspections - Replies for successive /rpc/connectors/strapi/inspect calls; the last repeats.
 * @param options - `inspectRejection` makes every inspect call fail with that message, as the route does for a URL with no scheme; `storedToken` and `storedBaseUrl` are what the credential read returns; `available` is what the workspace already holds for the platform, and `linkedCredentialId` which of those the install points at.
 * @param options.inspectRejection
 */
type SourceFixture = {
  id: number;
  slug: string;
  kind: string;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  enabled: string;
  createdAt: string;
  authKind: 'none' | 'apikey' | 'oauth';
  objectType: string | null;
  documentCount: number;
  credentialConnected: boolean;
  credentialUpdatedAt: string | null;
  credentialBroken: 'revoked' | 'expired' | 'missing' | null;
  sync: {
    status: 'running' | 'completed' | 'failed' | 'superseded' | 'abandoned';
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    counts: Record<string, number>;
  } | null;
};

/**
 * One configured source row as /rpc/sources returns it.
 * @param sync - The latest sync run to report, or null for a source never synced.
 */
function sourceRow(sync: SourceFixture['sync']): SourceFixture {
  return {
    id: 1,
    slug: 'strapi-cms',
    kind: 'strapi',
    config: { baseUrl: 'https://cms.partner.org', collections: ['events'] },
    lastSyncedAt: null,
    enabled: 'true',
    createdAt: '2026-08-01T00:00:00.000Z',
    authKind: 'apikey',
    objectType: null,
    documentCount: 0,
    credentialConnected: true,
    credentialUpdatedAt: '2026-08-01T00:00:00.000Z',
    credentialBroken: null,
    sync,
  };
}

function stubSourcesApi(
  connectors: ConnectorFixture[],
  inspections: Inspection[] = [],
  options: {
    inspectRejection?: string;
    sources?: SourceFixture[];
    storedToken?: string;
    /** Instance URL held in the credential, alongside its token. */
    storedBaseUrl?: string;
    /** The stored credential the install points at, when it points at one. */
    linkedCredentialId?: string;
    /** Credentials the workspace already holds for this platform. */
    available?: { id: string; name: string; keyHint: string | null; expiresAt: string | null }[];
  } = {},
) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  let inspectCall = 0;
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url === '/rpc/sources' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ sources: options.sources ?? [], connectors }), { status: 200 });
    }
    if (url === '/rpc/sources' && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ source: { id: 7 } }), { status: 200 });
    }
    if (url === '/rpc/connectors/strapi/inspect' && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      if (options.inspectRejection) {
        return new Response(JSON.stringify({ error: options.inspectRejection }), { status: 400 });
      }
      const reply = inspections[Math.min(inspectCall, inspections.length - 1)];
      inspectCall += 1;
      if (!reply) {
        return new Response(JSON.stringify({ error: 'no inspection stubbed' }), { status: 502 });
      }
      return new Response(JSON.stringify({ inspection: reply }), { status: 200 });
    }
    if (/^\/rpc\/sources\/\d+\/credentials$/.test(url) && (init?.method ?? 'GET') === 'GET') {
      posts.push({ url: `GET ${url}`, body: {} });
      const stored = options.storedToken === undefined
        ? null
        : {
            token: options.storedToken,
            ...(options.storedBaseUrl === undefined ? {} : { baseUrl: options.storedBaseUrl }),
          };
      return new Response(
        JSON.stringify({
          credentials: stored,
          available: options.available ?? [],
          linkedCredentialId: options.linkedCredentialId ?? null,
          platform: 'strapi',
          platformLabel: 'Strapi',
          helpText: 'A Strapi API token.',
          fields: [
            { name: 'baseUrl', label: 'Instance URL', shapeHint: 'starts with http:// or https://', secret: false },
            { name: 'token', label: 'API token', shapeHint: 'is any non-empty token', secret: true },
          ],
        }),
        { status: 200 },
      );
    }
    if (/^\/rpc\/sources\/\d+\/sync$/.test(url) && init?.method === 'POST') {
      posts.push({ url, body: {} });
      return new Response(
        JSON.stringify({ result: { created: 1, updated: 0, unchanged: 0, tombstoned: 0, errors: 0, firstError: null } }),
        { status: 200 },
      );
    }
    if (/^\/rpc\/sources\/\d+$/.test(url) && (init?.method === 'PATCH' || init?.method === 'DELETE')) {
      posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify({ source: { id: 1 }, documentsDeleted: 0 }), { status: 200 });
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

/**
 * Render the panel inside the intl provider its locale-aware links need.
 * Only tests that render a configured source row reach one.
 */
function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <SourcesPanel />
    </NextIntlClientProvider>,
  );
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
  it('says what is needed before collections can be loaded', async () => {
    stubSourcesApi(CONNECTORS, [notEnumerable([])]);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await expect.element(page.getByText(/fill in the instance URL and an API token/)).toBeVisible();
    await expect.element(page.getByText('Add the instance URL and an API token above and the collections load themselves.')).toBeVisible();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');
    await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');

    await expect.element(page.getByText(/Reading this instance|Ready — reading this instance/)).toBeVisible();
  });

  it('loads the collections on its own once the URL and the token are both filled', async () => {
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events', 'venues'])]);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');
    await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');

    // No click on Load collections — pasting both halves is the whole instruction.
    await expect.element(page.getByRole('checkbox', { name: /events/ })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: /venues/ })).toBeVisible();

    const inspects = posts.filter(post => post.url === '/rpc/connectors/strapi/inspect');

    expect(inspects.length).toBe(1);
  });

  it('leaves the load button clickable while a read is in flight, so it acts as a refresh', async () => {
    stubSourcesApi(CONNECTORS, [enumerated(['events'])]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await expect.element(page.getByRole('checkbox', { name: /events/ })).toBeVisible();

    const reload = page.getByRole('button', { name: 'Reload collections' });

    await expect.element(reload).toBeEnabled();

    await reload.click();

    await expect.element(page.getByRole('checkbox', { name: /events/ })).toBeVisible();
  });

  it('shows a rejected URL in the footer, beside the buttons, so it is visible without scrolling', async () => {
    stubSourcesApi(CONNECTORS, [], { inspectRejection: 'The base URL must start with http:// or https://' });
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'cms.partner.org');
    await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');

    const alert = page.getByRole('alert');

    await expect.element(alert).toHaveTextContent('The base URL must start with http:// or https://');

    // The alert has to live in the pinned footer next to Cancel, not in the
    // scrolling field list where a long form can push it out of sight.
    const footer = alert.element().parentElement;

    expect(footer?.querySelector('button')?.textContent).toContain('Cancel');
  });

  it('shows the API token in the clear when the eye is clicked, and hides it again', async () => {
    stubSourcesApi(CONNECTORS, [notEnumerable([])]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await expect.element(page.getByLabelText(/API token/)).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show token' }).click();

    await expect.element(page.getByLabelText(/API token/)).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Hide token' }).click();

    await expect.element(page.getByLabelText(/API token/)).toHaveAttribute('type', 'password');
  });

  it('puts each collection\'s entry count on its own row in the list', async () => {
    stubSourcesApi(CONNECTORS, [{
      ...enumerated(['events', 'venues']),
      checks: [
        { collection: 'events', status: 'ok', entryCount: 855, message: null },
        { collection: 'venues', status: 'ok', entryCount: 1, message: null },
      ],
    }]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await page.getByRole('button', { name: 'Load collections' }).click();

    // The count rides the checkbox's own label, so the row reads as one thing.
    await expect.element(page.getByRole('checkbox', { name: /events.*855 entries/ })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: /venues.*1 entry/ })).toBeVisible();
  });

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

    // No `baseUrl` in the config: a Strapi token only works against the
    // instance that issued it, so the URL is part of the credential.
    expect(create.body).toEqual({
      kind: 'strapi',
      configJson: {
        collections: ['events', 'organizers'],
        populate: '*',
        pageSize: 100,
      },
    });

    const credential = posts.find(post => post.url === '/rpc/sources/7/credentials')!;

    expect(credential.body).toEqual({
      credentials: { baseUrl: 'https://cms.partner.org', token: 'tok-123' },
    });
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

    await expect.element(page.getByText(/keeps the list of collections behind its admin API/)).toBeVisible();

    await userEvent.fill(page.getByLabelText('Collections'), 'events, venue');
    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByText(/events.*855 entries/)).toBeVisible();
    await expect.element(page.getByText('venueNo such collection')).toBeVisible();
  });

  it('names what is still missing, in the order the form is filled', async () => {
    stubSourcesApi(CONNECTORS, [notEnumerable([])]);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await expect.element(page.getByText('Still needed: the Strapi instance URL')).toBeVisible();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');

    await expect.element(page.getByText('Still needed: an API token')).toBeVisible();

    await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');

    // The one that was never obvious: a collection has to be chosen.
    await expect.element(page.getByText(/Still needed: at least one collection/)).toBeVisible();

    await userEvent.fill(page.getByLabelText('Collections'), 'events');

    await expect.element(page.getByText(/Still needed/)).not.toBeInTheDocument();
  });

  it('puts the same reason on the disabled button as a hover tooltip', async () => {
    stubSourcesApi(CONNECTORS, [enumerated(['events'])]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await expect.element(page.getByRole('checkbox', { name: /events/ })).toBeVisible();

    // A disabled button swallows hover, so the tooltip has to sit on its wrapper.
    const wrapper = page.getByRole('button', { name: 'Add source' }).last().element().parentElement;

    expect(wrapper?.getAttribute('title')).toContain('at least one collection');

    await page.getByRole('checkbox', { name: /events/ }).click();

    expect(wrapper?.getAttribute('title')).toBeNull();
  });

  it('refuses to add a collection the instance could not read, and says which one', async () => {
    const posts = stubSourcesApi(CONNECTORS, [
      notEnumerable([
        { collection: 'events', status: 'ok', entryCount: 855, message: null },
        { collection: 'venue', status: 'not-found', entryCount: null, message: 'No such collection on this instance.' },
      ]),
    ]);
    render(<SourcesPanel />);
    await openStrapiForm();

    await userEvent.fill(page.getByLabelText('Collections'), 'events, venue');
    await page.getByRole('button', { name: 'Load collections' }).click();

    await expect.element(page.getByText('venueNo such collection')).toBeVisible();

    const submit = page.getByRole('button', { name: 'Add source' }).last();

    await expect.element(submit).toBeDisabled();
    await expect.element(page.getByText(/Still needed: a fix for venue \(no such collection\)/)).toBeVisible();

    // Dropping the bad name is enough — the good one still checks out.
    await userEvent.fill(page.getByLabelText('Collections'), 'events');

    await expect.element(submit).toBeEnabled();

    await submit.click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources')).toHaveLength(1));

    const created = posts.find(post => post.url === '/rpc/sources')!;

    expect((created.body.configJson as { collections: string[] }).collections).toEqual(['events']);
  });

  it('lists a collection the instance rejected but will not let it be ticked', async () => {
    stubSourcesApi(CONNECTORS, [
      {
        ...enumerated(['events', 'venues']),
        checks: [
          { collection: 'events', status: 'ok', entryCount: 855, message: null },
          { collection: 'venues', status: 'forbidden', entryCount: null, message: 'The token has no read permission for this collection.' },
        ],
      },
    ]);
    render(<SourcesPanel />);
    await openStrapiForm();

    // Still listed — hiding it would leave "where is my collection?" unanswered.
    await expect.element(page.getByRole('checkbox', { name: /venues/ })).toBeVisible();
    await expect.element(page.getByText('venuesNo read permission')).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: /venues/ })).toBeDisabled();
    await expect.element(page.getByRole('checkbox', { name: /events/ })).toBeEnabled();
  });

  it('still submits typed collections that have never been checked', async () => {
    stubSourcesApi(CONNECTORS, [notEnumerable([])]);
    render(<SourcesPanel />);
    await openPicker();
    await page.getByRole('button', { name: /Strapi/ }).click();

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.partner.org');
    await userEvent.fill(page.getByLabelText(/API token/), 'tok-123');
    await userEvent.fill(page.getByLabelText('Collections'), 'events');

    await expect.element(page.getByRole('button', { name: 'Add source' }).last()).toBeEnabled();
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

describe('describeSyncResult', () => {
  it('names the reason when documents could not be saved', () => {
    const outcome = describeSyncResult({
      created: 0,
      updated: 0,
      unchanged: 0,
      tombstoned: 0,
      errors: 43,
      firstError: 'OPENAI_API_KEY is not set — embeddings require an OpenAI key.',
    });

    expect(outcome.hadErrors).toBe(true);
    expect(outcome.message).toContain('43 document(s) it could not save');
    expect(outcome.message).toContain('OPENAI_API_KEY is not set');
  });

  it('reports a partial run as errors, not as a success', () => {
    const outcome = describeSyncResult({
      created: 5,
      updated: 0,
      unchanged: 0,
      tombstoned: 0,
      errors: 2,
      firstError: 'rate limited',
    });

    expect(outcome.hadErrors).toBe(true);
    expect(outcome.message).toContain('2 document(s) it could not save');
    expect(outcome.message).toContain('5 saved');
  });

  it('sums the counts into one sentence for a clean run', () => {
    const outcome = describeSyncResult({
      created: 3,
      updated: 1,
      unchanged: 9,
      tombstoned: 2,
      errors: 0,
      firstError: null,
    });

    expect(outcome.hadErrors).toBe(false);
    expect(outcome.message).toBe('Sync finished: 3 added, 1 updated, 9 unchanged, 2 removed.');
  });

  it('says so plainly when a clean run changed nothing', () => {
    const outcome = describeSyncResult({
      created: 0,
      updated: 0,
      unchanged: 0,
      tombstoned: 0,
      errors: 0,
      firstError: null,
    });

    expect(outcome).toEqual({ message: 'Sync finished: nothing changed.', hadErrors: false });
  });

  it('does not claim success when the server said nothing at all', () => {
    expect(describeSyncResult(undefined).hadErrors).toBe(true);
  });
});

describe('a sync started somewhere else', () => {
  it('shows the source as syncing and blocks Sync now, with the 409 wording on hover', async () => {
    stubSourcesApi(CONNECTORS, [], {
      sources: [sourceRow({
        status: 'running',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        completedAt: null,
        error: null,
        counts: {},
      })],
    });
    renderPanel();

    await expect.element(page.getByText(/Syncing now — started/)).toBeVisible();

    const syncButton = page.getByRole('button', { name: /Syncing…/ });

    await expect.element(syncButton).toBeDisabled();
    await expect.element(syncButton).toHaveAttribute(
      'title',
      'This source is already syncing. Wait for it to finish, then try again.',
    );
  });

  it('keeps a failed run visible after a reload, with its reason', async () => {
    stubSourcesApi(CONNECTORS, [], {
      sources: [sourceRow({
        status: 'failed',
        startedAt: '2026-08-31T18:52:00.000Z',
        completedAt: '2026-08-31T18:53:00.000Z',
        error: 'all 43 document(s) failed, so nothing was saved. First failure: OPENAI_API_KEY is not set',
        counts: { errors: 43 },
      })],
    });
    renderPanel();

    await expect.element(page.getByText(/Last sync failed:/)).toBeVisible();
    await expect.element(page.getByText(/OPENAI_API_KEY is not set/)).toBeVisible();
  });

  it('says a run that never finished can be taken over', async () => {
    stubSourcesApi(CONNECTORS, [], {
      sources: [sourceRow({
        status: 'abandoned',
        startedAt: '2026-08-31T10:00:00.000Z',
        completedAt: null,
        error: null,
        counts: {},
      })],
    });
    renderPanel();

    await expect.element(page.getByText(/never finished — its process stopped/)).toBeVisible();
    // Takeover is allowed, so the button must not be stuck disabled.
    await expect.element(page.getByRole('button', { name: /Sync now/ })).toBeEnabled();
  });

  it('flags a finished run that dropped documents', async () => {
    stubSourcesApi(CONNECTORS, [], {
      sources: [sourceRow({
        status: 'completed',
        startedAt: '2026-08-31T18:52:00.000Z',
        completedAt: '2026-08-31T18:53:00.000Z',
        error: null,
        counts: { created: 10, errors: 2 },
      })],
    });
    renderPanel();

    await expect.element(page.getByText(/Last sync could not save 2 documents/)).toBeVisible();
  });
});

describe('editing and deleting a source', () => {
  it('opens the same form prefilled, and PATCHes instead of creating', async () => {
    const posts = stubSourcesApi(CONNECTORS, [], { sources: [sourceRow(null)] });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByText('Edit Strapi source')).toBeVisible();
    await expect.element(page.getByLabelText(/Strapi URL/)).toHaveValue('https://cms.partner.org');
    await expect.element(page.getByLabelText('Collections')).toHaveValue('events');

    // A stored token counts as present, so nothing is "still needed".
    await expect.element(page.getByText(/Still needed/)).not.toBeInTheDocument();

    await userEvent.fill(page.getByLabelText('Collections'), 'events, venues');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1')).toHaveLength(1));

    const patch = posts.find(post => post.url === '/rpc/sources/1')!;

    expect((patch.body.configJson as { collections: string[] }).collections).toEqual(['events', 'venues']);
    // No new source, and no credential write when the token field was left alone.
    expect(posts.filter(post => post.url === '/rpc/sources')).toHaveLength(0);
    // The GET that loads the stored token is recorded as "GET …", so this is
    // the write specifically.
    expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(0);

    // New settings, new picture: a fresh run starts on its own.
    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1/sync')).toHaveLength(1));
  });

  it('warns before saving that the edit restarts the sync', async () => {
    stubSourcesApi(CONNECTORS, [], { sources: [sourceRow(null)] });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByText(/Saving restarts this source's sync/)).toBeVisible();
  });

  it('says a run stopped because the settings changed', async () => {
    stubSourcesApi(CONNECTORS, [], {
      sources: [sourceRow({
        status: 'superseded',
        startedAt: '2026-08-31T18:52:00.000Z',
        completedAt: '2026-08-31T18:53:00.000Z',
        error: 'This sync stopped because the source\'s settings changed.',
        counts: {},
      })],
    });
    renderPanel();

    await expect.element(page.getByText(/stopped when the settings changed/)).toBeVisible();
  });

  it('writes a new token only when one is typed', async () => {
    const posts = stubSourcesApi(CONNECTORS, [], { sources: [sourceRow(null)] });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();
    await userEvent.fill(page.getByLabelText(/API token/), 'fresh-token');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(1));
  });

  it('says what a delete takes with it, and only deletes on confirm', async () => {
    const posts = stubSourcesApi(CONNECTORS, [], { sources: [sourceRow(null)] });
    renderPanel();

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect.element(page.getByText(/It cannot be undone/)).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    expect(posts.filter(post => post.url === '/rpc/sources/1')).toHaveLength(0);

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete source' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1')).toHaveLength(1));
  });

  it('offers Connect only while nothing is stored', async () => {
    const unconnected = { ...sourceRow(null), credentialConnected: false };
    stubSourcesApi(CONNECTORS, [], { sources: [unconnected] });
    renderPanel();

    await expect.element(page.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Update key' })).not.toBeInTheDocument();
  });
});

describe('the stored token on an edit', () => {
  it('loads it into the field instead of showing an empty box', async () => {
    stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [sourceRow(null)],
      storedToken: 'stored-tok-123',
    });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByLabelText(/API token/)).toHaveValue('stored-tok-123');
  });

  it('writes no new credential when the loaded credential is left alone', async () => {
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [sourceRow(null)],
      storedToken: 'stored-tok-123',
      storedBaseUrl: 'https://cms.partner.org',
      linkedCredentialId: 'cred_a',
    });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByLabelText(/API token/)).toHaveValue('stored-tok-123');

    await page.getByRole('button', { name: 'Save changes' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1')).toHaveLength(1));

    expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(0);
  });

  it('writes one when the loaded token is replaced', async () => {
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [sourceRow(null)],
      storedToken: 'stored-tok-123',
    });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByLabelText(/API token/)).toHaveValue('stored-tok-123');

    await userEvent.fill(page.getByLabelText(/API token/), 'replacement-tok');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(1));
  });

  it('rotates the credential the install points at instead of adding another', async () => {
    // The row id has to survive: every install pointing at this credential
    // resolves through that id, so storing a second row would leave them all
    // on the old key and pile up a Strapi credential per edit.
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [sourceRow(null)],
      storedToken: 'stored-tok-123',
      storedBaseUrl: 'https://cms.partner.org',
      linkedCredentialId: 'cred_a',
    });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByLabelText(/API token/)).toHaveValue('stored-tok-123');

    await userEvent.fill(page.getByLabelText(/API token/), 'replacement-tok');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(1));

    const credential = posts.find(post => post.url === '/rpc/sources/1/credentials')!;

    expect(credential.body).toEqual({
      apiTokenId: 'cred_a',
      credentials: { baseUrl: 'https://cms.partner.org', token: 'replacement-tok' },
    });
  });

  it('writes the credential when the instance URL changes and the token does not', async () => {
    // The URL is half of the same credential — a token that moved instance is
    // a new credential even if the secret is unchanged.
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [sourceRow(null)],
      storedToken: 'stored-tok-123',
      storedBaseUrl: 'https://cms.partner.org',
      linkedCredentialId: 'cred_a',
    });
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByLabelText(/API token/)).toHaveValue('stored-tok-123');

    await userEvent.fill(page.getByLabelText(/Strapi URL/), 'https://cms.moved.example');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(1));

    const credential = posts.find(post => post.url === '/rpc/sources/1/credentials')!;

    expect(credential.body).toMatchObject({
      credentials: { baseUrl: 'https://cms.moved.example' },
    });
  });

  it('says so rather than showing an empty field when the stored token cannot be read', async () => {
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url === '/rpc/sources' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ sources: [sourceRow(null)], connectors: CONNECTORS }), { status: 200 });
      }
      if (/^\/rpc\/sources\/\d+\/credentials$/.test(url)) {
        return new Response(
          JSON.stringify({ error: 'The stored credential could not be decrypted with the current vault key.' }),
          { status: 500 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchStub);
    renderPanel();

    await page.getByRole('button', { name: 'Edit' }).click();

    await expect.element(page.getByRole('alert')).toHaveTextContent(/could not be decrypted/);
  });
});

describe('connecting a connector to a stored credential', () => {
  /** A source with no credential yet, so the row offers Connect. */
  function unconnectedSource(): SourceFixture {
    return { ...sourceRow(null), credentialConnected: false };
  }

  it('offers the credentials the workspace already holds', async () => {
    // The point of the ticket: a key typed once under API credentials is
    // offered here rather than asked for a second time.
    stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [unconnectedSource()],
      available: [{ id: 'cred_a', name: 'Strapi — prod', keyHint: '…aaaa', expiresAt: null }],
    });
    renderPanel();

    await page.getByRole('button', { name: 'Connect' }).click();

    await expect.element(page.getByText('Strapi — prod')).toBeVisible();
    await expect.element(page.getByText('…aaaa')).toBeVisible();
  });

  it('links the picked credential without pasting anything', async () => {
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [unconnectedSource()],
      available: [{ id: 'cred_a', name: 'Strapi — prod', keyHint: '…aaaa', expiresAt: null }],
    });
    renderPanel();

    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByRole('button', { name: 'Use this credential' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(1));

    const post = posts.find(post => post.url === '/rpc/sources/1/credentials')!;

    expect(post.body).toEqual({ apiTokenId: 'cred_a' });
  });

  it('stores a supplied credential under a name, so the next connector can reuse it', async () => {
    const posts = stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [unconnectedSource()],
      available: [{ id: 'cred_a', name: 'Strapi — prod', keyHint: '…aaaa', expiresAt: null }],
    });
    renderPanel();

    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByRole('radio', { name: 'Add a new credential' }).click();

    await userEvent.fill(page.getByLabelText('Credential name'), 'Strapi — staging');
    await userEvent.fill(page.getByLabelText('Instance URL'), 'https://cms.staging.example');
    await userEvent.fill(page.getByLabelText('API token'), 'staging-token');
    await page.getByRole('button', { name: 'Save credential' }).click();

    await vi.waitFor(() => expect(posts.filter(post => post.url === '/rpc/sources/1/credentials')).toHaveLength(1));

    const post = posts.find(post => post.url === '/rpc/sources/1/credentials')!;

    expect(post.body).toEqual({
      credentials: { baseUrl: 'https://cms.staging.example', token: 'staging-token' },
      credentialName: 'Strapi — staging',
    });
  });

  it('leaves a non-secret field readable while it is typed', async () => {
    // Masking an instance URL only makes a typo harder to see.
    stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [unconnectedSource()],
    });
    renderPanel();

    await page.getByRole('button', { name: 'Connect' }).click();

    await expect.element(page.getByLabelText('Instance URL')).toHaveAttribute('type', 'text');
    await expect.element(page.getByLabelText('API token')).toHaveAttribute('type', 'password');
  });
});

describe('a credential that cannot be used', () => {
  it('says the credential was revoked rather than asking for one', async () => {
    // Three states, not two: this connector does not need a key pasted, it
    // needs the key it already names put back in service.
    stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [{ ...sourceRow(null), credentialConnected: false, credentialBroken: 'revoked' }],
    });
    renderPanel();

    await expect.element(page.getByText('Credential revoked')).toBeVisible();
  });

  it('says expired when that is what happened', async () => {
    stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [{ ...sourceRow(null), credentialConnected: false, credentialBroken: 'expired' }],
    });
    renderPanel();

    await expect.element(page.getByText('Credential expired')).toBeVisible();
  });

  it('still asks for a credential when nobody has connected the source', async () => {
    stubSourcesApi(CONNECTORS, [enumerated(['events'])], {
      sources: [{ ...sourceRow(null), credentialConnected: false, credentialBroken: null }],
    });
    renderPanel();

    await expect.element(page.getByText('Needs credentials')).toBeVisible();
  });
});
