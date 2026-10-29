/**
 * THE APP FRONT — what an app's Chat page leads with before anything is said:
 * the attention entry ("What needs my attention today?", opening on real
 * counts of what waits on a person from this app's agents) and the app's
 * briefing in compact form (Chris, 2026-10-29: "maybe that's enough? should
 * we push that forward more?" — yes, first thing on the page).
 *
 * Everything here is pure and computed from state that already exists — the
 * briefing rows, the open Review items, the automation run log — so the page
 * pays no model call to draw it. The server loader is
 * `services/chat/appFront.ts`; the block is `features/dashboard/chat/AppFront.tsx`.
 *
 * Reduction (`docs/design/reduction.md`): no briefing means no briefing
 * block, no waiting items means no counts, and neither means no front at all.
 */

import type { BriefingV2 } from '@/services/briefings/document';
import { briefingHref } from '@/services/briefings/links';

/** One count on the attention line: how many of one kind of item wait, and where they are. */
export type AttentionCount = { key: string; label: string; count: number; href: string };

/** The app's briefing as the front draws it. */
export type FrontBriefing = {
  id: number;
  title: string;
  href: string;
  /** True when it was published on the workspace's today. */
  today: boolean;
  /** When it was published (ISO), drawn as its day in the person's locale. */
  publishedAt: string;
  /** The workspace's zone: the day a brief is from is the workspace's day. */
  timeZone: string;
  /** The brief's own one-line read (`today.summary`), when it wrote one. */
  headline: string | null;
  /** "Needs your decision": the decisions it put in front of a person. */
  decisions: number;
  /** The top moves, at most three, in the brief's order. */
  moves: string[];
  /** Today's run of the job that writes this brief failed: one line, with the run. */
  failedRun: { href: string } | null;
};

export type AppFront = {
  appId: string;
  /** The app's name, for "N more waiting outside GTM". */
  appName: string;
  /** The app's lead agent, asked the attention question by name (never a router guess). */
  leadSlug: string | null;
  counts: AttentionCount[];
  /** Items past the shown counts, and where all of them are. */
  more: { count: number; href: string } | null;
  /** What waits on a person from outside this app, and where it is. */
  outside: { count: number; href: string } | null;
  briefing: FrontBriefing | null;
};

/** The briefing row the front reads. */
export type BriefingRowInput = { id: number; title: string; createdAt: Date; teamSlug: string | null; document: BriefingV2 | null; missionRunId: number | null };

/** A Review item as the counts need it (`InboxItem`'s fields). */
export type WaitingItemInput = { agentSlug: string | null; actionId?: string };

/** An automation run as the staleness check reads it. */
export type AutomationRunInput = { id: number; slug: string; kind: string; status: string; startedAt: Date; finishedAt: Date | null; targetRunId: number | null };

/** At most this many counts on the line; the rest fold into "N more". */
export const MAX_COUNTS = 3;

/** At most this many moves under the headline. */
export const MAX_MOVES = 3;

const REVIEW_HREF = '/dashboard/inbox';

/**
 * The newest team brief of this app's teams. The workspace rollup (no team)
 * and a personal brief are not an app's.
 * @param rows - Briefing rows, any order.
 * @param teams - The app's team slugs (`teamsOfApp`).
 */
export function pickAppBriefing<T extends Pick<BriefingRowInput, 'createdAt' | 'teamSlug'>>(rows: readonly T[], teams: readonly string[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.teamSlug && teams.includes(row.teamSlug) && (!best || row.createdAt > best.createdAt)) {
      best = row;
    }
  }
  return best;
}

function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * The top moves of a typed brief: the decisions it put in front of a person,
 * then today's critical path, at most {@link MAX_MOVES}. A markdown-only
 * brief has none to offer and shows none.
 * @param doc - The typed document, or null.
 */
export function topMoves(doc: BriefingV2 | null): string[] {
  if (!doc) {
    return [];
  }
  const moves = [
    ...(doc.decisions?.judgment ?? []).map(d => d.title),
    ...(doc.criticalPath?.items ?? []).slice().sort((a, b) => a.order - b.order).map(i => i.label),
  ];
  return [...new Set(moves.map(m => m.trim()).filter(Boolean))].slice(0, MAX_MOVES);
}

/**
 * Whether the job that writes this brief failed after it. The brief names
 * the mission run that published it (`briefing.mission_run_id`, stamped by
 * `publish_briefing`); the automation run that dispatched that mission run is
 * the writer, and only that automation's newest run since the brief decides.
 * A run still going, or one that succeeded, is no failure; a brief published
 * outside a mission run names no writer and has nothing to say.
 * @param brief - When it was published and the mission run that published it.
 * @param brief.createdAt - When it was published.
 * @param brief.missionRunId - The mission run that published it, if any.
 * @param runs - Automation runs: the writer and its automation's later runs.
 * @returns The failed run's page, or null.
 */
