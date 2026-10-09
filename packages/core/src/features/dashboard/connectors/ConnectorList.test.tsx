import type { ConnectorTile, Source } from './connectorRows';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import messages from '@/locales/en.json';

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/connectors',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { ConnectorList } = await import('./ConnectorList');
const { buildConnections, catalogEntries } = await import('./connectorRows');

const NOW = Date.parse('2026-10-09T12:00:00.000Z');

const tile = (slug: string, name: string, extra: Partial<ConnectorTile> = {}): ConnectorTile => ({
  slug,
  name,
  description: `Reads ${name} records. Then more detail nobody needs on a card.`,
  icon: 'Database',
  authKind: 'apikey',
  credentialPlatform: null,
  syncless: false,
  inspectable: false,
  ...extra,
});

const source = (id: number, connector: string, extra: Partial<Source> = {}): Source => ({
  id,
  slug: connector,
  kind: 'plugin',
  config: { _connector: connector },
  lastSyncedAt: '2026-10-09T10:00:00.000Z',
  enabled: 'true',
  createdAt: '2026-09-01T00:00:00.000Z',
  authKind: 'apikey',
  objectType: null,
  documentCount: 12,
  chunkCount: 340,
  credentialConnected: true,
  credentialUpdatedAt: '2026-09-01T00:00:00.000Z',
  credentialBroken: null,
  syncless: false,
  inspectable: false,
  inspectNote: null,
  sync: { status: 'completed', startedAt: '2026-10-09T10:00:00.000Z', completedAt: '2026-10-09T10:01:00.000Z', error: null, counts: { created: 12 } },
  ...extra,
});

const ZOOM_ERROR = 'Zoom recordings list failed: 400 {"code":4711,"message":"Invalid access token, does not contain scopes:[cloud_recording:read:list_recording_files:admin]"}';

const TILES = [
  tile('web', 'Web', { authKind: 'none', category: 'docs-files' }),
  tile('zoom', 'Zoom', { authKind: 'oauth', category: 'chat-meetings', requiredScopes: ['user:read:list_users:admin', 'cloud_recording:read:list_recording_files:admin'] }),
  tile('hubspot', 'HubSpot', { category: 'sales-marketing' }),
  tile('github', 'GitHub', { category: 'engineering' }),
  tile('gmail', 'Gmail', { authKind: 'oauth', category: 'mail-calendar' }),
  tile('quickbooks', 'QuickBooks Online', { authKind: 'oauth', category: 'finance-people' }),
  tile('apollo', 'Apollo', { category: 'sales-marketing', syncless: true }),
];

type Props = React.ComponentProps<typeof ConnectorList>;

function renderList(sources: Source[], extra: Partial<Props> & { unavailable?: string[] } = {}) {
  const isAdmin = extra.isAdmin ?? true;
  const handlers = {
    onConnectNew: vi.fn(),
    onSync: vi.fn(),
    onTest: vi.fn(),
    onEdit: vi.fn(),
    onConnect: vi.fn(),
    onPause: vi.fn(),
    onDisconnect: vi.fn(),
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConnectorList
        connections={buildConnections(TILES, sources)}
        catalog={catalogEntries(TILES, sources, { unavailable: extra.unavailable ?? [], isAdmin })}
        recommended={[]}
        usedBy={{}}
        isAdmin={isAdmin}
        syncingId={null}
        now={NOW}
        {...handlers}
        {...extra}
      />
    </NextIntlClientProvider>,
  );
  return handlers;
}

/**
 * A section's element, once it has rendered.
 * @param id - Its test id.
 */
async function section(id: string): Promise<HTMLElement> {
  await expect.element(page.getByTestId(id)).toBeInTheDocument();

  return page.getByTestId(id).element() as HTMLElement;
}

const row = (slug: string) => page.getByTestId('connected-section').element().querySelector(`[data-connection="${slug}"]`) as HTMLElement;

