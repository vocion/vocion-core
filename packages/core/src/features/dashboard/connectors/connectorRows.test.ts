import type { ConnectorTile, Source } from './connectorRows';
import { describe, expect, it } from 'vitest';
import { CONNECTOR_CATEGORIES } from '@/libs/sources/types';
import { buildConnections, catalogEntries, categoriesIn, filterCatalog, instanceLabel, offersReconnect, parseMissingScopes, relativeTime } from './connectorRows';

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

describe('buildConnections', () => {
  const tiles = [tile('web', 'Web', { authKind: 'none' }), tile('zoom', 'Zoom', { authKind: 'oauth' }), tile('hubspot', 'HubSpot'), tile('jira', 'Jira')];
  const done = (extra: Partial<NonNullable<Source['sync']>> = {}) => ({ status: 'completed' as const, startedAt: '', completedAt: '', error: null, counts: {}, ...extra });

  it('is one row per connection, the ones that need a person first, then A–Z', () => {
    const rows = buildConnections(tiles, [
      source('web-docs', 'web', { id: 1, authKind: 'none', sync: done() }),
      source('zoom', 'zoom', { id: 2, authKind: 'oauth', credentialBroken: 'expired', credentialConnected: false }),
      source('hubspot', 'hubspot', { id: 3, enabled: 'false' }),
      source('web-blog', 'web', { id: 4, authKind: 'none' }),
    ]);

    expect(rows.map(r => [r.source.slug, r.status])).toEqual([
      ['zoom', 'attention'],
      ['web-blog', 'working'],
      ['web-docs', 'working'],
      ['hubspot', 'paused'],
    ]);
  });

  it('words each problem plainly and gives it one fix', () => {
    const one = (extra: Partial<Source>) => buildConnections(tiles, [source('h', 'hubspot', extra)])[0]!;

    expect([one({ credentialBroken: 'revoked', credentialConnected: false }).problem, one({ credentialBroken: 'revoked', credentialConnected: false }).fix]).toEqual(['revoked', 'reconnect']);
    expect([one({ credentialBroken: 'expired', credentialConnected: false }).problem, one({ credentialBroken: 'expired' }).fix]).toEqual(['expired', 'reconnect']);
    expect([one({ credentialConnected: false }).problem, one({ credentialConnected: false }).fix]).toEqual(['not-connected', 'connect']);
    expect(one({ sync: done({ status: 'failed', error: ZOOM_ERROR }) }).problem).toBe('missing-permissions');
    expect([one({ sync: done({ status: 'failed', error: 'timeout' }) }).problem, one({ sync: done({ status: 'failed', error: 'timeout' }) }).fix]).toEqual(['sync-failed', 'reconnect']);
    expect([one({ sync: done({ status: 'abandoned' }) }).problem, one({ sync: done({ status: 'abandoned' }) }).fix]).toEqual(['sync-stopped', 'retry']);
    expect(one({ sync: done({ counts: { errors: 2 } }) }).problem).toBe('items-not-saved');
    expect([one({ sync: done() }).problem, one({ sync: done() }).fix]).toEqual([null, null]);
  });

  it('retries a failed crawl rather than offering a login it does not have', () => {
    const row = buildConnections(tiles, [source('w', 'web', { authKind: 'none', sync: done({ status: 'failed', error: '404' }) })])[0]!;

    expect([row.problem, row.fix]).toEqual(['sync-failed', 'retry']);
  });

  it('a paused connection reads Paused and offers no fix, whatever went wrong before', () => {
    const row = buildConnections(tiles, [source('h', 'hubspot', { enabled: 'false', credentialBroken: 'revoked' })])[0]!;

    expect([row.status, row.problem, row.fix]).toEqual(['paused', null, null]);
  });

  it('keeps a connection whose connector is no longer registered, rather than hiding its documents', () => {
    expect(buildConnections(tiles, [source('old', 'retired-crm')])[0]!.tile.name).toBe('retired-crm');
  });

  it('tells two connections of one connector apart by what they read, and leaves a single one alone', () => {
    const rows = buildConnections(tiles, [
      source('web-docs', 'web', { id: 1, authKind: 'none', config: { _connector: 'web', crawl: { startUrl: 'https://docs.northwind.example' } } }),
      source('web-blog', 'web', { id: 2, authKind: 'none', config: { _connector: 'web', urls: ['https://blog.northwind.example'] } }),
      source('jira', 'jira', { id: 3 }),
    ]);

    expect(rows.map(r => instanceLabel(r, rows))).toEqual([null, 'https://blog.northwind.example', 'Crawl https://docs.northwind.example · up to 50 pages']);
  });
});

