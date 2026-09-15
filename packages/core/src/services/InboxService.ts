import type { AskKind } from '@/services/AskService';
import type { ReviewRow, ReviewTab } from '@/services/inbox/reviewRows';
import type { ReviewItem, ReviewKind } from '@/services/ReviewService';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema, learningCandidateSchema, missionRunSchema, workerRunSchema } from '@/models/Schema';
import { groupByRecord, listReviewRows } from '@/services/inbox/reviewRows';
import { listPending } from '@/services/ReviewService';

/**
 * InboxService — ONE list of everything waiting on a person, wherever it is
 * recorded. Backs `/dashboard/inbox` ("Needs you") and the sidebar count.
 *
 * Sources, and where each row deep-links:
 *   - open `ask` rows                                   → /dashboard/inbox/:id
 *   - proposed actions in the review queue, described
 *     for a person and grouped per record               → /dashboard/inbox/r/:recordKey, /dashboard/review
 *   - missions awaiting review, paused workflows         → the run page / review
 *   - `mission_run` paused, `worker_run` paused /
 *     awaiting review                                   → the run page / the agent
 *   - pending `learning_candidate` rows                 → /dashboard/learnings/:step
 *   - `worker_run` failed or lost in the last 24 hours  → the agent
 *
 * Three tabs: open (all of the above), snoozed (actions snoozed into the
 * future), decided (answered asks and decided actions, newest first). Search,
 * sort and filters run here, in memory, over what is at most a few hundred
 * rows — the page persists them in the URL.
 *
 * Read-only aggregation. Nothing here decides anything; each row points at
 * the surface that does.
 */

/** How the inbox groups rows. Kinds map onto groups below. */
export type InboxGroup = 'rulings' | 'approvals' | 'merges' | 'inputs' | 'recommendations' | 'gates' | 'runs' | 'learnings';

export const INBOX_GROUPS: readonly InboxGroup[] = ['rulings', 'approvals', 'merges', 'inputs', 'recommendations', 'gates', 'runs', 'learnings'];

export type InboxItemKind = AskKind | 'sheet' | 'review' | 'review-sheet' | 'run' | 'learning';

export type InboxTab = ReviewTab;
export const INBOX_TABS: readonly InboxTab[] = ['open', 'snoozed', 'decided'];

export type InboxSort = 'oldest' | 'newest' | 'value' | 'confidence';
export const INBOX_SORTS: readonly InboxSort[] = ['oldest', 'newest', 'value', 'confidence'];

export type InboxItem = {
  /** Stable key for React lists — `<source>:<id>`. */
  key: string;
  kind: InboxItemKind;
  group: InboxGroup;
  title: string;
  /** "<Record> › <action kind> › proposed by <agent>" — the breadcrumb under the title. */
  subline?: string;
  /** Who this is about, when known. */
  agentSlug: string | null;
  teamSlug: string | null;
  risk: string | null;
  /** The underlying record's status, for the pill. */
  status: string;
  /** When it started waiting (open/snoozed) or was decided (decided tab). */
  at: Date;
  /** Where clicking goes. */
  href: string;
  /** One line more — the review plane, the learning step, the error. */
  detail?: string;
  /** Set for ask rows, so the client can decide in place. */
  askId?: number;
  /** Set for a single proposed action, so the row can approve/reject in place. */
  reviewId?: number;
  /** The action id (`hubspot.update`) — the kind filter chips. */
  actionId?: string;
  /** Set when this row is a decision sheet — several open items under one key. */
  groupKey?: string;
  /** Open questions in the sheet. */
  count?: number;
  /** 0–1, from the proposal. */
  confidence?: number | null;
  amount?: number | null;
  currency?: string | null;
  /** Decided tab: what was chosen. */
  decision?: string | null;
  decidedBy?: string | null;
};

export type InboxFacets = {
  /** Action ids present, with counts — the kind chips. */
  actionKinds: { id: string; count: number }[];
  /** Agents present, with counts — the agent chips. */
  agents: { slug: string; count: number }[];
};

export type InboxQuery = {
  tab?: InboxTab;
  q?: string;
  sort?: InboxSort;
  /** Action ids to keep. Empty = all. */
  kinds?: string[];
  /** Agent slugs to keep. Empty = all. */
  agents?: string[];
  /** One inbox group only (the chip). */
  group?: InboxGroup;
};