describe('Connected', () => {
  it('is one row per connection: its status in words, who uses it and when it last synced', async () => {
    renderList([source(1, 'web', { authKind: 'none' })], { usedBy: { web: ['Support lead', 'Software Factory'] } });

    await expect.element(page.getByTestId('connection-status')).toHaveTextContent('Working');
    await expect.element(page.getByText('Used by Support lead, Software Factory · Synced 2 hours ago')).toBeVisible();
    // A working connection has nothing to fix, so the row has no button but its menu.
    expect(row('web').querySelectorAll('button:not([data-testid="row-menu"])')).toHaveLength(1);
  });

  it('puts the connections that need a person first, each with a plain reason and its one fix', async () => {
    const { onConnect } = renderList([
      source(1, 'web', { authKind: 'none' }),
      source(2, 'hubspot', { credentialBroken: 'expired', credentialConnected: false }),
    ]);

    const slugs = [...(await section('connected-section')).querySelectorAll('[data-connection]')].map(el => el.getAttribute('data-connection'));

    expect(slugs).toEqual(['hubspot', 'web']);

    await expect.element(page.getByText('Needs attention: sign-in expired')).toBeVisible();

    await page.getByRole('button', { name: 'Reconnect HubSpot' }).click();

    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('says a missing permission plainly and keeps the scope ids for Details', async () => {
    renderList([source(1, 'zoom', { authKind: 'oauth', sync: { status: 'failed', startedAt: '2026-10-09T10:00:00.000Z', completedAt: null, error: ZOOM_ERROR, counts: {} } })]);

    await expect.element(page.getByText('Needs attention: needs more permissions')).toBeVisible();
    await expect.element(page.getByText('cloud_recording:read:list_recording_files:admin')).not.toBeInTheDocument();

    await page.getByRole('button', { name: /^Zoom/ }).click();
    await page.getByText('Details').click();

    await expect.element(page.getByTestId('connector-scopes')).toHaveTextContent(/cloud_recording:read:list_recording_files:admin\s*missing/);
  });

  it('offers Try again where a run failed and there is no login to redo', async () => {
    const { onSync } = renderList([source(1, 'web', { authKind: 'none', sync: { status: 'abandoned', startedAt: '2026-10-09T10:00:00.000Z', completedAt: null, error: null, counts: {} } })]);

    await expect.element(page.getByText('Needs attention: a sync stopped partway')).toBeVisible();

    await page.getByRole('button', { name: 'Try again Web' }).click();

    expect(onSync).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('keeps Manage, Pause and Disconnect behind one quiet menu', async () => {
    const { onPause, onDisconnect } = renderList([source(1, 'hubspot')]);

    await page.getByRole('button', { name: 'More for HubSpot' }).click();

    await expect.element(page.getByRole('menuitem', { name: 'Manage' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: 'Pause' })).toBeVisible();

    await page.getByRole('menuitem', { name: 'Disconnect' }).click();

    expect(onDisconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));

    await page.getByRole('button', { name: 'More for HubSpot' }).click();
    await page.getByRole('menuitem', { name: 'Pause' }).click();

    expect(onPause).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), true);
  });

  it('a paused connection reads Paused and offers Resume', async () => {
    const { onPause } = renderList([source(1, 'hubspot', { enabled: 'false' })]);

    await expect.element(page.getByTestId('connection-status')).toHaveTextContent('Paused');

    await page.getByRole('button', { name: 'More for HubSpot' }).click();
    await page.getByRole('menuitem', { name: 'Resume' }).click();

    expect(onPause).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), false);
  });

  it('opens in place to Manage: its actions, with the detail folded behind Details', async () => {
    const { onSync, onEdit } = renderList([source(1, 'hubspot')]);

    await page.getByRole('button', { name: /^HubSpot/ }).click();
    await page.getByRole('button', { name: 'Sync now' }).click();
    await page.getByRole('button', { name: 'Change settings' }).click();

    expect(onSync).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();

    await expect.element(page.getByText('Chunks in search: 340')).not.toBeVisible();

    await page.getByText('Details').click();

    await expect.element(page.getByText('Chunks in search: 340')).toBeVisible();
  });

  it('names the account a grant is on and marks each listed repository against what it granted, in Details', async () => {
    renderList([source(1, 'github', {
      config: { _connector: 'github', repos: ['northwind/portal', 'northwind/billing'] },
      grant: { account: 'northwind (organization)', granted: { label: 'Repositories', items: ['northwind/portal', 'northwind/docs'] } },
    })]);

    await page.getByRole('button', { name: /^GitHub/ }).click();

    await expect.element(page.getByText('Connected as northwind (organization)')).toBeVisible();

    await page.getByText('Details').click();
    const grant = page.getByTestId('connector-grant').element();

    expect(grant.querySelector('[data-grant-state="not-granted"]')?.textContent).toContain('northwind/billing');
    expect(grant.querySelector('[data-grant-state="not-listed"]')?.textContent).toContain('northwind/docs');
  });

  it('shows a member what is connected, with nothing to change and a line saying who can', async () => {
    renderList([source(1, 'hubspot', { credentialBroken: 'revoked', credentialConnected: false })], { isAdmin: false });

    await expect.element(page.getByText('Needs attention: access was revoked')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Reconnect HubSpot' })).not.toBeInTheDocument();
    await expect.element(page.getByTestId('member-note')).toHaveTextContent('Only an admin can connect new systems.');
    await expect.element(page.getByTestId('catalog-section')).not.toBeInTheDocument();
  });
});

