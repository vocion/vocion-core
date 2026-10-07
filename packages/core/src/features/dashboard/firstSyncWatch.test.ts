import { describe, expect, it } from 'vitest';
import { FIRST_SYNC_NOT_SEEN, firstSyncNotice, firstSyncWatchAfter, firstSyncWatchAfterSave, newestSourceId, withoutStartedNotice, withStartedNoticeExpired } from './firstSyncWatch';

describe('the Connectors page after a save starts a first sync', () => {
  it('watches only a sync that started: a save that started nothing never polls the list', () => {
    expect(firstSyncWatchAfterSave('started')).toBe('waiting');
    expect(firstSyncWatchAfterSave('failed')).toBe('off');
    expect(firstSyncWatchAfterSave('not_a_syncing_connector')).toBe('off');
    expect(firstSyncWatchAfterSave(null)).toBe('off');
    expect(firstSyncWatchAfterSave(undefined)).toBe('off');
  });

  it('follows the saved source\'s run from appearing to finishing, and only then stops', () => {
    expect(firstSyncWatchAfter('waiting', null)).toBe('waiting');
    expect(firstSyncWatchAfter('waiting', 'running')).toBe('running');
    expect(firstSyncWatchAfter('running', 'running')).toBe('running');
    expect(firstSyncWatchAfter('running', 'failed')).toBe('off');
    expect(firstSyncWatchAfter('off', 'running')).toBe('off');
  });

  it('ends the watch on a first run that finished between two polls, instead of waiting two minutes for it', () => {
    expect(firstSyncWatchAfter('waiting', 'completed')).toBe('off');
    expect(firstSyncWatchAfter('waiting', 'failed')).toBe('off');
  });

  it('watches the source the save made, the newest on the list', () => {
    expect(newestSourceId([{ id: 4 }, { id: 11 }, { id: 9 }])).toBe(11);
    expect(newestSourceId([])).toBeNull();
  });

  it('takes the "started" notice down once the sync ends, so it never sits above a row that says the sync failed', () => {
    const started = firstSyncNotice('started');

    expect(withoutStartedNotice(started)).toBeNull();
  });

  it('leaves a Sync now result shown since then alone', () => {
    const syncNowResult = { message: 'Synced: 12 new, 0 updated.', hadErrors: false };

    expect(withoutStartedNotice(syncNowResult)).toBe(syncNowResult);
    expect(withStartedNoticeExpired(syncNowResult)).toBe(syncNowResult);
  });

  it('turns the "started" notice into a nudge when the run never appears', () => {
    expect(withStartedNoticeExpired(firstSyncNotice('started'))).toBe(FIRST_SYNC_NOT_SEEN);
  });

  it('says nothing for a save that does not sync', () => {
    expect(firstSyncNotice('not_a_syncing_connector')).toBeNull();
    expect(firstSyncNotice(null)).toBeNull();
    expect(firstSyncNotice('failed')?.hadErrors).toBe(true);
  });
});