export type Inbox = {
  items: InboxItem[];
  /** Rows per group, for the section headers and the chips. */
  counts: Record<InboxGroup, number>;
  total: number;
  /** Rows per tab, before search/filter, for the tab labels. */
  tabs: Record<InboxTab, number>;
  facets: InboxFacets;
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
 * Where a non-action review-queue item is decided.
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
 * The URL for one record's decision sheet.
 * @param recordKey
 */
export function recordSheetHref(recordKey: string): string {
  return `/dashboard/inbox/r/${encodeURIComponent(recordKey)}`;
}

/**
 * One inbox row per proposed action, or one per record when several
 * proposals are about the same deal / contact / address.
 * @param rows - Action rows for the tab.
 * @param tab
 */
function reviewItems(rows: ReviewRow[], tab: InboxTab): InboxItem[] {
  if (tab === 'decided') {
    return rows.map(r => ({
      key: `review:action:${r.id}`,
      kind: 'review',
      group: 'approvals',
      title: r.described.title,
      subline: r.described.subline,
      agentSlug: r.described.agentSlug,
      teamSlug: null,
      risk: null,
      status: r.status,
      at: r.decidedAt ?? r.createdAt,
      href: '/dashboard/review',
      reviewId: r.id,
      actionId: r.actionId,
      confidence: r.described.confidence,
      amount: r.described.amount,
      currency: r.described.currency,
      decision: r.status === 'rejected' ? 'rejected' : 'approved',
      decidedBy: r.decidedBy,
    }));
  }
  const items: InboxItem[] = [];
  for (const g of groupByRecord(rows)) {
    if (g.rows.length === 1 || !g.record) {
      for (const r of g.rows) {
        items.push({
          key: `review:action:${r.id}`,
          kind: 'review',
          group: 'approvals',
          title: r.described.title,
          subline: r.described.subline,
          agentSlug: r.described.agentSlug,
          teamSlug: null,
          risk: null,
          status: r.status,
          at: r.createdAt,
          href: recordSheetHref(g.key),
          detail: r.snoozedUntil && r.snoozedUntil > new Date() ? `Snoozed until ${r.snoozedUntil.toLocaleString()}` : undefined,
          reviewId: r.id,
          actionId: r.actionId,
          confidence: r.described.confidence,
          amount: r.described.amount,
          currency: r.described.currency,
        });
      }
      continue;
    }
    const oldest = g.rows.reduce((m, r) => (r.createdAt < m.createdAt ? r : m));
    const agents = [...new Set(g.rows.map(r => r.described.agentSlug).filter(Boolean))] as string[];
    const kinds = [...new Set(g.rows.map(r => r.described.actionKind))];
    const confidences = g.rows.map(r => r.described.confidence).filter((c): c is number => c !== null);
    const amount = g.rows.map(r => r.described.amount).find((a): a is number => a !== null) ?? null;
    items.push({
      key: `review-sheet:${g.key}`,
      kind: 'review-sheet',
      group: 'approvals',
      title: `${g.record.name} — ${g.rows.length} proposals`,
      subline: [g.record.name, kinds.join(' + '), agents.length > 0 ? `proposed by ${agents.join(', ')}` : null].filter(Boolean).join(' › '),
      agentSlug: agents[0] ?? null,
      teamSlug: null,
      risk: null,
      status: 'pending',
      at: oldest.createdAt,
      href: recordSheetHref(g.key),
      groupKey: g.key,
      count: g.rows.length,
      actionId: g.rows[0]!.actionId,
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      amount,
      currency: g.rows.find(r => r.described.amount !== null)?.described.currency ?? null,
    });
  }
  return items;
}

/**
 * Open asks as rows — several open asks under one group_key are one decision
 * sheet, answered as a stepper; a group with one open ask is just an ask.
 * @param asks
 */
function askItems(asks: (typeof askSchema.$inferSelect)[]): InboxItem[] {
  const byGroup = new Map<string, typeof asks>();
  const standalone: typeof asks = [];
  for (const a of asks) {
    if (a.groupKey) {
      byGroup.set(a.groupKey, [...(byGroup.get(a.groupKey) ?? []), a]);
    } else {
      standalone.push(a);
    }
  }
  const rows: InboxItem[] = [];
  for (const [groupKey, group] of byGroup) {
    if (group.length === 1) {
      standalone.push(group[0]!);
      continue;
    }
    const oldest = group.reduce((m, a) => (a.createdAt < m.createdAt ? a : m));
    rows.push({
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
    rows.push({
      key: `ask:${a.id}`,
      kind: a.kind as AskKind,
      group: groupForAskKind(a.kind),
      title: a.title,
      subline: [a.agentSlug ? `asked by ${a.agentSlug}` : null, a.teamSlug ? `team ${a.teamSlug}` : null].filter(Boolean).join(' › ') || undefined,
      agentSlug: a.agentSlug,
      teamSlug: a.teamSlug,
      risk: a.risk,
      status: a.status,
      at: a.createdAt,
      href: `/dashboard/inbox/${a.id}`,
      askId: a.id,
    });
  }
  return rows;
}

/**
 * Everything on the OPEN tab: asks, described + grouped proposed actions,
 * missions/workflows awaiting review, paused/failed runs, suggested rules.
 * @param orgId
 */
async function openItems(orgId: string): Promise<InboxItem[]> {
  const since = new Date(Date.now() - RECENT_FAILURE_WINDOW_MS);
  const [asks, actions, review, pausedMissions, waitingWorkers, failedWorkers, candidates] = await Promise.all([
    db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'))).orderBy(desc(askSchema.id)),
    listReviewRows(orgId, 'open'),
    listPending(orgId, { kind: undefined }).then(items => items.filter(i => i.kind !== 'action')),
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

  return [
    ...askItems(asks),
    ...reviewItems(actions, 'open'),
    ...review.map((r): InboxItem => ({
      key: `review:${r.kind}:${r.id}`,
      kind: 'review',
      group: 'approvals',
      title: r.title,
      subline: REVIEW_DETAIL[r.kind],
      agentSlug: null,
      teamSlug: null,
      risk: null,
      status: r.status,
      // ReviewItem carries no timestamp for these planes; they sort at "now".
      at: new Date(),
      href: reviewHref(r),
    })),
    ...pausedMissions.map((m): InboxItem => ({
      key: `mission:${m.id}`,
      kind: 'run',
      group: 'runs',
      title: m.title,
      subline: m.pauseReason ?? 'Mission run paused',
      agentSlug: m.team?.lead ?? null,
      teamSlug: null,
      risk: null,
      status: m.status,
      at: m.at,
      href: `/dashboard/missions/runs/${m.id}`,
    })),
    ...waitingWorkers.map((w): InboxItem => ({
      key: `worker:${w.id}`,
      kind: 'run',
      group: 'runs',
      title: `${w.agentSlug} — worker run #${w.id}`,
      subline: w.status === 'paused' ? 'External worker paused' : 'External worker awaiting review',
      agentSlug: w.agentSlug,
      teamSlug: null,
      risk: null,
      status: w.status,
      at: w.at,
      href: `/dashboard/agents/${w.agentSlug}`,
    })),
    ...failedWorkers.map((w): InboxItem => ({
      key: `worker:${w.id}`,
      kind: 'run',
      group: 'runs',
      title: `${w.agentSlug} — worker run #${w.id} ${w.status}`,
      subline: w.error ?? (w.status === 'lost' ? 'Lease lapsed without a heartbeat' : 'Run failed'),
      agentSlug: w.agentSlug,
      teamSlug: null,
      risk: 'medium',
      status: w.status,
      at: w.at,
      href: `/dashboard/agents/${w.agentSlug}`,
    })),
    ...candidates.map((c): InboxItem => ({
      key: `learning:${c.id}`,
      kind: 'learning',
      group: 'learnings',
      title: c.editedRuleText ?? c.ruleText,
      subline: `Suggested rule for ${c.stepName}`,
      agentSlug: null,
      teamSlug: null,
      risk: null,
      status: 'pending',
      at: c.at,
      href: `/dashboard/learnings/${c.stepName}`,
    })),
  ];
}

/**
 * Answered asks, as rows for the decided tab.
 * @param orgId
 * @param limit
 */
async function decidedAskItems(orgId: string, limit = 200): Promise<InboxItem[]> {
  const asks = await db
    .select()
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), inArray(askSchema.status, ['approved', 'rejected', 'done', 'superseded'])))
    .orderBy(desc(askSchema.decidedAt))
    .limit(limit);
  return asks.map((a): InboxItem => ({
    key: `ask:${a.id}`,
    kind: a.kind as AskKind,
    group: groupForAskKind(a.kind),
    title: a.title,
    subline: [a.agentSlug ? `asked by ${a.agentSlug}` : null, a.decisionNote ? `“${a.decisionNote}”` : null].filter(Boolean).join(' › ') || undefined,
    agentSlug: a.agentSlug,
    teamSlug: a.teamSlug,
    risk: a.risk,
    status: a.status,
    at: a.decidedAt ?? a.updatedAt,
    href: `/dashboard/inbox/${a.id}`,
    askId: a.id,
    decision: a.decision ?? a.status,
    decidedBy: a.decidedBy,
  }));
}

/**
 * Search: case-insensitive, over what a person sees on the row.
 * @param items
 * @param q
 */
function search(items: InboxItem[], q: string): InboxItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return items;
  }
  return items.filter(i => [i.title, i.subline, i.agentSlug, i.actionId, i.detail].some(f => f?.toLowerCase().includes(needle)));
}

