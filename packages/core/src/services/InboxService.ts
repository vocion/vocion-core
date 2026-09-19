import type { InboxRef } from '@/services/inbox/inboxRef';
import type { InboxKind, InboxSort, InboxTab } from '@/services/inbox/kinds';
import type { ReviewRow } from '@/services/inbox/reviewRows';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema, learningCandidateSchema, missionRunSchema, workerRunSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';
import { changeSummaryLine, summariseChanges } from '@/services/inbox/changeSummary';
import { humaniseActionId, recordTitle } from '@/services/inbox/describeActionRun';
import { inboxHref } from '@/services/inbox/inboxRef';
import { INBOX_KINDS, kindForAsk } from '@/services/inbox/kinds';
import { askGroupHref, recordKeyOf, recordSheetHref } from '@/services/inbox/recordKey';
import { groupByRecord, listReviewRows } from '@/services/inbox/reviewRows';

/**
 * InboxService — THE list of everything waiting on a person, wherever it is
 * recorded. Backs `/dashboard/inbox` ("Review queue"), its detail routes and the
 * sidebar count. There is no second decision surface: the review queue's
 * proposals, the asks, the stopped runs and the suggested rules are rows of
 * one list, told apart by `kind`.
 *
 * Kinds, and what each row opens:
 *   proposal        an agent-proposed `action_run` (the old review queue),
 *                   described for a person; several about one record collapse
 *                   into one sheet row              → /dashboard/inbox/proposal-:id · /dashboard/inbox/r/:recordKey
 *   ruling · approval · merge · input · credential · gate · recommendation
 *                   an open `ask`; several under one group key are one sheet
 *                                                   → /dashboard/inbox/:id · /dashboard/inbox/g/:groupKey
 *   run             a paused / awaiting-review mission or workflow run, a
 *                   paused / awaiting / failed / lost worker run
 *                                                   → /dashboard/inbox/mission-:id · workflow-:id · worker-:id
 *   learning        a pending `learning_candidate` (a suggested rule)
 *                                                   → /dashboard/inbox/learning-:id
 *
 * Three tabs: open (all of the above), snoozed (proposals snoozed into the
 * future), decided (answered asks, decided proposals, adopted or rejected
 * rules, newest first). Search, sort and filters run here, in memory, over
 * what is at most a few hundred rows — the page persists them in the URL.
 *
 * Read-only aggregation. Nothing here decides anything; each row points at
 * the detail screen that does, and every one of those writes the alignment
 * ledger (`decision_alignment`) on the way out.
 */

export type { InboxKind, InboxSort, InboxTab } from '@/services/inbox/kinds';
export { INBOX_KINDS, INBOX_SORTS, INBOX_TABS, isInboxKind, kindForAsk } from '@/services/inbox/kinds';

export type InboxItem = {
  /** Stable key for React lists — `<source>:<id>`. */
  key: string;
  kind: InboxKind;
  /** `single` opens one thing; `sheet` opens several under one key (asks in a group, proposals about one record). */
  shape: 'single' | 'sheet';
  /** What the detail route resolves — unset on a sheet. */
  ref?: InboxRef;
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
  /** One line more — the pause reason, the learning step, the error. */
  detail?: string;
  /** Set for ask rows, so the client can decide in place. */
  askId?: number;
  /** Set for a single proposed action, so the row can approve/reject in place. */
  reviewId?: number;
  /** The action id (`hubspot.update`) — the action-kind filter chips. */
  actionId?: string;
  /** Set when this row is a decision sheet — several open items under one key. */
  groupKey?: string;
  /** Open questions in the sheet — rendered as a quiet tag beside the title, never inside it. */
  count?: number;
  /**
   * What the title is short for, when the title is a name: `Deal 1234`. Shown
   * on hover so the id stays reachable without being the label.
   */
  titleHint?: string;
  /** 0–1, from the proposal. */
  confidence?: number | null;
  amount?: number | null;
  currency?: string | null;
  /** Decided tab: what was chosen — `approved`, `rejected`, `undone`, or `done for you` when the ladder released it. */
  decision?: string | null;
  /** Decided tab: a done run the row can put back in place. */
  undoable?: boolean;
  decidedBy?: string | null;
  /** Decided tab: the note that travelled with the decision. */
  note?: string | null;
};

