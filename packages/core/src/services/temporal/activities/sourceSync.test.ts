import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSync, SyncAlreadyRunningError } from '@/services/SourceSyncService';
import { syncSourceActivity } from './sourceSync';

vi.mock('@/services/SourceSyncService', () => ({
  runSync: vi.fn(),
  SyncAlreadyRunningError: class SyncAlreadyRunningError extends Error {
    constructor(sourceId: number) {
      super(`Source ${sourceId} is already syncing`);
      this.name = 'SyncAlreadyRunningError';
    }
  },
}));

const mockRunSync = vi.mocked(runSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncSourceActivity', () => {
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
});
