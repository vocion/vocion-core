import type { Grounds } from '@/services/inbox/admissionBar';
import type { AutonomyHold, AutonomyProposal, SettledJudgment } from '@/services/inbox/autonomyProposal';
import type { DecisionContract } from '@/services/inbox/decisionContract';
import type { FailedRun } from '@/services/inbox/failureEscalation';
import type { InboxRef } from '@/services/inbox/inboxRef';
import type { InboxKind, InboxSort, InboxTab } from '@/services/inbox/kinds';
import type { AgendaCandidate, PolicyGap, Reclassified } from '@/services/inbox/reviewAgenda';
import type { ReviewRow } from '@/services/inbox/reviewRows';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema, learningCandidateSchema, missionRunSchema, workerRunSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';
import { admit } from '@/services/inbox/admissionBar';
import { autonomyProposals } from '@/services/inbox/autonomyProposal';
import { changeSummaryLine, summariseChanges } from '@/services/inbox/changeSummary';
import { enrichmentLine } from '@/services/inbox/decisionTopic';
import { humaniseActionId, recordTitle } from '@/services/inbox/describeActionRun';
import { escalationsFrom } from '@/services/inbox/failureEscalation';
import { inboxHref } from '@/services/inbox/inboxRef';
import { INBOX_KINDS, kindForAsk } from '@/services/inbox/kinds';
import { planApprovalRows } from '@/services/inbox/planApprovalRows';
import { chainReAsks, chaseLine } from '@/services/inbox/reAskChain';
import { askGroupHref, recordKeyOf, recordSheetHref } from '@/services/inbox/recordKey';
import { reviewAgenda } from '@/services/inbox/reviewAgenda';
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
 *                   paused / awaiting-review worker run, things that WAIT on
 *                   a person
 *                                                   → /dashboard/inbox/mission-:id · workflow-:id · worker-:id
 *   exception       a failure the factory cannot recover from, as a decision
 *                   with a recommendation (`services/inbox/failureEscalation.ts`)
 *                                                   → /dashboard/inbox/worker-:id
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
  /**
   * What must be decided, what the system thinks, why, what waiting costs and
   * the labelled choices, so the ROW is decision support rather than metadata
   * about which agent asked (`services/inbox/decisionContract.ts`).
   */
  contract?: DecisionContract;
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
  /**
   * Open tab only: everything the admission bar sent somewhere other than a
   * person, with the reason. Review is auditable, not merely short.
   */
  reclassified: Reclassified<AgendaRow>[];
  /** Open tab only: standing policies that produced rows they should have absorbed. */
  policyGaps: PolicyGap[];
  /** Rows per kind on this tab — the chip counts. Counted before the kind filter, after the others. */
  counts: Record<InboxKind, number>;
  total: number;
  /** Rows per tab, before search/filter, for the tab labels. */
  tabs: Record<InboxTab, number>;
  facets: InboxFacets;
};

/**
 * How far back the escalation rule looks for failures of the same task. A
 * plain failure NEVER appears here, it is a log line, and the run record
 * and the floor already show it (Chris, 2026-09-21). This window exists only
 * so `escalationsFrom` can see a task's third attempt.
 */
const FAILURE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

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
    detail: r.status === 'awaiting_execution'
      ? `Approved${r.decidedBy ? ` by ${r.decidedBy.replace(/^agent:/, '')}` : ''} — waiting to be done by hand`
      : tab !== 'decided' && r.snoozedUntil && r.snoozedUntil > new Date() ? `Snoozed until ${r.snoozedUntil.toLocaleString()}` : undefined,
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
 * sheet, answered as a stepper; a group with one open ask is just an ask; and
 * an ask that exists only to chase an older open ask is folded into the ask it
 * chases rather than given a row of its own (`services/inbox/reAskChain.ts`).
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
  for (const chain of chainReAsks(standalone)) {
    const a = chain.root;
    const chased = chaseLine(chain);
    rows.push({
      key: `ask:${a.id}`,
      kind: kindForAsk(a.kind),
      shape: 'single',
      ref: { kind: 'ask', id: a.id },
      title: a.title,
      subline: [a.agentSlug ? `asked by ${a.agentSlug}` : null, a.teamSlug ? `team ${a.teamSlug}` : null, chased].filter(Boolean).join(' › ') || undefined,
      agentSlug: a.agentSlug,
      teamSlug: a.teamSlug,
      // Going unanswered is itself evidence of importance, so a chased
      // decision takes the highest risk anyone attached to it. The chases
      // stop being rows; they do not stop being signal.
      risk: chain.chases.some(c => c.risk === 'high') || a.risk === 'high' ? 'high' : chain.chases.some(c => c.risk === 'medium') || a.risk === 'medium' ? 'medium' : a.risk,
      status: a.status,
      at: a.createdAt,
      href: inboxHref('ask', a.id),
      askId: a.id,
      // The count is the rows this one replaced, so the page can say the
      // question was asked eight times without printing it eight times.
      count: chain.chases.length > 0 ? chain.chases.length + 1 : undefined,
    });
  }
  return rows;
}