export type InboxFacets = {
  /** Action ids present, with counts — the action-kind chips under the proposal kind. */
  actionKinds: { id: string; count: number }[];
  /** Agents present, with counts — the agent chips. */
  agents: { slug: string; count: number }[];
};

export type InboxQuery = {
  tab?: InboxTab;
  q?: string;
  sort?: InboxSort;
  /** Kinds to keep. Empty = all. */
  kinds?: InboxKind[];
  /** Action ids to keep (proposals only). Empty = all. */
  actionKinds?: string[];
  /** Agent slugs to keep. Empty = all. */
  agents?: string[];
};

export type Inbox = {
  items: InboxItem[];
  /** Rows per kind on this tab — the chip counts. Counted before the kind filter, after the others. */
  counts: Record<InboxKind, number>;
  total: number;
  /** Rows per tab, before search/filter, for the tab labels. */
  tabs: Record<InboxTab, number>;
  facets: InboxFacets;
};

const RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * One row from one proposal.
 * @param r
 * @param tab
 */
function proposalItem(r: ReviewRow, tab: InboxTab): InboxItem {
  return {
    key: `review:action:${r.id}`,
    kind: 'proposal',
    shape: 'single',
    ref: { kind: 'proposal', id: r.id },
    title: r.described.title,
    subline: r.described.subline,
    agentSlug: r.described.agentSlug,
    teamSlug: null,
    risk: null,
    status: r.status,
    at: tab === 'decided' ? (r.decidedAt ?? r.createdAt) : r.createdAt,
    href: inboxHref('proposal', r.id),
    detail: tab !== 'decided' && r.snoozedUntil && r.snoozedUntil > new Date() ? `Snoozed until ${r.snoozedUntil.toLocaleString()}` : undefined,
    reviewId: r.id,
    actionId: r.actionId,
    confidence: r.described.confidence,
    amount: r.described.amount,
    currency: r.described.currency,
    ...(tab === 'decided'
      ? { decision: r.status === 'rejected' ? 'rejected' : r.status === 'undone' ? 'undone' : r.approvedByAgent ? 'done for you' : 'approved', decidedBy: r.decidedBy, note: r.note, undoable: r.undoable }
      : {}),
  };
}

/**
 * One inbox row per proposed action, or one per record when several
 * proposals are about the same deal / contact / address.
 * @param rows - Action rows for the tab.
 * @param tab
 */
function proposalItems(rows: ReviewRow[], tab: InboxTab): InboxItem[] {
  if (tab === 'decided') {
    return rows.map(r => proposalItem(r, tab));
  }
  const items: InboxItem[] = [];
  for (const g of groupByRecord(rows)) {
    if (g.rows.length === 1 || !g.record) {
      for (const r of g.rows) {
        items.push(proposalItem(r, tab));
      }
      continue;
    }
    const oldest = g.rows.reduce((m, r) => (r.createdAt < m.createdAt ? r : m));
    const agents = [...new Set(g.rows.map(r => r.described.agentSlug).filter(Boolean))] as string[];
    const confidences = g.rows.map(r => r.described.confidence).filter((c): c is number => c !== null);
    const amount = g.rows.map(r => r.described.amount).find((a): a is number => a !== null) ?? null;
    items.push({
      key: `review-sheet:${g.key}`,
      kind: 'proposal',
      shape: 'sheet',
      // The record's NAME is the title; the count is the tag beside it, and
      // the subline says what the proposals would do (Chris, 2026-09-16).
      title: recordTitle(g.record),
      titleHint: g.record.fromId === true ? undefined : g.record.idLabel,
      subline: [changeSummaryLine(summariseChanges(g.rows)), agents.length > 0 ? `recommended by ${agents.join(', ')}` : null].filter(Boolean).join(' › '),
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
      kind: kindForAsk(oldest.kind),
      shape: 'sheet',
      title: oldest.groupTitle ?? `${group.length} questions`,
      subline: oldest.agentSlug ? `asked by ${oldest.agentSlug}` : undefined,
      agentSlug: oldest.agentSlug,
      teamSlug: oldest.teamSlug,
      risk: group.some(a => a.risk === 'high') ? 'high' : group.some(a => a.risk === 'medium') ? 'medium' : oldest.risk,
      status: 'open',
      at: oldest.createdAt,
      href: askGroupHref(groupKey),
      detail: `${group.length} questions`,
      groupKey,
      count: group.length,
    });
  }
  for (const a of standalone) {
    rows.push({
      key: `ask:${a.id}`,
      kind: kindForAsk(a.kind),
      shape: 'single',
      ref: { kind: 'ask', id: a.id },
      title: a.title,
      subline: [a.agentSlug ? `asked by ${a.agentSlug}` : null, a.teamSlug ? `team ${a.teamSlug}` : null].filter(Boolean).join(' › ') || undefined,
      agentSlug: a.agentSlug,
      teamSlug: a.teamSlug,
      risk: a.risk,
      status: a.status,
      at: a.createdAt,
      href: inboxHref('ask', a.id),
      askId: a.id,
    });
  }
  return rows;
}

