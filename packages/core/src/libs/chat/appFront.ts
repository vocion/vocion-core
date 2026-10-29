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
  /** "Fri, Oct 23" — every brief not from today carries its date. */
  dateLabel: string;
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
  /** The app's lead agent, asked the attention question by name (never a router guess). */
  leadSlug: string | null;
  /** What the attention entry sends. */
  prompt: string;
  counts: AttentionCount[];
  /** Items past the shown counts, and where all of them are. */
  more: { count: number; href: string } | null;
  briefing: FrontBriefing | null;
};

/** The briefing row the front reads. */
export type BriefingRowInput = { id: number; title: string; createdAt: Date; teamSlug: string | null; document: BriefingV2 | null };

/** A Review item as the counts need it (`InboxItem`'s fields). */
export type WaitingItemInput = { agentSlug: string | null; teamSlug: string | null; actionId?: string; count?: number };

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

/**
 * The day a brief is from, in the workspace's zone: "Fri, Oct 23".
 * @param d - When it was published.
 * @param timeZone - The workspace's zone.
 */
export function briefDayLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
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
 * Whether the job that writes this brief failed after it: the run that was
 * going when the brief was published names the automation, and that
 * automation's newest run since then decides. A run still going, or one that
 * succeeded, is no failure; a brief no automation wrote has nothing to say.
 * @param publishedAt - When the brief was published.
 * @param runs - Automation runs around and after it.
 * @returns The failed run's page, or null.
 */
export function failedRunAfter(publishedAt: Date, runs: readonly AutomationRunInput[]): { href: string } | null {
  const writer = runs.find(r => r.startedAt <= publishedAt && (r.finishedAt === null || r.finishedAt >= publishedAt));
  if (!writer) {
    return null;
  }
  const later = runs
    .filter(r => r.slug === writer.slug && r.id !== writer.id && r.startedAt > publishedAt)
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
 * @param opts.runs - Automation runs since shortly before it was published.
 */
export function frontBriefing(row: BriefingRowInput, opts: { now: Date; timeZone: string; runs: readonly AutomationRunInput[] }): FrontBriefing {
  const today = dayKey(row.createdAt, opts.timeZone) === dayKey(opts.now, opts.timeZone);
  return {
    id: row.id,
    title: row.title,
    href: briefingHref(row.id),
    today,
    dateLabel: briefDayLabel(row.createdAt, opts.timeZone),
    headline: row.document?.today?.summary?.trim() || null,
    decisions: row.document?.decisions?.judgment.length ?? 0,
    moves: topMoves(row.document),
    // Only a brief that is not today's can be stale.
    failedRun: today ? null : failedRunAfter(row.createdAt, opts.runs),
  };
}

/**
 * The counts behind the attention entry: what waits on a person from this
 * app's agents and teams, one count per kind of action, largest first. An
 * item a surface decides (`Surface.decides`) links to that surface; the rest
 * link to Review filtered to the app's agents and that kind.
 * @param items - The open Review items (`needsYouItems`).
 * @param scope - The app's agents and teams.
 * @param scope.agents - Agent slugs on the app's teams.
 * @param scope.teams - The app's team slugs.
 * @param opts - How a kind is named and where a surface decides it.
 * @param opts.label - An action id as a person reads it (`actionLabel`).
 * @param opts.surfaceFor - The surface url that decides an action id, if any.
 */
export function attentionCounts(
  items: readonly WaitingItemInput[],
  scope: { agents: readonly string[]; teams: readonly string[] },
  opts: { label: (actionId: string) => string; surfaceFor: (actionId: string) => string | null },
): { counts: AttentionCount[]; more: AppFront['more'] } {
  const mine = items.filter(i => (i.agentSlug !== null && scope.agents.includes(i.agentSlug)) || (i.teamSlug !== null && scope.teams.includes(i.teamSlug)));
  if (mine.length === 0) {
    return { counts: [], more: null };
  }
  const agentsParam = [...scope.agents].sort().join(',');
  const reviewHref = (actionId?: string) => {
    const q = new URLSearchParams();
    if (agentsParam) {
      q.set('agents', agentsParam);
    }
    if (actionId) {
      q.set('actionKind', actionId);
    }
    const qs = q.toString();
    return qs ? `${REVIEW_HREF}?${qs}` : REVIEW_HREF;
  };
  const byKind = new Map<string, number>();
  for (const item of mine) {
    const key = item.actionId ?? '';
    byKind.set(key, (byKind.get(key) ?? 0) + (item.count ?? 1));
  }
  const ranked = [...byKind].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // A kind with no action id (an ask, a run to retry) is counted, not named:
  // it rides in "N more in Review".
  const named = ranked.filter(([id]) => id !== '');
  const counts: AttentionCount[] = named.slice(0, MAX_COUNTS).map(([id, count]) => ({
    key: id,
    label: opts.label(id),
    count,
    href: opts.surfaceFor(id) ?? reviewHref(id),
  }));
  const total = ranked.reduce((n, [, c]) => n + c, 0);
  const shown = counts.reduce((n, c) => n + c.count, 0);
  return { counts, more: total > shown ? { count: total - shown, href: reviewHref() } : null };
}

/**
 * What the attention entry asks the app's lead. Plain words: the structure of
 * the answer is the agent's skill, not the chip's (`chat/synthesis.ts`).
 * @param briefing - The app's brief, when there is one.
 */
export function attentionPrompt(briefing: Pick<FrontBriefing, 'title' | 'today' | 'dateLabel'> | null): string {
  const from = briefing ? ` Start from ${briefing.today ? 'today\'s' : `the ${briefing.dateLabel}`} briefing ("${briefing.title}") and` : ' Start from';
  return `What needs my attention today?${from} what is waiting on me in Review: what is at risk, and the 3 moves that matter most.`;
}
