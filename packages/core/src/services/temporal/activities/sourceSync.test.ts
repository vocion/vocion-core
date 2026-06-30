import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSync } from '@/services/SourceSyncService';
import { syncSourceActivity } from './sourceSync';

vi.mock('@/services/SourceSyncService', () => ({
  runSync: vi.fn(),
}));

const mockRunSync = vi.mocked(runSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncSourceActivity', () => {
  it('drives runSync incrementally by default and returns the result', async () => {
    mockRunSync.mockResolvedValue({ sourceId: 7, created: 2, updated: 1, unchanged: 5, tombstoned: 0, errors: 0 });

    const out = await syncSourceActivity({ orgId: 'org1', sourceId: 7 });

    expect(mockRunSync).toHaveBeenCalledWith({ orgId: 'org1', sourceId: 7, incremental: true });
    expect(out).toMatchObject({ created: 2, updated: 1, unchanged: 5 });
  });

  it('honors incremental=false (full sync) when asked', async () => {
    mockRunSync.mockResolvedValue({ sourceId: 7, created: 0, updated: 0, unchanged: 0, tombstoned: 3, errors: 0 });

    await syncSourceActivity({ orgId: 'org1', sourceId: 7, incremental: false });

    expect(mockRunSync).toHaveBeenCalledWith({ orgId: 'org1', sourceId: 7, incremental: false });
  });
});