export function failedRunAfter(brief: { createdAt: Date; missionRunId: number | null }, runs: readonly AutomationRunInput[]): { href: string } | null {
  if (brief.missionRunId === null) {
    return null;
  }
  const writer = runs.find(r => r.kind === 'mission_check' && r.targetRunId === brief.missionRunId);
  if (!writer) {
    return null;
  }
  const later = runs
    .filter(r => r.slug === writer.slug && r.id !== writer.id && r.startedAt > brief.createdAt)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  if (!later || later.status !== 'error') {
    return null;
  }
  const href = later.kind === 'mission_check' && later.targetRunId
    ? `/dashboard/missions/runs/${later.targetRunId}`
    : `/dashboard/automation/runs?slug=${encodeURIComponent(later.slug)}&status=error`;
  return { href };
}

/**
 * The brief as the front draws it.
 * @param row - The brief.
 * @param opts - Now, the workspace's zone, and the run log after it.
 * @param opts.now - Now.
 * @param opts.timeZone - The workspace's zone.
 * @param opts.runs - The run that wrote it and its automation's runs since.
 */
export function frontBriefing(row: BriefingRowInput, opts: { now: Date; timeZone: string; runs: readonly AutomationRunInput[] }): FrontBriefing {
  const today = dayKey(row.createdAt, opts.timeZone) === dayKey(opts.now, opts.timeZone);
  return {
    id: row.id,
    title: row.title,
    href: briefingHref(row.id),
    today,
    publishedAt: row.createdAt.toISOString(),
    timeZone: opts.timeZone,
    headline: row.document?.today?.summary?.trim() || null,
    decisions: row.document?.decisions?.judgment.length ?? 0,
    moves: topMoves(row.document),
    // Only a brief that is not today's can be stale.
    failedRun: today ? null : failedRunAfter(row, opts.runs),
  };
}

/**
 * The counts behind the attention entry: the Review rows this app's agents
 * left waiting on a person, one count per kind of action, largest first. Rows
 * are counted, the same unit Review and its badge count. Each count's link
 * shows exactly the rows it counted: an item a surface decides
 * (`Surface.decides`) links to that surface; the rest link to Review filtered
 * to the app's agents and that kind. What waits from outside the app is
 * counted apart, so the front never hides it.
 * @param items - The open Review rows (`needsYouItems`).
 * @param agents - Agent slugs on the app's teams.
 * @param opts - How a kind is named and where a surface decides it.
 * @param opts.label - An action id as a person reads it (`actionLabel`).
 * @param opts.surfaceFor - The surface url that decides an action id, if any.
 */
export function attentionCounts(
  items: readonly WaitingItemInput[],
  agents: readonly string[],
  opts: { label: (actionId: string) => string; surfaceFor: (actionId: string) => string | null },
): { counts: AttentionCount[]; more: AppFront['more']; outside: AppFront['outside'] } {
  const mine = items.filter(i => i.agentSlug !== null && agents.includes(i.agentSlug));
  const outsideCount = items.length - mine.length;
  const outside = outsideCount > 0 ? { count: outsideCount, href: REVIEW_HREF } : null;
  if (mine.length === 0) {
    return { counts: [], more: null, outside };
  }
  const agentsParam = [...agents].sort().join(',');
  const reviewHref = (actionId?: string) => {
    const q = new URLSearchParams({ agents: agentsParam });
    if (actionId) {
      q.set('actionKind', actionId);
    }
    return `${REVIEW_HREF}?${q.toString()}`;
  };
  const byKind = new Map<string, number>();
  for (const item of mine) {
    const key = item.actionId ?? '';
    byKind.set(key, (byKind.get(key) ?? 0) + 1);
  }
  const ranked = [...byKind].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // A row with no action id (an ask, a run to retry) is counted, not named:
  // it rides in "N more in Review".
  const named = ranked.filter(([id]) => id !== '');
  const counts: AttentionCount[] = named.slice(0, MAX_COUNTS).map(([id, count]) => ({
    key: id,
    label: opts.label(id),
    count,
    href: opts.surfaceFor(id) ?? reviewHref(id),
  }));
  const shown = counts.reduce((n, c) => n + c.count, 0);
  return { counts, more: mine.length > shown ? { count: mine.length - shown, href: reviewHref() } : null, outside };
}
