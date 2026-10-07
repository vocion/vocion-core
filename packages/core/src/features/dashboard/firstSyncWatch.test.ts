import { describe, expect, it } from 'vitest';
import { FIRST_SYNC_NOT_SEEN, firstSyncNotice, firstSyncWatchAfter, firstSyncWatchAfterSave, withoutStartedNotice, withStartedNoticeExpired } from './firstSyncWatch';

describe('the Connectors page after a save starts a first sync', () => {
  it('watches only a sync that started: a save that started nothing never polls the list', () => {
    expect(firstSyncWatchAfterSave('started')).toBe('waiting');
    expect(firstSyncWatchAfterSave('failed')).toBe('off');
    expect(firstSyncWatchAfterSave('not_a_syncing_connector')).toBe('off');
    expect(firstSyncWatchAfterSave(null)).toBe('off');
    expect(firstSyncWatchAfterSave(undefined)).toBe('off');
  });

  it('follows the run from appearing to finishing, and only then stops', () => {
    expect(firstSyncWatchAfter('waiting', false)).toBe('waiting');
    expect(firstSyncWatchAfter('waiting', true)).toBe('running');
    expect(firstSyncWatchAfter('running', true)).toBe('running');
    expect(firstSyncWatchAfter('running', false)).toBe('off');
    expect(firstSyncWatchAfter('off', true)).toBe('off');
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
