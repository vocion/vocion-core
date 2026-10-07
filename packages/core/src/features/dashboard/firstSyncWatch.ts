/**
 * What the Connectors page says and watches after a save starts a source's
 * first sync (#1080). Pure, so the rules are tested without a browser.
 *
 * The save answers before the sync's run exists, so the page polls until the
 * run shows up, follows it while it runs, and then takes its own "started"
 * notice down, because the row now says how the sync ended. A run that never
 * shows up gets a different notice after two minutes instead of a promise
 * that stays on screen.
 */

/** A line above the list, after a save or a Sync now. */
export type SyncOutcome = { message: string; hadErrors: boolean };

/**
 * Where the page is in following a just-saved source's first sync:
 * `waiting` for its run to appear, `running` while it does, `off` otherwise.
 */
export type FirstSyncWatch = 'off' | 'waiting' | 'running';

export const FIRST_SYNC_STARTED_MESSAGE = 'Saved. Its first sync has started, and its documents will show up on its row as it reads them.';

const FIRST_SYNC_FAILED: SyncOutcome = { message: 'Saved, but its first sync could not start. Press Sync now on its row to try again.', hadErrors: true };

/** The notice once two minutes pass and the first sync's run never appeared. */
export const FIRST_SYNC_NOT_SEEN: SyncOutcome = { message: 'Saved, but its first sync has not shown up yet. Press Sync now on its row to start it.', hadErrors: true };

/**
 * What the page says right after a save about the source's first sync, from
 * what the save reported. Null when there is nothing to say: a connector that
 * does not sync, or a save that does not report it.
 * @param firstSync - The save's `firstSync`.
 */
export function firstSyncNotice(firstSync: string | null | undefined): SyncOutcome | null {
  if (firstSync === 'started') {
    return { message: FIRST_SYNC_STARTED_MESSAGE, hadErrors: false };
  }
  if (firstSync === 'failed') {
    return FIRST_SYNC_FAILED;
  }
  return null;
}

/**
 * Whether to watch for the first sync after a save: only when it started, so
 * a save that started nothing never polls the list for two minutes.
 * @param firstSync - The save's `firstSync`.
 */
export function firstSyncWatchAfterSave(firstSync: string | null | undefined): FirstSyncWatch {
  return firstSync === 'started' ? 'waiting' : 'off';
}

/**
 * The next step of the watch, from whether a run is in progress on the page.
 * @param watch - Where the watch is.
 * @param someoneIsSyncing - Whether any row shows a running sync.
 */
export function firstSyncWatchAfter(watch: FirstSyncWatch, someoneIsSyncing: boolean): FirstSyncWatch {
  if (watch === 'waiting' && someoneIsSyncing) {
    return 'running';
  }
  if (watch === 'running' && !someoneIsSyncing) {
    return 'off';
  }
  return watch;
}

/**
 * The notice to show once the first sync has finished: the "started" notice
 * comes down, and anything else (a Sync now result shown since) stays.
 * @param outcome - The notice on screen.
 */
export function withoutStartedNotice(outcome: SyncOutcome | null): SyncOutcome | null {
  return outcome?.message === FIRST_SYNC_STARTED_MESSAGE ? null : outcome;
}

/**
 * The notice to show when the first sync's run never appeared: the "started"
 * notice becomes a nudge to start it, and anything else stays.
 * @param outcome - The notice on screen.
 */
export function withStartedNoticeExpired(outcome: SyncOutcome | null): SyncOutcome | null {
  return outcome?.message === FIRST_SYNC_STARTED_MESSAGE ? FIRST_SYNC_NOT_SEEN : outcome;
}