/**
 * Everything on the OPEN tab: asks, described + grouped proposals, paused or
 * awaiting-review missions and workflows, waiting / failed worker runs,
 * suggested rules.
 * @param orgId
 */
async function openItems(orgId: string): Promise<InboxItem[]> {
  const since = new Date(Date.now() - RECENT_FAILURE_WINDOW_MS);
  const [asks, actions, missions, workflows, waitingWorkers, failedWorkers, candidates] = await Promise.all([
    db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'))).orderBy(desc(askSchema.id)),
    listReviewRows(orgId, 'open'),
    db
      .select({ id: missionRunSchema.id, title: missionRunSchema.title, status: missionRunSchema.status, pauseReason: missionRunSchema.pauseReason, pausedAt: missionRunSchema.pausedAt, at: missionRunSchema.updatedAt, team: missionRunSchema.team })
      .from(missionRunSchema)
      .where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.status, ['paused', 'awaiting_review']))),
    db
      .select({ id: workflowRunSchema.id, status: workflowRunSchema.status, pauseReason: workflowRunSchema.pauseReason, pausedAt: workflowRunSchema.pausedAt, at: workflowRunSchema.updatedAt, slug: workflowSchema.slug, name: workflowSchema.name })
      .from(workflowRunSchema)
      .leftJoin(workflowSchema, eq(workflowSchema.id, workflowRunSchema.workflowId))
      .where(and(eq(workflowRunSchema.orgId, orgId), eq(workflowRunSchema.status, 'paused'))),
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
    ...proposalItems(actions, 'open'),
    ...missions.map((m): InboxItem => ({
      key: `mission:${m.id}`,
      kind: 'run',
      shape: 'single',
      ref: { kind: 'mission', id: m.id },
      title: m.title,
      subline: m.pauseReason ?? (m.status === 'awaiting_review' ? 'Mission run awaiting review' : 'Mission run paused'),
      agentSlug: m.team?.lead ?? null,
      teamSlug: null,
      risk: null,
      status: m.status,
      at: m.pausedAt ?? m.at,
      href: inboxHref('mission', m.id),
    })),
    ...workflows.map((w): InboxItem => ({
      key: `workflow:${w.id}`,
      kind: 'run',
      shape: 'single',
      ref: { kind: 'workflow', id: w.id },
      title: `${w.name ?? w.slug ?? 'Workflow'} — run #${w.id}`,
      subline: w.pauseReason ?? 'Workflow paused at an approval gate',
      agentSlug: null,
      teamSlug: null,
      risk: null,
      status: w.status,
      at: w.pausedAt ?? w.at,
      href: inboxHref('workflow', w.id),
    })),
    ...waitingWorkers.map((w): InboxItem => ({
      key: `worker:${w.id}`,
      kind: 'run',
      shape: 'single',
      ref: { kind: 'worker', id: w.id },
      title: `${w.agentSlug} — worker run #${w.id}`,
      subline: w.status === 'paused' ? 'External worker paused' : 'External worker awaiting review',
      agentSlug: w.agentSlug,
      teamSlug: null,
      risk: null,
      status: w.status,
      at: w.at,
      href: inboxHref('worker', w.id),
    })),
    ...failedWorkers.map((w): InboxItem => ({
      key: `worker:${w.id}`,
      kind: 'run',
      shape: 'single',
      ref: { kind: 'worker', id: w.id },
      title: `${w.agentSlug} — worker run #${w.id} ${w.status}`,
      subline: w.error ?? (w.status === 'lost' ? 'Lease lapsed without a heartbeat' : 'Run failed'),
      agentSlug: w.agentSlug,
      teamSlug: null,
      risk: 'medium',
      status: w.status,
      at: w.at,
      href: inboxHref('worker', w.id),
    })),
    ...candidates.map((c): InboxItem => ({
      key: `learning:${c.id}`,
      kind: 'learning',
      shape: 'single',
      ref: { kind: 'learning', id: c.id },
      title: c.editedRuleText ?? c.ruleText,
      subline: `Suggested rule for ${c.stepName}`,
      agentSlug: null,
      teamSlug: null,
      risk: null,
      status: 'pending',
      at: c.at,
      href: inboxHref('learning', c.id),
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
    kind: kindForAsk(a.kind),
    shape: 'single',
    ref: { kind: 'ask', id: a.id },
    title: a.title,
    subline: a.agentSlug ? `asked by ${a.agentSlug}` : undefined,
    agentSlug: a.agentSlug,
    teamSlug: a.teamSlug,
    risk: a.risk,
    status: a.status,
    at: a.decidedAt ?? a.updatedAt,
    href: inboxHref('ask', a.id),
    askId: a.id,
    decision: a.decision ?? a.status,
    decidedBy: a.decidedBy,
    note: a.decisionNote,
  }));
}

