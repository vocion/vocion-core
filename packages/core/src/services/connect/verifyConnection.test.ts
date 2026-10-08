/**
 * Verifying a connection before the walk moves on: the connector's own test
 * call against the stored credential, then the first sync's count in the
 * connector's own noun ("Found 1,284 deals"). Read for one workspace only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sources = vi.fn();
const runs = vi.fn();
const counts = vi.fn();
vi.mock('@/services/SourceSyncService', () => ({
  listSources: (orgId: string) => sources(orgId),
  latestSyncStateForOrg: (orgId: string) => runs(orgId),
  documentCountsForOrg: (orgId: string) => counts(orgId),
}));
let live = true;
vi.mock('./createSourceOnLogin', () => ({ connectorHasLiveSource: vi.fn(async () => live) }));
vi.mock('@/services/SourceCredentialService', () => ({ storedCredentialIdForSource: vi.fn(async () => 'tok_1'), getCredentialsForConnector: vi.fn(async () => ({ apiKey: 'vaulted' })) }));
vi.mock('@/libs/connect/scripted', () => ({ scriptedVerification: vi.fn(() => null) }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const { verifyConnection } = await import('./verifyConnection');
const { scriptedVerification } = await import('@/libs/connect/scripted');

const ORG = 'proj-vc-northwind';
const created = new Date('2026-10-08T10:00:00Z');

beforeEach(() => {
  live = true;
  vi.mocked(scriptedVerification).mockReturnValue(null);
  sources.mockResolvedValue([{ id: 9, slug: 'hubspot', kind: 'hubspot', config: { objectType: 'deals' }, createdAt: created }]);
  runs.mockResolvedValue({ 9: { status: 'completed' } });
  counts.mockResolvedValue({ 9: 1284 });
});

describe('verifyConnection', () => {
  it('counts the first sync in the noun the connector declares', async () => {
    await expect(verifyConnection(ORG, 'hubspot')).resolves.toEqual({ state: 'verified', preview: 'Found 1,284 deals', checks: [] });
    expect(sources).toHaveBeenCalledWith(ORG);
    expect(runs).toHaveBeenCalledWith(ORG);
  });

  it('answers reading, with the count so far, while the first sync runs', async () => {
    runs.mockResolvedValue({ 9: { status: 'running' } });
    counts.mockResolvedValue({ 9: 40 });

    await expect(verifyConnection(ORG, 'hubspot')).resolves.toEqual({ state: 'reading', preview: 'Found 40 deals' });
  });

  it('fails with the run\'s own reason, and when the login is no longer live', async () => {
    runs.mockResolvedValue({ 9: { status: 'failed', error: 'HubSpot refused the token.' } });

    await expect(verifyConnection(ORG, 'hubspot')).resolves.toEqual({ state: 'failed', reason: 'HubSpot refused the token.' });

    live = false;

    await expect(verifyConnection(ORG, 'hubspot')).resolves.toMatchObject({ state: 'failed' });
  });

  it('says so when the connector has no source here yet', async () => {
    sources.mockResolvedValue([]);

    await expect(verifyConnection(ORG, 'hubspot')).resolves.toMatchObject({ state: 'missing' });
  });

  it('plays the script\'s answer when one names the connector', async () => {
    vi.mocked(scriptedVerification).mockReturnValue({ ok: true, count: 7, checks: ['Token accepted'] });

    await expect(verifyConnection(ORG, 'hubspot')).resolves.toEqual({ state: 'verified', preview: 'Found 7 deals', checks: ['Token accepted'] });
  });
});