/**
 * The failures that became decisions. A plain failed or lost run produces
 * NOTHING here: it is an operational event, and Review is not an event
 * stream. Only a task the factory cannot recover, a third attempt, or a
 * failure class with no retry policy, reaches a person, and then it arrives
 * as a decision with a recommendation, what it blocks and what happens if it
 * is ignored.
 * @param runs - Failed and lost worker runs inside the lookback window.
 */
function exceptionItems(runs: FailedRun[]): InboxItem[] {
  return escalationsFrom(runs).map((e): InboxItem => ({
    key: e.key,
    kind: 'exception',
    shape: 'single',
    ref: { kind: 'worker', id: e.runId },
    title: e.contract.decision,
    subline: [`${e.agentSlug}`, `${e.attempts} ${e.attempts === 1 ? 'attempt' : 'attempts'}`, e.trigger === 'no-retry-policy' ? 'no retry policy' : 'retries exhausted'].join(' › '),
    agentSlug: e.agentSlug,
    teamSlug: null,
    risk: 'high',
    status: 'exception',
    at: e.at,
    href: inboxHref('worker', e.runId),
    detail: e.contract.recommendation ?? e.contract.recommendationWhyNot ?? undefined,
    contract: e.contract,
  }));
}

/**
 * What a row DECLARES about itself at the admission bar, where the row's own
 * title cannot say it.
 *
 * A plan waiting for approval is a direction decision: the work does not start
 * until it is answered. A suggested rule is a policy decision by definition. An
 * exception has already been through `failureEscalation`, which only escalates
 * a failure class policy cannot resolve, and the answer sets that policy.
 *
 * Nothing here can rescue bookkeeping: `admit` checks the action-id rules
 * first, so a declaration never buys a metadata update a place in Review.
 * @param item
 */
function declaredGrounds(item: InboxItem): Grounds | null {
  if (item.key.startsWith('plan:')) {
    return 'direction';
  }
  if (item.kind === 'learning') {
    return 'policy';
  }
  if (item.kind === 'exception') {
    return 'policy';
  }
  return null;
}

/** An inbox row as the agenda sees it. */
export type AgendaRow = InboxItem & AgendaCandidate;

/**
 * Actions whose proposals are one decision PER RECORD and never fold.
 *
 * The topic fold in `services/inbox/decisionTopic.ts` reads the title, and a
 * per-lead card carries a constant one: every enroll proposal is "New MQL
 * ready to enroll", so on 2026-09-22 about two hundred leads on the revenue
 * inbox became a single row with nothing on it to say so. Each of those is a
 * separate person and a separate send, so each is its own decision, whatever
 * the title has in common with the next. They skip the agenda entirely; the
 * bar would admit them anyway (an enroll reaches HubSpot, which is
 * consequence), and skipping it keeps the fold from seeing them.
 *
 * This is the narrow fix. The durable one keys the fold on the SUBJECT a row
 * is about rather than the words in its title, at which point this set goes.
 */
const UNFOLDED_ACTIONS: ReadonlySet<string> = new Set(['personalization.enroll']);

/**
 * The open tab, after the admission bar.
 *
 * What survives is one row per DECISION, not one per thing the factory is
 * unsure about. A decision that absorbed related questions says so on the row
 * and carries them underneath; everything else is accounted for in
 * `reclassified`, so a short queue is a claim anyone can check rather than a
 * filter nobody can see behind.
 * @param rows - Every candidate row the factory produced.
 */
function admitted(rows: InboxItem[]): Pick<Inbox, 'items' | 'reclassified' | 'policyGaps'> {
  const unfolded = rows.filter(r => r.actionId !== undefined && UNFOLDED_ACTIONS.has(r.actionId));
  const agenda = reviewAgenda(rows.filter(r => !unfolded.includes(r)).map((item): AgendaRow => ({
    ...item,
    body: item.detail ?? item.subline ?? null,
    grounds: declaredGrounds(item),
  })));

  const items = agenda.entries.map(({ topic }) => {
    const folded = topic.members.length - 1 + topic.enrichments.length;
    return {
      ...topic.root,
      // The count is what this one row replaced. It is the same promise the
      // re-ask chain makes, one level up: the question is asked once.
      ...(folded > 0 ? { count: (topic.root.count ?? 1) + folded, detail: enrichmentLine(topic) ?? topic.root.detail } : {}),
    };
  });
  return { items: [...items, ...unfolded], reclassified: agenda.reclassified, policyGaps: agenda.policyGaps };
}

/**
 * Everything on the OPEN tab: asks, described + grouped proposals, paused or
 * awaiting-review missions and workflows, waiting worker runs, unrecoverable
 * failures as exceptions, suggested rules.
 * @param orgId
 */