/**
 * Adopted or rejected rule candidates, as rows for the decided tab.
 * @param orgId
 * @param limit
 */
async function decidedLearningItems(orgId: string, limit = 200): Promise<InboxItem[]> {
  const rows = await db
    .select()
    .from(learningCandidateSchema)
    .where(and(eq(learningCandidateSchema.orgId, orgId), inArray(learningCandidateSchema.status, ['approved', 'rejected'])))
    .orderBy(desc(learningCandidateSchema.decidedAt))
    .limit(limit);
  return rows.map((c): InboxItem => ({
    key: `learning:${c.id}`,
    kind: 'learning',
    shape: 'single',
    ref: { kind: 'learning', id: c.id },
    title: c.editedRuleText ?? c.ruleText,
    subline: `Suggested rule for ${c.stepName}`,
    agentSlug: null,
    teamSlug: null,
    risk: null,
    status: c.status,
    at: c.decidedAt ?? c.updatedAt,
    href: inboxHref('learning', c.id),
    decision: c.status === 'approved' ? 'adopted' : 'rejected',
    decidedBy: c.decidedBy,
    note: c.rejectedReason,
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
function sortItems<T extends { at: Date; amount?: number | null; confidence?: number | null }>(items: T[], sort: InboxSort): T[] {
  const oldest = (a: T, b: T) => a.at.getTime() - b.at.getTime();
  const byNumber = (pick: (i: T) => number | null | undefined) => (a: T, b: T) => {
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
 * Search, action-kind and agent filters — everything except the kind chips,
 * which are applied after the counts are taken.
 * @param items
 * @param query
 */
function narrow(items: InboxItem[], query: InboxQuery): InboxItem[] {
  let out = items;
  if (query.actionKinds && query.actionKinds.length > 0) {
    out = out.filter(i => i.actionId && query.actionKinds!.includes(i.actionId));
  }
  if (query.agents && query.agents.length > 0) {
    out = out.filter(i => i.agentSlug && query.agents!.includes(i.agentSlug));
  }
  if (query.q) {
    out = search(out, query.q);
  }
  return out;
}

/**
 * The inbox for one tab, searched, filtered and sorted. The default is the
 * open tab, every kind, oldest first — a queue, not a feed.
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
  const [open, snoozedRows, decidedRows, decidedAsks, decidedRules] = await Promise.all([
    openItems(orgId),
    listReviewRows(orgId, 'snoozed'),
    listReviewRows(orgId, 'decided'),
    decidedAskItems(orgId),
    decidedLearningItems(orgId),
  ]);
  const snoozed = proposalItems(snoozedRows, 'snoozed');
  const decided = [...proposalItems(decidedRows, 'decided'), ...decidedAsks, ...decidedRules];
  const tabs: Record<InboxTab, number> = { open: open.length, snoozed: snoozed.length, decided: decided.length };

  const all = tab === 'open' ? open : tab === 'snoozed' ? snoozed : decided;
  const facets = facetsOf(all);
  let items = narrow(all, query);

  const counts = Object.fromEntries(INBOX_KINDS.map(k => [k, 0])) as Record<InboxKind, number>;
  for (const item of items) {
    counts[item.kind] += 1;
  }
  if (query.kinds && query.kinds.length > 0) {
    items = items.filter(i => query.kinds!.includes(i.kind));
  }
  sortItems(items, tab === 'decided' ? (query.sort ?? 'newest') : (query.sort ?? 'oldest'));

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

/** One proposal in the working queue — what the detail page's Up-next walks. */
export type ProposalQueueEntry = { id: number; title: string; typeLabel: string; actionId: string };

/**
 * The open proposals, one per run, in the order the list shows them under
 * the same filters — so the detail page's Up-next and `j`/`k` walk the
 * filtered inbox, not a separate queue. Sheets are flattened into their rows,
 * oldest first within the sheet.
 * @param orgId
 * @param query - The list's filters; `kinds` and `tab` are ignored (this is the proposal kind, open tab).
 */
export async function listProposalQueue(orgId: string, query: InboxQuery = {}): Promise<ProposalQueueEntry[]> {
  const rows = await listReviewRows(orgId, 'open');
  const items = narrow(proposalItems(rows, 'open'), query);
  sortItems(items, query.sort ?? 'oldest');
  const byId = new Map(rows.map(r => [r.id, r]));
  const out: ProposalQueueEntry[] = [];
  for (const item of items) {
    const members = item.shape === 'sheet'
      ? rows.filter(r => recordKeyOf(r) === item.groupKey).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      : [byId.get(item.reviewId!)!];
    for (const r of members) {
      out.push({ id: r.id, title: r.described.title, typeLabel: humaniseActionId(r.actionId), actionId: r.actionId });
    }
  }
  return out;
}

/**
 * How many rows the open tab shows — the sidebar badge. A decision sheet (asks
 * under one key, proposals about one record) counts once, as on the page.
 * @param orgId
 */
export async function needsYouCount(orgId: string): Promise<number> {
  const since = new Date(Date.now() - RECENT_FAILURE_WINDOW_MS);
  const count = (where: ReturnType<typeof and>, table: typeof missionRunSchema | typeof workerRunSchema | typeof learningCandidateSchema | typeof workflowRunSchema) =>
    db.select({ n: sql<number>`count(*)::int` }).from(table).where(where).then(([r]) => r?.n ?? 0);

  const [asks, actions, missions, workflows, workers, failed, candidates] = await Promise.all([
    db.select({ n: sql<number>`count(distinct coalesce(${askSchema.groupKey}, ${askSchema.id}::text))::int` })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open')))
      .then(([r]) => r?.n ?? 0),
    listReviewRows(orgId, 'open').then(rows => groupByRecord(rows).length),
    count(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.status, ['paused', 'awaiting_review'])), missionRunSchema),
    count(and(eq(workflowRunSchema.orgId, orgId), eq(workflowRunSchema.status, 'paused')), workflowRunSchema),
    count(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['paused', 'awaiting_review'])), workerRunSchema),
    count(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['failed', 'lost']), gte(workerRunSchema.updatedAt, since)), workerRunSchema),
    count(and(eq(learningCandidateSchema.orgId, orgId), eq(learningCandidateSchema.status, 'pending')), learningCandidateSchema),
  ]);
  return asks + actions + missions + workflows + workers + failed + candidates;
}
