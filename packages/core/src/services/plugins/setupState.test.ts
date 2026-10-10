/**
 * Setup state — a plugin that is on and declares `setup:` is judged by what
 * exists: a live credential per connector, at least one active record per
 * type. Plugins that declare nothing never appear; one with every step done
 * is listed complete so the chip can go away.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: [] as string[],
  plugins: [] as Array<{ manifest: { slug: string; name: string; setup: { connectors: string[]; records: string[] } } }>,
  credentials: { byConnectorSlug: {} as Record<string, { connected: boolean }>, bySourceId: {} as Record<number, { connected: boolean }> },
  sources: [] as Array<{ id: number; slug: string; kind: string | null; config: Record<string, unknown> }>,
  counts: {} as Record<string, number>,
}));

vi.mock('@/libs/workspace/plugins', () => ({ listPlugins: () => state.plugins }));
vi.mock('@/services/PluginService', () => ({ enabledPluginsForOrg: async () => state.enabled }));
vi.mock('@/services/SourceCredentialService', () => ({ credentialStatusForOrg: async () => state.credentials }));
vi.mock('@/services/SourceSyncService', () => ({ listSources: async () => state.sources }));
vi.mock('@/services/objects/recordCounts', () => ({ countActiveRecordsByType: async () => state.counts }));

const { setupStateForOrg } = await import('./setupState');

const factory = { manifest: { slug: 'factory', name: 'Software factory', setup: { connectors: ['github'], records: ['product', 'repo'] } } };
const wiki = { manifest: { slug: 'wiki', name: 'Wiki', setup: { connectors: [], records: [] } } };

describe('setupStateForOrg', () => {
  beforeEach(() => {
    state.enabled = ['factory', 'wiki'];
    state.plugins = [factory, wiki];
    state.credentials = { byConnectorSlug: {}, bySourceId: {} };
    state.sources = [{ id: 1, slug: 'github', kind: 'github', config: {} }];
    state.counts = {};
  });

  it('lists only plugins that are on and declare setup, with every step undone on a fresh workspace', async () => {
    const out = await setupStateForOrg('org-1');

    expect(out.map(p => p.plugin)).toEqual(['factory']);
    expect(out[0]!.complete).toBe(false);
    expect(out[0]!.steps.map(s => [s.key, s.done])).toEqual([
      ['connector:github', false],
      ['records:product', false],
      ['records:repo', false],
    ]);
    expect(out[0]!.steps[0]).toMatchObject({ kind: 'connector', slug: 'github', sources: ['github'] });
  });

  it('is complete once the connector has a live credential and every record type has a record', async () => {
    state.credentials = { byConnectorSlug: { github: { connected: true } }, bySourceId: {} };
    state.counts = { product: 1, repo: 4 };

    const [out] = await setupStateForOrg('org-1');

    expect(out!.complete).toBe(true);
    expect(out!.steps.every(s => s.done)).toBe(true);
  });

  it('counts a credential linked to a source of the connector, not only one on the install', async () => {
    state.sources = [{ id: 7, slug: 'code', kind: 'github', config: { _connector: 'github' } }];
    state.credentials = { byConnectorSlug: {}, bySourceId: { 7: { connected: true } } };

    const [out] = await setupStateForOrg('org-1');

    expect(out!.steps[0]).toMatchObject({ key: 'connector:github', done: true, sources: ['code'] });
  });

  it('says when the workspace declares no source of the connector at all', async () => {
    state.sources = [];

    const [out] = await setupStateForOrg('org-1');

    expect(out!.steps[0]).toMatchObject({ done: false, sources: [] });
  });

  it('ignores a plugin that is shipped but not on', async () => {
    state.enabled = ['wiki'];

    expect(await setupStateForOrg('org-1')).toEqual([]);
  });

  describe('a family step', () => {
    const finance = { manifest: { slug: 'finance', name: 'Finance', setup: { connectors: ['finance'], records: [] } } };

    beforeEach(() => {
      state.enabled = ['finance'];
      state.plugins = [finance];
    });

    it('names the finance system, not a vendor, while the workspace declares no source of the family', async () => {
      state.sources = [];

      const [out] = await setupStateForOrg('org-1');

      expect(out!.steps[0]).toMatchObject({ key: 'connector:finance', slug: 'finance', family: 'finance', label: 'Connect your finance system', done: false, sources: [] });
      expect(out!.steps[0]!.options).toContain('quickbooks');
    });

    it('points at the vendor the workspace declares a source for', async () => {
      state.sources = [{ id: 7, slug: 'quickbooks', kind: 'quickbooks', config: {} }];

      const [out] = await setupStateForOrg('org-1');

      expect(out!.steps[0]).toMatchObject({ slug: 'quickbooks', label: 'Connect QuickBooks Online', done: false, sources: ['quickbooks'] });
    });

    it('is done by any connector of the family', async () => {
      state.sources = [{ id: 7, slug: 'quickbooks', kind: 'quickbooks', config: {} }];
      state.credentials = { byConnectorSlug: { netsuite: { connected: true } }, bySourceId: {} };

      const [out] = await setupStateForOrg('org-1');

      expect(out!.steps[0]).toMatchObject({ slug: 'netsuite', done: true });
      expect(out!.complete).toBe(true);
    });
  });
});
