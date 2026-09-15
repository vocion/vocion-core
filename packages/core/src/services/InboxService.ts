import type { AskKind } from '@/services/AskService';
import type { ReviewItem, ReviewKind } from '@/services/ReviewService';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema, learningCandidateSchema, missionRunSchema, workerRunSchema } from '@/models/Schema';
import { listPending, pendingCount } from '@/services/ReviewService';

/**
 * InboxService — ONE list of everything waiting on a person, wherever it is
 * recorded. Backs `/dashboard/inbox` ("Needs you") and the sidebar count.
 *
 * Sources, and where each row deep-links:
 *   - open `ask` rows                                   → /dashboard/inbox/:id
 *   - the review queue (pending actions, missions
 *     awaiting review, paused workflows)                → /dashboard/review, the run page
 *   - `mission_run` paused, `worker_run` paused /
 *     awaiting review                                   → the run page / the agent
 *   - pending `learning_candidate` rows                 → /dashboard/learnings/:step
 *   - `worker_run` failed or lost in the last 24 hours  → the agent
 *
 * Read-only aggregation. Nothing here decides anything; each row points at
 * the surface that does.
 */

/** How the inbox groups rows. Kinds map onto groups below. */
export type InboxGroup = 'rulings' | 'approvals' | 'merges' | 'inputs' | 'recommendations' | 'gates' | 'runs' | 'learnings';

export const INBOX_GROUPS: readonly InboxGroup[] = ['rulings', 'approvals', 'merges', 'inputs', 'recommendations', 'gates', 'runs', 'learnings'];

export type InboxItemKind = AskKind | 'sheet' | 'review' | 'run' | 'learning';

export type InboxItem = {
  /** Stable key for React lists — `<source>:<id>`. */
  key: string;
  kind: InboxItemKind;
  group: InboxGroup;
  title: string;
  /** Who this is about, when known. */
  agentSlug: string | null;
  teamSlug: string | null;
  risk: string | null;
  /** The underlying record's status, for the pill. */
  status: string;
  /** When it started waiting. */
  at: Date;
  /** Where clicking goes. */
  href: string;
  /** One line more — the review plane, the learning step, the error. */
  detail?: string;
  /** Set for ask rows, so the client can decide in place. */
  askId?: number;
  /** Set when this row is a decision sheet — several open asks under one key. */
  groupKey?: string;
  /** Open questions in the sheet. */
  count?: number;
};

export type Inbox = {
  items: InboxItem[];
  /** Rows per group, for the section headers and the chips. */
  counts: Record<InboxGroup, number>;
  total: number;
};

const ASK_GROUP: Record<AskKind, InboxGroup> = {
  ruling: 'rulings',
  approval: 'approvals',
  merge: 'merges',
  input: 'inputs',
  credential: 'inputs',
  recommendation: 'recommendations',
  gate: 'gates',
};

const RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Group for an ask kind. An unknown kind (a row written by a newer core) is
 * shown under approvals rather than dropped.
 * @param kind
 */
export function groupForAskKind(kind: string): InboxGroup {
  return (ASK_GROUP as Record<string, InboxGroup>)[kind] ?? 'approvals';
}

/**
 * Where a review-queue item is decided.
 * @param item
 */
function reviewHref(item: ReviewItem): string {
  const byKind: Record<ReviewKind, string> = {
    action: '/dashboard/review',
    mission: `/dashboard/missions/runs/${item.id}`,
    workflow: '/dashboard/review',
  };
  return byKind[item.kind];
}

const REVIEW_DETAIL: Record<ReviewKind, string> = {
  action: 'Proposed action awaiting review',
  mission: 'Mission run awaiting review',
  workflow: 'Workflow paused at an approval gate',
};

/**
 * Every row that is waiting on a person, oldest-waiting first inside each group.
 * @param orgId
 */