/**
 * Sort in place per the picked order. Rows with no value sort after those
 * with one; ties fall back to oldest first.
 * @param items
 * @param sort
 */
function sortItems(items: InboxItem[], sort: InboxSort): InboxItem[] {
  const oldest = (a: InboxItem, b: InboxItem) => a.at.getTime() - b.at.getTime();
  const byNumber = (pick: (i: InboxItem) => number | null | undefined) => (a: InboxItem, b: InboxItem) => {
    const av = pick(a) ?? null;
    const bv = pick(b) ?? null;
    if (av === bv) {
      return oldest(a, b);
    }
    if (av === null) {
      return 1;
    }
    if (bv === null) {
      return -1;
    }
    return bv - av;
  };
  switch (sort) {
    case 'newest':
      return items.sort((a, b) => oldest(b, a));
    case 'value':
      return items.sort(byNumber(i => i.amount));
    case 'confidence':
      return items.sort(byNumber(i => i.confidence));
    default:
      return items.sort(oldest);
  }
}

function facetsOf(items: InboxItem[]): InboxFacets {
  const kinds = new Map<string, number>();
  const agents = new Map<string, number>();
  for (const i of items) {
    if (i.actionId) {
      kinds.set(i.actionId, (kinds.get(i.actionId) ?? 0) + (i.count ?? 1));
    }
    if (i.agentSlug) {
      agents.set(i.agentSlug, (agents.get(i.agentSlug) ?? 0) + (i.count ?? 1));
    }
  }
  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  return {
    actionKinds: [...kinds].map(([id, count]) => ({ id, count })).sort(byCount),
    agents: [...agents].map(([slug, count]) => ({ slug, count })).sort(byCount),
  };
}

