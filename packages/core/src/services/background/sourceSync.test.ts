import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSync, SyncAlreadyRunningError } from '@/services/SourceSyncService';
import { syncSourceActivity } from './sourceSync';

const state = vi.hoisted(() => ({ row: null as null | { slug: string; config: Record<string, unknown>; lastSyncedAt: Date | null }, connected: false, paused: false }));

vi.mock('@/services/SourceSyncService', () => ({
  runSync: vi.fn(),
  isSourcePaused: vi.fn(async () => state.paused),
  SyncAlreadyRunningError: class SyncAlreadyRunningError extends Error {
    constructor(sourceId: number) {
      super(`Source ${sourceId} is already syncing`);
      this.name = 'SyncAlreadyRunningError';
    }
  },
}));

vi.mock('@/libs/DB', () => ({ db: { select: () => ({ from: () => ({ where: async () => (state.row ? [state.row] : []) }) }) } }));
vi.mock('@/libs/sources/registry', () => ({ listConnectors: () => [{ slug: 'github', authKind: 'oauth' }, { slug: 'web', authKind: 'none' }] }));
vi.mock('@/services/SourceCredentialService', () => ({ credentialStatusForOrg: async () => ({ bySourceId: {}, byConnectorSlug: { github: { connected: state.connected, updatedAt: null, broken: null } } }) }));

const mockRunSync = vi.mocked(runSync);

beforeEach(() => {
  vi.clearAllMocks();
  state.row = null;
  state.connected = false;
  state.paused = false;
});

describe('syncSourceActivity', () => {
  it('skips a paused connection quietly, without reading it', async () => {
    state.paused = true;

    const out = await syncSourceActivity({ orgId: 'org1', sourceId: 7 });

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(out).toMatchObject({ skipped: true, firstError: 'paused' });
  });

  it('drives runSync incrementally by default and returns the result', async () => {
    mockRunSync.mockResolvedValue({ sourceId: 7, created: 2, updated: 1, unchanged: 5, metadataRefreshed: 0, tombstoned: 0, errors: 0, firstError: null, firstProcessorError: null });

    const out = await syncSourceActivity({ orgId: 'org1', sourceId: 7 });

    expect(mockRunSync).toHaveBeenCalledWith({ orgId: 'org1', sourceId: 7, incremental: true });
    expect(out).toMatchObject({ created: 2, updated: 1, unchanged: 5 });
  });

  it('honors incremental=false (full sync) when asked', async () => {
    mockRunSync.mockResolvedValue({ sourceId: 7, created: 0, updated: 0, unchanged: 0, metadataRefreshed: 0, tombstoned: 3, errors: 0, firstError: null, firstProcessorError: null });

    await syncSourceActivity({ orgId: 'org1', sourceId: 7, incremental: false });

    expect(mockRunSync).toHaveBeenCalledWith({ orgId: 'org1', sourceId: 7, incremental: false });
  });

  it('reports a skip instead of throwing when another run already holds the source', async () => {
    mockRunSync.mockRejectedValue(new SyncAlreadyRunningError(7));

    const out = await syncSourceActivity({ orgId: 'org1', sourceId: 7 });

    // A throw here would make the workflow retry twice and then fail the run,
    // which reads as a broken schedule rather than as an overlap.
    expect(out).toEqual({
      sourceId: 7,
      created: 0,
      updated: 0,
      unchanged: 0,
      metadataRefreshed: 0,
      tombstoned: 0,
      errors: 0,
      firstError: null,
      firstProcessorError: null,
      skipped: true,
    });
  });

  it('still propagates a genuine sync failure', async () => {
    mockRunSync.mockRejectedValue(new Error('connector exploded'));

    await expect(syncSourceActivity({ orgId: 'org1', sourceId: 7 })).rejects.toThrow('connector exploded');
  });

  it('skips a source that has never synced and has nothing connected, without running or throwing', async () => {
    state.row = { slug: 'github', config: {}, lastSyncedAt: null };

    const out = await syncSourceActivity({ orgId: 'org1', sourceId: 9 });

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sourceId: 9, skipped: true, firstError: 'not connected' });
  });

  it('runs once the connector is connected, and always runs a source that synced before', async () => {
    mockRunSync.mockResolvedValue({ sourceId: 9, created: 0, updated: 0, unchanged: 0, metadataRefreshed: 0, tombstoned: 0, errors: 0, firstError: null, firstProcessorError: null });
    state.row = { slug: 'github', config: {}, lastSyncedAt: null };
    state.connected = true;
    await syncSourceActivity({ orgId: 'org1', sourceId: 9 });

    state.connected = false;
    state.row = { slug: 'github', config: {}, lastSyncedAt: new Date('2026-09-01T00:00:00Z') };
    await syncSourceActivity({ orgId: 'org1', sourceId: 9 });

    expect(mockRunSync).toHaveBeenCalledTimes(2);
  });
});
