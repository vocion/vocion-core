/**
 * IS IT STILL HAPPENING? — said in facts before anyone acts on an error
 * (2026-10-01: asked "what was the error at 14:45 and which deploy caused
 * it", the PM read Sentry right, then filed a P1, queued an incident card and
 * drafted a P1 alert for an outage a revert had fixed at 16:14; Sentry's last
 * event was 15:47). The tool that reads an issue hands its reader when it was
 * last seen against now, how long it has been quiet, and the releases that
 * went out since — the fix, often — so "fixed already" is a fact on the page,
 * not something a model has to notice.
 *
 * Quiet for an hour is how the watch resolves an incident (`services/jobs/errorWatch.ts`).
 * Pure.
 */

/** How long an issue goes without an event before it reads as stopped — the watch's own hour. */
export const QUIET_AFTER_MS = 60 * 60_000;

export type StillHappening = {
  /** `ongoing`: an event within the hour and not resolved; `stopped`: quiet an hour or more, or resolved in the tracker; `unknown`: no last-seen time. */
  state: 'ongoing' | 'stopped' | 'unknown';
  now: string;
  lastSeen: string | null;
  /** Minutes since the last event. */
  quietMinutes: number | null;
  /** Releases created after the last event, oldest first — what may have fixed it. */
  releasesSince: Array<{ version: string; createdAt: string | null }>;
  /** One line a reader can act on. */
  line: string;
};

/**
 * Whether an issue is still happening, from its last event, its status and the releases since.
 * @param issue - The issue as the tracker has it.
 * @param issue.lastSeen - Its last event.
 * @param issue.status - The tracker's status (`resolved`, `unresolved`, `ignored`).
 * @param releases - The project's releases, any order.
 * @param now - The clock.
 */
export function stillHappening(issue: { lastSeen: string | null; status: string | null }, releases: ReadonlyArray<{ version: string; createdAt: string | null }>, now: Date): StillHappening {
  const last = issue.lastSeen ? Date.parse(issue.lastSeen) : Number.NaN;
  if (!Number.isFinite(last)) {
    return { state: 'unknown', now: now.toISOString(), lastSeen: issue.lastSeen, quietMinutes: null, releasesSince: [], line: 'The tracker gives no last-seen time, so whether it is still happening is not known; count its events over the last hour before acting.' };
  }
  const quietMinutes = Math.max(0, Math.round((now.getTime() - last) / 60_000));
  const since = releases
    .filter(r => r.createdAt && Date.parse(r.createdAt) > last)
    .sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!));
  const stopped = issue.status === 'resolved' || now.getTime() - last >= QUIET_AFTER_MS;
  const quiet = quietMinutes >= 120 ? `${Math.floor(quietMinutes / 60)}h ${quietMinutes % 60}m` : `${quietMinutes}m`;
  const after = since.length > 0 ? ` ${since.length} release${since.length === 1 ? '' : 's'} went out since (${since.slice(0, 3).map(r => r.version.slice(0, 12)).join(', ')}).` : '';
  return {
    state: stopped ? 'stopped' : 'ongoing',
    now: now.toISOString(),
    lastSeen: issue.lastSeen,
    quietMinutes,
    releasesSince: since,
    line: stopped
      ? `Not happening now: the last event was ${quiet} ago${issue.status === 'resolved' ? ' and the tracker marks it resolved' : ''}.${after} Report what it was and what fixed it; open nothing urgent for it.`
      : `Still happening: the last event was ${quiet} ago.${after}`,
  };
}
