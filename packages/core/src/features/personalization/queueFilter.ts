import type { BriefRow } from './PersonalizationQueue';
/**
 * What the personalization queue shows, as pure functions, so the queue and
 * the bulk actions view (Metacto ticket 071) agree to the row on "the leads
 * you are looking at". Lane, search and the briefed-window chips live in the
 * URL (`useListUrlState`); this module reads that state and applies it.
 */
import type { ListStateConfig } from '@/components/patterns';

/**
 * Lane order is the review order: what needs you, then what you did with it.
 * There is no lane for unbriefed leads because there is no such row on this
 * page.
 */
export const QUEUE_LANES = [
  { key: 'ready_for_review', label: 'Review' },
  { key: 'handed_off', label: 'Hand off' },
  { key: 'held', label: 'Held' },
  { key: 'sent', label: 'Sent' },
  { key: 'all', label: 'All' },
] as const;

/**
 * Arrival order is the default and the first option. Confidence sorts a row
 * with no score (a lead that ran out of tries) to the bottom rather than
 * dropping it, because that row is the one most worth reading.
 */
export const QUEUE_SORTS = [
  { key: 'arrived', label: 'Arrived' },
  { key: 'briefed', label: 'Briefed' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'name', label: 'Name' },
] as const;

/**
 * When the brief was written, as a filter. A reviewer working through the
 * cards drafted before a rule changed (the voice gate on 2026-09-19, the
 * sequence ladder on 2026-09-13) needs to find "the old ones" in one move;
 * a sort alone makes them scroll to the end and guess where the line is
 * (Valerie, 2026-09-23). Chips, because a reviewer may want two windows at
 * once ("this week and today"), and kept in the URL with the lane and sort.
 */
export const BRIEFED_WINDOWS = [
  { key: 'today', label: 'Briefed today' },
  { key: 'week', label: 'Briefed this week' },
  { key: 'earlier', label: 'Briefed earlier' },
] as const;
export type BriefedWindow = (typeof BRIEFED_WINDOWS)[number]['key'];

/**
 * A lead whose last attempt failed: a regenerate that did not land, a draft
 * or a brief that errored (Valerie, 2026-09-24: "a way in the personalization
 * queue to filter for errors so that I can regenerate them in bulk"). A chip
 * beside the briefed windows so it rides the same URL parameter to the bulk
 * page, but it narrows rather than widens: the windows are OR'd together,
 * and this one is AND'd with them.
 */
export const ERROR_CHIP = { key: 'errored', label: 'Has an error' } as const;

