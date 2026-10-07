import { describe, expect, it } from 'vitest';
import { FIRST_SYNC_NOT_SEEN, firstSyncNotice, firstSyncRunOf, firstSyncWatchAfter, firstSyncWatchAfterSave, withoutStartedNotice, withStartedNoticeExpired } from './firstSyncWatch';

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

  it('reads only the saved source\'s run, so another source\'s run ending says nothing about it', () => {
    const list = [{ id: 4, sync: { status: 'completed' } }, { id: 11, sync: null }];

    expect(firstSyncRunOf(list, 11)).toBeNull();
    expect(firstSyncWatchAfter('waiting', firstSyncRunOf(list, 11))).toBe('waiting');
  });

  it('ends the watch when the saved source is deleted mid-sync, so the notice does not stay forever', () => {
    const list = [{ id: 4, sync: { status: 'completed' } }];

    expect(firstSyncWatchAfter('running', firstSyncRunOf(list, 11))).toBe('off');
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
