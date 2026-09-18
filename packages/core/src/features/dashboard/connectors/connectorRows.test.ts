import type { ConnectorTile, Source } from './connectorRows';
import { describe, expect, it } from 'vitest';
import { attentionFor, buildConnectorRows, filterConnectorRows, parseMissingScopes } from './connectorRows';

const tile = (slug: string, name: string, extra: Partial<ConnectorTile> = {}): ConnectorTile => ({
  slug,
  name,
  description: `Ingest ${name}.`,
  icon: 'Database',
  authKind: 'apikey',
  credentialPlatform: null,
  syncless: false,
  inspectable: false,
  ...extra,
});

const source = (slug: string, connector: string, extra: Partial<Source> = {}): Source => ({
  id: 1,
  slug,
  kind: 'plugin',
  config: { _connector: connector },
  lastSyncedAt: null,
  enabled: 'true',
  createdAt: '2026-09-01T00:00:00.000Z',
  authKind: 'apikey',
  objectType: null,
  documentCount: 0,
  credentialConnected: true,
  credentialUpdatedAt: null,
  credentialBroken: null,
  syncless: false,
  inspectable: false,
  inspectNote: null,
  sync: null,
  ...extra,
});

const ZOOM_ERROR = 'Zoom recordings list failed: 400 {"code":4711,"message":"Invalid access token, does not contain scopes:[cloud_recording:read:list_recording_files:admin, cloud_recording:read:list_user_recordings:admin]"}';

describe('parseMissingScopes', () => {
  it('reads the scope ids Zoom names in a code 4711 error', () => {
    expect(parseMissingScopes(ZOOM_ERROR)).toEqual([
      'cloud_recording:read:list_recording_files:admin',
      'cloud_recording:read:list_user_recordings:admin',
    ]);
  });

  it('is empty for an error that names no scopes, and for no error', () => {
    expect(parseMissingScopes('ECONNRESET')).toEqual([]);
    expect(parseMissingScopes(null)).toEqual([]);
  });
});

describe('buildConnectorRows', () => {
  const tiles = [tile('web', 'Web', { authKind: 'none' }), tile('zoom', 'Zoom', { authKind: 'oauth', requiredScopes: ['user:read:list_users:admin', 'cloud_recording:read:list_recording_files:admin'] }), tile('hubspot', 'HubSpot')];

  it('lists every connector, connected first, each group A–Z', () => {
    const rows = buildConnectorRows(tiles, [source('zoom-main', 'zoom')]);

    expect(rows.map(r => `${r.tile.slug}:${r.state}`)).toEqual(['zoom:connected', 'hubspot:not-connected', 'web:not-connected']);
  });

  it('sums the size across a connector\'s rows and keeps the newest sync time', () => {
    const rows = buildConnectorRows(tiles, [
      source('site-a', 'web', { id: 1, authKind: 'none', documentCount: 10, chunkCount: 120, lastSyncedAt: '2026-09-17T10:00:00.000Z' }),
      source('site-b', 'web', { id: 2, authKind: 'none', documentCount: 5, chunkCount: 40, lastSyncedAt: '2026-09-18T10:00:00.000Z' }),
    ]);
    const web = rows.find(r => r.tile.slug === 'web')!;

    expect(web.sources).toHaveLength(2);
    expect(web.documents).toBe(15);
    expect(web.chunks).toBe(160);
    expect(web.lastSyncedAt).toBe('2026-09-18T10:00:00.000Z');
  });

  it('is syncing while any row runs, and needs attention when a run failed on scopes', () => {
    const running = buildConnectorRows(tiles, [source('z', 'zoom', { sync: { status: 'running', startedAt: '2026-09-18T10:00:00.000Z', completedAt: null, error: null, counts: {} } })]);

    expect(running[0]?.state).toBe('syncing');

    const failed = buildConnectorRows(tiles, [source('z', 'zoom', { sync: { status: 'failed', startedAt: '2026-09-18T10:00:00.000Z', completedAt: '2026-09-18T10:00:05.000Z', error: ZOOM_ERROR, counts: {} } })]);
    const zoom = failed[0]!;

    expect(zoom.state).toBe('attention');
    expect(zoom.attention).toBe('Last sync failed: the token is missing 2 scopes.');
    expect(zoom.missingScopes).toEqual(['cloud_recording:read:list_recording_files:admin', 'cloud_recording:read:list_user_recordings:admin']);
  });

  it('puts a revoked credential ahead of a sync error, since the fix is different', () => {
    expect(attentionFor([source('h', 'hubspot', { credentialBroken: 'revoked', sync: { status: 'failed', startedAt: '', completedAt: null, error: '401', counts: {} } })])).toMatch(/revoked/);
    expect(attentionFor([source('h', 'hubspot', { credentialConnected: false })])).toMatch(/Needs credentials/);
    expect(attentionFor([source('h', 'hubspot')])).toBeNull();
  });

  it('keeps a row whose connector is no longer registered, rather than hiding its documents', () => {
    const rows = buildConnectorRows(tiles, [source('old', 'legacy-crm', { documentCount: 3 })]);

    expect(rows[0]?.tile.slug).toBe('legacy-crm');
    expect(rows[0]?.documents).toBe(3);
  });

  it('filters by every word in any order and keeps the order otherwise', () => {
    const rows = buildConnectorRows([tile('google-ads', 'Google Ads'), tile('ga4', 'Google Analytics')], []);

    expect(filterConnectorRows(rows, 'ads google').map(r => r.tile.slug)).toEqual(['google-ads']);
    expect(filterConnectorRows(rows, '').map(r => r.tile.slug)).toEqual(['google-ads', 'ga4']);
    expect(filterConnectorRows(rows, 'salesforce')).toEqual([]);
  });
});
