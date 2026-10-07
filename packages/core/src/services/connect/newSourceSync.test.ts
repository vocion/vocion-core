/**
 * Which schedules a source saved from the Connectors page or chat gets
 * (#1080). The rules someone could get wrong: a connector that does not sync
 * gets nothing, a workspace's sources do not all fire on the same minute, and
 * a connector's own nightly full pass is kept, and a scheduler that hangs
 * cannot hold a save open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// The scheduler is the boundary here: these tests check what is asked of it, and never run a sync.
vi.mock('@/services/SourceScheduleService', () => ({
  ensureSourceSchedule: vi.fn(),
  ensureSourceReconcileSchedule: vi.fn(),
  startSourceFullSync: vi.fn(),
}));

const { ensureSourceReconcileSchedule, ensureSourceSchedule, startSourceFullSync } = await import('@/services/SourceScheduleService');
const { newSourceSyncPlan, startSourceSyncing } = await import('./newSourceSync');

describe('newSourceSyncPlan', () => {
  it('syncs a GitHub source hourly, on a minute taken from its id, with no nightly full pass', () => {
    expect(newSourceSyncPlan('github', 125)).toEqual({ incrementalCron: '5 * * * *', reconcileCron: null });
  });

  it('spreads two sources of one workspace over different minutes', () => {
    const first = newSourceSyncPlan('github', 7)!;
    const second = newSourceSyncPlan('github', 8)!;

    expect(first.incrementalCron).not.toBe(second.incrementalCron);
  });

  it('keeps the nightly full pass a connector declares, so deletions upstream are still pruned', () => {
    expect(newSourceSyncPlan('notion', 3)?.reconcileCron).toBe('0 4 * * *');
    expect(newSourceSyncPlan('jira', 3)?.reconcileCron).toBe('0 3 * * *');
  });

  it('gives a connector that does not sync no schedule at all', () => {
    expect(newSourceSyncPlan('apollo', 3)).toBeNull();
  });

  it('gives an unknown connector no schedule instead of throwing', () => {
    expect(newSourceSyncPlan('not-a-connector', 3)).toBeNull();
  });
});

describe('startSourceSyncing', () => {
  const notionSource = { orgId: 'org_sync_start', sourceId: 61, sourceSlug: 'notion', connectorSlug: 'notion' };

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(ensureSourceSchedule).mockReset();
    vi.mocked(ensureSourceReconcileSchedule).mockReset();
    vi.mocked(startSourceFullSync).mockReset();
  });

  it('schedules Notion hourly and nightly, then starts its full sync', async () => {
    expect(await startSourceSyncing(notionSource)).toBe('started');
    expect(ensureSourceSchedule).toHaveBeenCalledWith({ orgId: 'org_sync_start', sourceId: 61, sourceSlug: 'notion', cron: '1 * * * *' });
    expect(ensureSourceReconcileSchedule).toHaveBeenCalledWith({ orgId: 'org_sync_start', sourceId: 61, sourceSlug: 'notion', cron: '0 4 * * *' });
    expect(startSourceFullSync).toHaveBeenCalledWith({ orgId: 'org_sync_start', sourceId: 61, sourceSlug: 'notion' });
  });

  it('asks nothing of the scheduler for a connector that does not sync', async () => {
    expect(await startSourceSyncing({ ...notionSource, connectorSlug: 'apollo' })).toBe('not_a_syncing_connector');
    expect(ensureSourceSchedule).not.toHaveBeenCalled();
    expect(startSourceFullSync).not.toHaveBeenCalled();
  });

  it('gives up on a scheduler that never answers after five seconds, reports failed, and never asks for the sync', async () => {
    vi.useFakeTimers();
    vi.mocked(ensureSourceSchedule).mockReturnValueOnce(new Promise<void>(() => {}));
    const outcome = startSourceSyncing(notionSource);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome).toBe('failed');
    expect(startSourceFullSync).not.toHaveBeenCalled();
  });

  it('a scheduler that answers after the save said failed starts no sync behind it, so the page stays right', async () => {
    vi.useFakeTimers();
    vi.mocked(ensureSourceSchedule).mockReturnValueOnce(new Promise<void>(resolve => setTimeout(resolve, 6_000)));
    const outcome = startSourceSyncing(notionSource);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome).toBe('failed');

    await vi.advanceTimersByTimeAsync(2_000);

    expect(ensureSourceReconcileSchedule).not.toHaveBeenCalled();
    expect(startSourceFullSync).not.toHaveBeenCalled();
  });
});