async function openItems(orgId: string): Promise<InboxItem[]> {
  const since = new Date(Date.now() - FAILURE_LOOKBACK_MS);
  const [asks, actions, missions, workflows, waitingWorkers, failures, candidates] = await Promise.all([
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
      .select({ id: workerRunSchema.id, agentSlug: workerRunSchema.agentSlug, status: workerRunSchema.status, error: workerRunSchema.error, attempt: workerRunSchema.attempt, input: workerRunSchema.input, at: workerRunSchema.updatedAt })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['failed', 'lost']), gte(workerRunSchema.updatedAt, since))),
    db
      .select({ id: learningCandidateSchema.id, stepName: learningCandidateSchema.stepName, ruleText: learningCandidateSchema.ruleText, editedRuleText: learningCandidateSchema.editedRuleText, at: learningCandidateSchema.createdAt })
      .from(learningCandidateSchema)
      .where(and(eq(learningCandidateSchema.orgId, orgId), eq(learningCandidateSchema.status, 'pending'))),
  ]);

  const plans = await planApprovalRows(orgId);

  return [
    ...askItems(asks),
    ...proposalItems(actions, 'open'),
    ...plans,
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
    ...exceptionItems(failures),
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
  const [candidates, snoozedRows, decidedRows, decidedAsks, decidedRules] = await Promise.all([
    openItems(orgId),
    listReviewRows(orgId, 'snoozed'),
    listReviewRows(orgId, 'decided'),
    decidedAskItems(orgId),
    decidedLearningItems(orgId),
  ]);
  const { items: open, reclassified, policyGaps } = admitted(candidates);
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

  return { items, counts, total: items.length, tabs, facets, reclassified: tab === 'open' ? reclassified : [], policyGaps: tab === 'open' ? policyGaps : [] };
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
 * How many DECISIONS are waiting on a person: the sidebar badge.
 *
 * It is the agenda's own length, computed the same way the page computes it,
 * because a count on a badge is a promise about what is behind it. The
 * badge counted its own way once and told the truth only by coincidence; now
 * there is one definition of "needs you", and it is the admission bar.
 * @param orgId
 */
export async function needsYouCount(orgId: string): Promise<number> {
  return admitted(await openItems(orgId)).items.length;
}

/**
 * What the workforce has earned.
 *
 * After every decision the system asks itself whether the judgment was
 * reusable, and this is where it answers out loud. Three identical, unedited,
 * low-consequence decisions in a row stop being three satisfied log lines and
 * become one offer: stop asking.
 *
 * Only classes a STANDING POLICY could safely cover are eligible, and that is
 * decided by the same admission bar the queue uses: if `admit` would already
 * have delegated or resolved the class, the consequence of getting it wrong is
 * routine and reversible. Anything the bar puts in front of a person stays a
 * decision however many times it has been approved, because being right five
 * times about pricing is not a licence to change pricing unattended.
 * @param orgId
 */
export async function autonomyOffers(orgId: string): Promise<{ proposals: AutonomyProposal[]; holds: AutonomyHold[] }> {
  const [actions, asks] = await Promise.all([
    listReviewRows(orgId, 'decided'),
    db
      .select()
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), inArray(askSchema.status, ['approved', 'rejected'])))
      .orderBy(desc(askSchema.decidedAt))
      .limit(200),
  ]);

  const routine = (candidate: Parameters<typeof admit>[0]) => !admit(candidate).admitted;

  const history: SettledJudgment[] = [];
  for (const r of actions) {
    if (r.status !== 'done' && r.status !== 'approved' && r.status !== 'rejected') {
      continue;
    }
    history.push({
      class: r.actionId,
      label: `${humaniseActionId(r.actionId).toLowerCase()} actions`,
      outcome: r.status === 'rejected' ? 'rejected' : 'approved',
      // A note on a decision is a person saying "yes, but". That is a
      // judgment that has not finished being a judgment.
      edited: (r.note ?? '').trim() !== '',
      consequence: { level: routine({ kind: 'proposal', title: r.described.title, actionId: r.actionId }) ? 'low' : 'medium', reversible: r.undoable === true || r.described.amount === null },
      at: r.decidedAt ?? r.createdAt,
    });
  }
  for (const a of asks) {
    history.push({
      class: `ask:${a.kind}`,
      label: `${a.kind} questions`,
      outcome: a.status === 'rejected' ? 'rejected' : 'approved',
      edited: (a.decisionNote ?? '').trim() !== '' || a.followUp,
      consequence: { level: routine({ kind: a.kind, title: a.title, body: a.body }) ? 'low' : 'medium', reversible: a.risk !== 'high' },
      at: a.decidedAt ?? a.updatedAt,
    });
  }
  return autonomyProposals(history);
}