describe('catalogEntries and filterCatalog', () => {
  const tiles = [
    tile('gmail', 'Gmail', { category: 'mail-calendar', authKind: 'oauth' }),
    tile('google-ads', 'Google Ads', { category: 'sales-marketing', description: 'Campaign spend.' }),
    tile('web', 'Web', { category: 'docs-files', authKind: 'none' }),
    tile('rest', 'REST API'),
  ];

  it('marks what is connected and what this server cannot connect, A–Z', () => {
    const entries = catalogEntries(tiles, [source('web', 'web')], { unavailable: ['gmail'], isAdmin: true });

    expect(entries.map(e => [e.tile.slug, e.connected, e.unavailable])).toEqual([
      ['gmail', false, true],
      ['google-ads', false, false],
      ['rest', false, false],
      ['web', true, false],
    ]);
  });

  it('hides a connector that cannot be connected from anyone who is not an admin', () => {
    expect(catalogEntries(tiles, [], { unavailable: ['gmail'], isAdmin: false }).map(e => e.tile.slug)).not.toContain('gmail');
  });

  it('filters by every word in any order, within a category when one is chosen', () => {
    const entries = catalogEntries(tiles, [], { unavailable: [], isAdmin: true });

    expect(filterCatalog(entries, 'ads google', null).map(e => e.tile.slug)).toEqual(['google-ads']);
    expect(filterCatalog(entries, '', 'docs-files').map(e => e.tile.slug)).toEqual(['web']);
    expect(filterCatalog(entries, '', 'other').map(e => e.tile.slug)).toEqual(['rest']);
    expect(filterCatalog(entries, 'gmail', 'docs-files')).toEqual([]);
  });

  it('offers only the categories that hold something, in the page order', () => {
    const entries = catalogEntries(tiles, [], { unavailable: [], isAdmin: true });

    expect(categoriesIn(entries, CONNECTOR_CATEGORIES)).toEqual(['mail-calendar', 'docs-files', 'sales-marketing', 'other']);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-09T12:00:00.000Z');

  it('is coarse, and in the page\'s language', () => {
    expect(relativeTime('2026-10-09T11:59:50.000Z', 'en', now)).toBe('now');
    expect(relativeTime('2026-10-09T10:00:00.000Z', 'en', now)).toBe('2 hours ago');
    expect(relativeTime('2026-10-06T12:00:00.000Z', 'en', now)).toBe('3 days ago');
    expect(relativeTime('2026-10-09T10:00:00.000Z', 'fr', now)).toBe('il y a 2 heures');
  });
});

describe('offersReconnect', () => {
  const FAILED = { status: 'failed' as const, startedAt: '', completedAt: null, error: 'HubSpot would not refresh the login (invalid_grant). An admin needs to log in with HubSpot again on the Connectors page.', counts: {} };

  it('offers Reconnect on a stored credential whose last sync failed, since Edit never runs a login again', () => {
    expect(offersReconnect(source('h', 'hubspot', { authKind: 'oauth', sync: FAILED }))).toBe(true);
  });

  it('always offers Reconnect on a connector that never syncs, since no failed run will ever say its login died', () => {
    expect(offersReconnect(source('a', 'apollo', { authKind: 'oauth', syncless: true }))).toBe(true);
    expect(offersReconnect(source('a', 'apollo', { authKind: 'oauth', syncless: true, credentialConnected: false }))).toBe(false);
  });

  it('leaves a revoked credential to Connect, so the row never shows both buttons', () => {
    expect(offersReconnect(source('h', 'hubspot', { credentialConnected: false, credentialBroken: 'revoked', sync: FAILED }))).toBe(false);
  });

  it('stays away from a healthy row, a row with nothing stored (Connect covers it), and a connector with no credential', () => {
    expect(offersReconnect(source('h', 'hubspot', { sync: { ...FAILED, status: 'completed', error: null } }))).toBe(false);
    expect(offersReconnect(source('h', 'hubspot', { credentialConnected: false, sync: FAILED }))).toBe(false);
    expect(offersReconnect(source('w', 'web', { authKind: 'none', sync: FAILED }))).toBe(false);
  });
});