export async function needsYou(orgId: string): Promise<Inbox> {
  const since = new Date(Date.now() - RECENT_FAILURE_WINDOW_MS);
  const [asks, review, pausedMissions, waitingWorkers, failedWorkers, candidates] = await Promise.all([
    db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'))).orderBy(desc(askSchema.id)),
    listPending(orgId),
    db
      .select({ id: missionRunSchema.id, title: missionRunSchema.title, status: missionRunSchema.status, pauseReason: missionRunSchema.pauseReason, at: missionRunSchema.updatedAt, team: missionRunSchema.team })
      .from(missionRunSchema)
      .where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, 'paused'))),
    db
      .select({ id: workerRunSchema.id, agentSlug: workerRunSchema.agentSlug, status: workerRunSchema.status, at: workerRunSchema.updatedAt })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['paused', 'awaiting_review']))),
    db
      .select({ id: workerRunSchema.id, agentSlug: workerRunSchema.agentSlug, status: workerRunSchema.status, error: workerRunSchema.error, at: workerRunSchema.updatedAt })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['failed', 'lost']), gte(workerRunSchema.updatedAt, since))),
    db
      .select({ id: learningCandidateSchema.id, stepName: learningCandidateSchema.stepName, ruleText: learningCandidateSchema.ruleText, editedRuleText: learningCandidateSchema.editedRuleText, at: learningCandidateSchema.createdAt })
      .from(learningCandidateSchema)
      .where(and(eq(learningCandidateSchema.orgId, orgId), eq(learningCandidateSchema.status, 'pending'))),
  ]);

  // Several open asks under one group_key are one decision sheet — one row,
  // answered as a stepper. A group with a single open ask is just an ask.
  const byGroup = new Map<string, typeof asks>();
  const standalone: typeof asks = [];
  for (const a of asks) {
    if (a.groupKey) {
      byGroup.set(a.groupKey, [...(byGroup.get(a.groupKey) ?? []), a]);
    } else {
      standalone.push(a);
    }
  }
  const askRows: InboxItem[] = [];
  for (const [groupKey, group] of byGroup) {
    if (group.length === 1) {
      standalone.push(group[0]!);
      continue;
    }
    const oldest = group.reduce((m, a) => (a.createdAt < m.createdAt ? a : m));
    askRows.push({
      key: `sheet:${groupKey}`,
      kind: 'sheet',
      group: groupForAskKind(oldest.kind),
      title: oldest.groupTitle ?? `${group.length} questions`,
      agentSlug: oldest.agentSlug,
      teamSlug: oldest.teamSlug,
      risk: group.some(a => a.risk === 'high') ? 'high' : group.some(a => a.risk === 'medium') ? 'medium' : oldest.risk,
      status: 'open',
      at: oldest.createdAt,
      href: `/dashboard/inbox/g/${encodeURIComponent(groupKey)}`,
      detail: `${group.length} questions`,
      groupKey,
      count: group.length,
    });
  }
  for (const a of standalone) {
    askRows.push({
      key: `ask:${a.id}`,
      kind: a.kind as AskKind,
      group: groupForAskKind(a.kind),
      title: a.title,
      agentSlug: a.agentSlug,
      teamSlug: a.teamSlug,
      risk: a.risk,
      status: a.status,
      at: a.createdAt,
      href: `/dashboard/inbox/${a.id}`,
      askId: a.id,
    });
  }

  const items: InboxItem[] = [
    ...askRows,
    ...review.map((r): InboxItem => ({
      key: `review:${r.kind}:${r.id}`,
      kind: 'review',
      group: 'approvals',
      title: r.title,
      agentSlug: null,
      teamSlug: null,
      risk: null,
      status: r.status,
      // ReviewItem carries no timestamp; the queue is newest-id-first, so the
      // sort below keeps them together at "now" rather than inventing an age.
      at: new Date(),
      href: reviewHref(r),
      detail: REVIEW_DETAIL[r.kind],
    })),
    ...pausedMissions.map((m): InboxItem => ({
      key: `mission:${m.id}`,
      kind: 'run',
      group: 'runs',
      title: m.title,
      agentSlug: m.team?.lead ?? null,
      teamSlug: null,
      risk: null,
      status: m.status,
      at: m.at,
      href: `/dashboard/missions/runs/${m.id}`,
      detail: m.pauseReason ?? 'Mission run paused',
    })),
    ...waitingWorkers.map((w): InboxItem => ({
      key: `worker:${w.id}`,
      kind: 'run',
      group: 'runs',
      title: `${w.agentSlug} — worker run #${w.id}`,
      agentSlug: w.agentSlug,
      teamSlug: null,
      risk: null,
      status: w.status,
      at: w.at,
      href: `/dashboard/agents/${w.agentSlug}`,
      detail: w.status === 'paused' ? 'External worker paused' : 'External worker awaiting review',
    })),
    ...failedWorkers.map((w): InboxItem => ({
      key: `worker:${w.id}`,
      kind: 'run',
      group: 'runs',
      title: `${w.agentSlug} — worker run #${w.id} ${w.status}`,
      agentSlug: w.agentSlug,
      teamSlug: null,
      risk: 'medium',
      status: w.status,
      at: w.at,
      href: `/dashboard/agents/${w.agentSlug}`,
      detail: w.error ?? (w.status === 'lost' ? 'Lease lapsed without a heartbeat' : 'Run failed'),
    })),
    ...candidates.map((c): InboxItem => ({
      key: `learning:${c.id}`,
      kind: 'learning',
      group: 'learnings',
      title: c.editedRuleText ?? c.ruleText,
      agentSlug: null,
      teamSlug: null,
      risk: null,
      status: 'pending',
      at: c.at,
      href: `/dashboard/learnings/${c.stepName}`,
      detail: `Suggested rule for ${c.stepName}`,
    })),
  ];

  // Longest-waiting first — the inbox is a queue, not a feed.
  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  const counts = Object.fromEntries(INBOX_GROUPS.map(g => [g, 0])) as Record<InboxGroup, number>;
  for (const item of items) {
    counts[item.group] += 1;
  }
  return { items, counts, total: items.length };
}

/**
 * How many things are waiting — the sidebar badge. Counts in the database
 * rather than loading rows, because it runs on every dashboard render.
 * @param orgId
 */
export async function needsYouCount(orgId: string): Promise<number> {
  const since = new Date(Date.now() - RECENT_FAILURE_WINDOW_MS);
  const count = (where: ReturnType<typeof and>, table: typeof askSchema | typeof missionRunSchema | typeof workerRunSchema | typeof learningCandidateSchema) =>
    db.select({ n: sql<number>`count(*)::int` }).from(table).where(where).then(([r]) => r?.n ?? 0);

  const [asks, review, missions, workers, failed, candidates] = await Promise.all([
    // A decision sheet is one row on the page, so it is one on the badge too.
    db.select({ n: sql<number>`count(distinct coalesce(${askSchema.groupKey}, ${askSchema.id}::text))::int` })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open')))
      .then(([r]) => r?.n ?? 0),
    pendingCount(orgId),
    count(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, 'paused')), missionRunSchema),
    count(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['paused', 'awaiting_review'])), workerRunSchema),
    count(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['failed', 'lost']), gte(workerRunSchema.updatedAt, since)), workerRunSchema),
    count(and(eq(learningCandidateSchema.orgId, orgId), eq(learningCandidateSchema.status, 'pending')), learningCandidateSchema),
  ]);
  return asks + review + missions + workers + failed + candidates;
}