describe('Recommended for this workspace', () => {
  const RECOMMENDED = [
    { slug: 'github', name: 'GitHub', why: 'Software Factory needs it' },
    { slug: 'hubspot', name: 'HubSpot', why: 'Used in 2 other workspaces of your Org' },
    { slug: 'gmail', name: 'Gmail', why: 'Mail at northwind.example is hosted there' },
    { slug: 'zoom', name: 'Zoom', why: 'You named it' },
  ];

  it('shows at most three, each with its one reason, and drops what is already connected', async () => {
    const { onConnectNew } = renderList([source(1, 'hubspot')], { recommended: RECOMMENDED });
    const section = page.getByTestId('recommended-section');

    await expect.element(section.getByText('Software Factory needs it')).toBeVisible();
    expect(section.element().querySelectorAll('[data-recommended]')).toHaveLength(3);
    expect(section.element().textContent).not.toContain('HubSpot');

    await section.getByRole('button', { name: 'Connect GitHub' }).click();

    expect(onConnectNew).toHaveBeenCalledWith('github');
  });

  it('is not offered to a member, who cannot connect anything', async () => {
    renderList([], { recommended: RECOMMENDED, isAdmin: false });

    await expect.element(page.getByTestId('recommended-section')).not.toBeInTheDocument();
  });
});

describe('All connectors', () => {
  it('stays folded behind its search box while the page has other things on it', async () => {
    renderList([source(1, 'hubspot')]);

    expect((await section('catalog-section')).querySelector('[data-catalog]')).toBeNull();

    await userEvent.fill(page.getByRole('searchbox', { name: 'Search connectors' }), 'git');

    await expect.element(page.getByRole('button', { name: 'Connect GitHub' })).toBeVisible();
    expect(page.getByTestId('catalog-section').element().querySelectorAll('[data-catalog]')).toHaveLength(1);
  });

  it('is open from the start on a page with nothing else on it, one sentence per connector', async () => {
    renderList([]);

    await expect.element(page.getByRole('button', { name: 'Connect Web' })).toBeVisible();
    await expect.element(page.getByText('Reads Web records.', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/more detail nobody needs/)).not.toBeInTheDocument();
  });

  it('narrows to a category', async () => {
    renderList([source(1, 'hubspot')]);

    await page.getByRole('button', { name: 'Engineering' }).click();

    await expect.element(page.getByRole('button', { name: 'Engineering' })).toHaveAttribute('aria-pressed', 'true');
    expect([...page.getByTestId('catalog-section').element().querySelectorAll('[data-catalog]')].map(el => el.getAttribute('data-catalog'))).toEqual(['github']);
  });

  it('says quietly that a connector cannot be connected on this server, with no button', async () => {
    renderList([], { unavailable: ['quickbooks'] });

    const qb = (await section('catalog-section')).querySelector('[data-catalog="quickbooks"]')!;

    expect(qb.textContent).toContain('Not available on this server');
    expect(qb.querySelector('button')).toBeNull();
  });

  it('offers another connection of a connector that takes several, and none of one that takes one', async () => {
    renderList([source(1, 'web', { authKind: 'none' }), source(2, 'apollo', { syncless: true }), source(3, 'hubspot')]);

    await page.getByRole('button', { name: 'Browse all connectors' }).click();

    await expect.element(page.getByRole('button', { name: 'Add another Web connection' })).toBeVisible();
    expect(page.getByTestId('catalog-section').element().querySelector('[data-catalog="apollo"]')?.textContent).toContain('Connected');
  });

  it('says so when nothing matches', async () => {
    renderList([]);
    await userEvent.fill(page.getByRole('searchbox', { name: 'Search connectors' }), 'nothing like it');

    await expect.element(page.getByText('No connector matches “nothing like it”.')).toBeVisible();
  });
});
