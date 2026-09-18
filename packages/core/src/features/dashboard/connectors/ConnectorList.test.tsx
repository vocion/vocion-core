import type { ConnectorTile, Source } from './connectorRows';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/connectors',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { ConnectorList } = await import('./ConnectorList');
const { buildConnectorRows } = await import('./connectorRows');

const tile = (slug: string, name: string, extra: Partial<ConnectorTile> = {}): ConnectorTile => ({
  slug,
  name,
  description: `Ingest ${name} records.`,
  icon: 'Database',
  authKind: 'oauth',
  credentialPlatform: null,
  syncless: false,
  inspectable: false,
  ...extra,
});

const source = (extra: Partial<Source> = {}): Source => ({
  id: 4,
  slug: 'zoom-recordings',
  kind: 'plugin',
  config: { _connector: 'zoom' },
  lastSyncedAt: '2026-09-17T16:00:00.000Z',
  enabled: 'true',
  createdAt: '2026-09-01T00:00:00.000Z',
  authKind: 'oauth',
  objectType: null,
  documentCount: 12,
  chunkCount: 340,
  credentialConnected: true,
  credentialUpdatedAt: '2026-09-01T00:00:00.000Z',
  credentialBroken: null,
  syncless: false,
  inspectable: false,
  inspectNote: null,
  sync: null,
  ...extra,
});

const ZOOM = tile('zoom', 'Zoom', { requiredScopes: ['user:read:list_users:admin', 'cloud_recording:read:list_recording_files:admin'] });
const ERROR = 'Zoom recordings list failed: 400 {"code":4711,"message":"Invalid access token, does not contain scopes:[cloud_recording:read:list_recording_files:admin]"}';

function renderList(sources: Source[], handlers: Partial<React.ComponentProps<typeof ConnectorList>> = {}) {
  const rows = buildConnectorRows([tile('hubspot', 'HubSpot', { authKind: 'apikey' }), ZOOM, tile('web', 'Web', { authKind: 'none' })], sources);
  const noop = () => {};
  return render(
    <ConnectorList rows={rows} syncingId={null} onConnectNew={noop} onSync={noop} onTest={noop} onEdit={noop} onDelete={noop} onConnect={noop} {...handlers} />,
  );
}

describe('ConnectorList', () => {
  it('is one flat list: connected at the top with its size, the rest offered as Connect', async () => {
    renderList([source()]);

    await expect.element(page.getByText('3 connectors · 1 connected')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Zoom/ })).toBeVisible();
    await expect.element(page.getByText(/12 documents · 340 chunks · last sync/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Connect HubSpot' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Connect Web' })).toBeVisible();

    // Connected rows first, whatever the alphabet says.
    const names = page.getByRole('button').elements().map(el => el.getAttribute('aria-label') ?? el.textContent ?? '');

    expect(names.findIndex(n => n.startsWith('Zoom'))).toBeLessThan(names.findIndex(n => n === 'Connect HubSpot'));
  });

  it('a Connect row hands its connector slug to the caller', async () => {
    const onConnectNew = vi.fn();
    renderList([], { onConnectNew });

    await userEvent.click(page.getByRole('button', { name: 'Connect HubSpot' }));

    expect(onConnectNew).toHaveBeenCalledWith('hubspot');
  });

  it('opens a connected row in place to its last run, size, and the scopes it is missing — with Reconnect', async () => {
    const onConnect = vi.fn();
    const failed = source({ sync: { status: 'failed', startedAt: '2026-09-18T14:00:00.000Z', completedAt: '2026-09-18T14:00:03.000Z', error: ERROR, counts: {} } });
    renderList([failed], { onConnect });

    await expect.element(page.getByText('Needs attention')).toBeVisible();
    expect(page.getByTestId('connector-detail').elements()).toHaveLength(0);

    await userEvent.click(page.getByRole('button', { name: /^Zoom/ }));

    await expect.element(page.getByTestId('connector-detail')).toBeVisible();
    await expect.element(page.getByText('Last sync failed: the token is missing 1 scope.')).toBeVisible();
    await expect.element(page.getByText('Chunks in retrieval:')).toBeVisible();

    const scopes = page.getByTestId('connector-scopes');

    await expect.element(scopes.getByText('cloud_recording:read:list_recording_files:admin')).toBeVisible();
    await expect.element(scopes.getByText('missing', { exact: true })).toBeVisible();
    await expect.element(scopes.getByText(/Add the missing scopes to the app/)).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Reconnect' }));

    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it('shows a running sync\'s progress on the row without opening it', async () => {
    renderList([source({ sync: { status: 'running', startedAt: new Date(Date.now() - 120_000).toISOString(), completedAt: null, error: null, counts: { created: 40, updated: 2 } } })]);

    await expect.element(page.getByText('Syncing now', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/started 2m ago · 42 documents so far/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Syncing…/ })).toBeDisabled();
  });

  it('filters by the words typed and says how many match', async () => {
    renderList([]);

    await userEvent.fill(page.getByLabelText('Search connectors'), 'hub');

    await expect.element(page.getByText('1 of 3 connectors')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Connect Web' })).not.toBeInTheDocument();
  });
});
