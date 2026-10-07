/**
 * Which schedules a source saved from the Connectors page or chat gets
 * (#1080). The rules someone could get wrong: a connector that does not sync
 * gets nothing, a workspace's sources do not all fire on the same minute, and
 * a connector's own nightly full pass is kept.
 */
import { describe, expect, it } from 'vitest';
import { newSourceSyncPlan } from './newSourceSync';

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