/**
 * The inbox for one tab, searched, filtered and sorted. The default is the
 * open tab, oldest first — a queue, not a feed.
 * @param orgId
 * @param query
 */
export async function listInbox(orgId: string, query: InboxQuery = {}): Promise<Inbox> {
  const tab = query.tab ?? 'open';
  // Every tab's rows, every time. Loading `decided` only when the decided tab
  // was open made its badge read 0 from anywhere else and the real number once
  // you clicked it (Chris, 2026-09-15: "decided counts show 0 when not
  // selected and 7 when selected") — a count on a tab is a promise about what
  // is behind it, so it cannot depend on which tab you are standing on.
  const [open, snoozedRows, decidedRows, decidedAsks] = await Promise.all([
    openItems(orgId),
    listReviewRows(orgId, 'snoozed'),
    listReviewRows(orgId, 'decided'),
    decidedAskItems(orgId),
  ]);
  const snoozed = reviewItems(snoozedRows, 'snoozed');
  const decided = [...reviewItems(decidedRows, 'decided'), ...decidedAsks];
  const tabs: Record<InboxTab, number> = { open: open.length, snoozed: snoozed.length, decided: decided.length };

  let items = tab === 'open' ? open : tab === 'snoozed' ? snoozed : decided;
  const facets = facetsOf(items);
  if (query.kinds && query.kinds.length > 0) {
    items = items.filter(i => i.actionId && query.kinds!.includes(i.actionId));
  }
  if (query.agents && query.agents.length > 0) {
    items = items.filter(i => i.agentSlug && query.agents!.includes(i.agentSlug));
  }
  if (query.q) {
    items = search(items, query.q);
  }
  if (query.group) {
    items = items.filter(i => i.group === query.group);
  }
  sortItems(items, tab === 'decided' ? (query.sort ?? 'newest') : (query.sort ?? 'oldest'));

  const counts = Object.fromEntries(INBOX_GROUPS.map(g => [g, 0])) as Record<InboxGroup, number>;
  for (const item of items) {
    counts[item.group] += 1;
  }
  return { items, counts, total: items.length, tabs, facets };
}