/** The page opens where the work is; the clean URL means this state. */
export const QUEUE_LIST: ListStateConfig = {
  defaults: { tab: 'ready_for_review', q: '', sort: 'arrived', dir: 'desc' as const, chips: [] },
  tabs: QUEUE_LANES.map(l => l.key),
  sorts: QUEUE_SORTS.map(s => s.key),
  chips: [...BRIEFED_WINDOWS.map(w => w.key), ERROR_CHIP.key],
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which window a brief falls in, by its age at `now`. Null for a row with no
 * brief timestamp, which no window claims.
 * @param briefedAt - ISO timestamp, or null.
 * @param now - The moment the list was rendered, in ms.
 */
export function briefedWindowOf(briefedAt: string | null, now: number): BriefedWindow | null {
  if (!briefedAt) {
    return null;
  }
  const t = new Date(briefedAt).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  const age = now - t;
  if (age < DAY_MS) {
    return 'today';
  }
  if (age < 7 * DAY_MS) {
    return 'week';
  }
  return 'earlier';
}

export type QueueView = { lane: string; q: string; chips: readonly string[] };

/**
 * The rows the queue shows for a view: lane, then search, then the briefed
 * windows. Unbriefed leads are never on this page and are dropped first.
 * @param rows - Every brief row the page loaded.
 * @param view - Lane, search and chips, as the URL carries them.
 * @param now - The moment to bucket the briefed windows against.
 */
export function filterQueueRows(rows: readonly BriefRow[], view: QueueView, now: number): BriefRow[] {
  const q = view.q.trim().toLowerCase();
  const inLane = rows
    .filter(b => b.status !== 'queued')
    .filter(b => view.lane === 'all' || b.status === view.lane)
    .filter(b => !q
      || b.contactName.toLowerCase().includes(q)
      || (b.companyName ?? '').toLowerCase().includes(q));
  const errored = view.chips.includes(ERROR_CHIP.key) ? inLane.filter(b => Boolean(b.lastError)) : inLane;
  const windows = view.chips.filter(c => c !== ERROR_CHIP.key);
  if (windows.length === 0) {
    return errored;
  }
  return errored.filter((b) => {
    const w = briefedWindowOf(b.briefedAt, now);
    return w !== null && windows.includes(w);
  });
}

/**
 * `filterQueueRows` against the clock, for a server page that has no clock of
 * its own to pass (a component may not read one during render).
 * @param rows
 * @param view
 */
export function filterQueueRowsNow(rows: readonly BriefRow[], view: QueueView): BriefRow[] {
  return filterQueueRows(rows, view, Date.now());
}

/**
 * The view in words, for the bulk page's heading: "Review · briefed earlier ·
 * matching “acme”".
 * @param view
 */
export function describeQueueView(view: QueueView): string {
  const lane = QUEUE_LANES.find(l => l.key === view.lane)?.label ?? view.lane;
  const parts = [lane];
  const windows = BRIEFED_WINDOWS.filter(w => view.chips.includes(w.key)).map(w => w.label.toLowerCase());
  if (windows.length > 0) {
    parts.push(windows.join(' or '));
  }
  if (view.chips.includes(ERROR_CHIP.key)) {
    parts.push('with an error');
  }
  if (view.q.trim()) {
    parts.push(`matching “${view.q.trim()}”`);
  }
  return parts.join(' · ');
}

/** A filter value meaning "leads with no value here" (no recommendation, no lead magnet). */
export const BULK_NONE = '__none';

/**
 * What the bulk actions page filters on (Metacto ticket 076): the queue's
 * lane, search and briefed windows, plus the recommended sequence, the lead
 * magnet, and a "briefed before" moment. `rung` and `magnet` are an exact
 * value, `BULK_NONE`, or '' for any. `before` is an ISO timestamp or ''.
 */
export type BulkFilter = QueueView & { rung: string; magnet: string; before: string };

/**
 * The rows the bulk page shows for a filter. Lane, search and windows are the
 * queue's own rule, so a view opened from the queue shows the same rows.
 * @param rows - Every brief row the page loaded.
 * @param filter - The page's filters.
 * @param now - The moment to bucket the briefed windows against.
 */
export function filterBulkRows(rows: readonly BriefRow[], filter: BulkFilter, now: number): BriefRow[] {
  const before = filter.before ? new Date(filter.before).getTime() : Number.NaN;
  const matches = (value: string | null | undefined, want: string) => want === '' || (want === BULK_NONE ? !value : value === want);
  return filterQueueRows(rows, filter, now)
    .filter(r => matches(r.recommendedSequence, filter.rung))
    .filter(r => matches(r.utmContent, filter.magnet))
    .filter((r) => {
      if (Number.isNaN(before)) {
        return true;
      }
      const t = r.briefedAt ? new Date(r.briefedAt).getTime() : Number.NaN;
      return !Number.isNaN(t) && t < before;
    });
}

/**
 * The distinct values a column holds across the loaded rows, sorted, for a
 * filter's options. Empty values are left out; `BULK_NONE` stands for them.
 * @param rows - Every brief row the page loaded.
 * @param pick - The column to read.
 */
export function distinctValues(rows: readonly BriefRow[], pick: (r: BriefRow) => string | null | undefined): string[] {
  return [...new Set(rows.map(pick).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}

/** The server's clock, for a page that must hand the view a `now` (a component may not read one during render). */
export function queueNow(): number {
  return Date.now();
}