/**
 * Every row that is waiting on a person, oldest-waiting first — the open tab,
 * unfiltered.
 * @param orgId
 */
export async function needsYou(orgId: string): Promise<Inbox> {
  return listInbox(orgId, { tab: 'open' });
}

/**
 * How many rows the open tab shows — the sidebar badge. A decision sheet (asks
 * under one key, proposals about one record) counts once, as on the page.
 * @param orgId
 */
export async function needsYouCount(orgId: string): Promise<number> {
  const since = new Date(Date.now() - RECENT_FAILURE_WINDOW_MS);
  const count = (where: ReturnType<typeof and>, table: typeof missionRunSchema | typeof workerRunSchema | typeof learningCandidateSchema) =>
    db.select({ n: sql<number>`count(*)::int` }).from(table).where(where).then(([r]) => r?.n ?? 0);

  const [asks, actions, otherReview, missions, workers, failed, candidates] = await Promise.all([
    db.select({ n: sql<number>`count(distinct coalesce(${askSchema.groupKey}, ${askSchema.id}::text))::int` })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open')))
      .then(([r]) => r?.n ?? 0),
    listReviewRows(orgId, 'open').then(rows => groupByRecord(rows).length),
    listPending(orgId).then(items => items.filter(i => i.kind !== 'action').length),
    count(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, 'paused')), missionRunSchema),
    count(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['paused', 'awaiting_review'])), workerRunSchema),
    count(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['failed', 'lost']), gte(workerRunSchema.updatedAt, since)), workerRunSchema),
    count(and(eq(learningCandidateSchema.orgId, orgId), eq(learningCandidateSchema.status, 'pending')), learningCandidateSchema),
  ]);
  return asks + actions + otherReview + missions + workers + failed + candidates;
}

/** The header's "What changed": the last decision, or the newest thing waiting. */
export type InboxChange = { verb: 'approved' | 'rejected' | 'answered' | 'new'; title: string; href: string; at: Date };

/**
 * The most recent decision in the inbox — an answered ask or a decided
 * proposal — or, when nothing has been decided yet, the newest open row.
 * Never a sync event: the header is about the team's decisions, not its plumbing.
 * @param orgId
 */
export async function lastChange(orgId: string): Promise<InboxChange | null> {
  const [[ask], [action]] = await Promise.all([
    db
      .select({ id: askSchema.id, title: askSchema.title, status: askSchema.status, at: askSchema.decidedAt })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), inArray(askSchema.status, ['approved', 'rejected', 'done'])))
      .orderBy(desc(askSchema.decidedAt))
      .limit(1),
    listReviewRows(orgId, 'decided', { limit: 1 }),
  ]);
  const candidates: InboxChange[] = [];
  if (ask?.at) {
    candidates.push({ verb: ask.status === 'approved' ? 'approved' : ask.status === 'rejected' ? 'rejected' : 'answered', title: ask.title, href: `/dashboard/inbox/${ask.id}`, at: ask.at });
  }
  if (action?.decidedAt) {
    candidates.push({ verb: action.status === 'rejected' ? 'rejected' : 'approved', title: action.described.title, href: '/dashboard/inbox?tab=decided', at: action.decidedAt });
  }
  if (candidates.length > 0) {
    return candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0]!;
  }
  const open = await openItems(orgId);
  const newest = open.filter(i => i.kind !== 'review' || i.reviewId !== undefined).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return newest ? { verb: 'new', title: newest.title, href: newest.href, at: newest.at } : null;
}
