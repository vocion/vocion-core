import type { ActionDescription } from './describeActionRun';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getAction } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { actionRunSchema, reviewAssignmentSchema } from '@/models/Schema';
import { resolveRecordLabels } from '@/services/records/recordLabel';
import { describeActionRun } from './describeActionRun';
import { recordKeyOf } from './recordKey';

/**
 * The action plane of the review queue, read for the inbox: every column the
 * row needs (the payload, the proposal, the real `created_at`, the decision)
 * rather than the thin `ReviewItem` the queue polls with — and described for
 * a person by `describeActionRun`.
 *
 * Three tabs, three predicates:
 *   open     — pending or failed, not expired, not snoozed into the future
 *   snoozed  — pending, snoozed into the future
 *   decided  — done / rejected / executing / approved, newest decision first
 */

export type ReviewTab = 'open' | 'snoozed' | 'decided';

export type ReviewRow = {
  id: number;
  actionId: string;
  status: string;
  /** When it started waiting. */
  createdAt: Date;
  /** When a person answered (decided tab). */
  decidedAt: Date | null;
  decidedBy: string | null;
  /** The ladder released it without a person — "done for you". */
  approvedByAgent?: boolean;
  /** A done run of a kind that declares `undo`: one click puts it back. */
  undoable?: boolean;
  snoozedUntil: Date | null;
  note: string | null;
  assignedTo: string | null;
  input: Record<string, unknown>;
  proposal: Record<string, unknown> | null;
  described: ActionDescription;
};

const DECIDED_STATUSES = ['done', 'rejected', 'executing', 'approved', 'undone'];

/**
 * Action-plane rows for one tab. `limit` bounds the decided tab, which is
 * history and grows without end; the open and snoozed tabs return everything,
 * because the inbox groups and sorts them in memory and a hidden row is a
 * decision that never gets made.
 * @param orgId
 * @param tab
 * @param opts
 * @param opts.limit
 * @param opts.now
 */
export async function listReviewRows(orgId: string, tab: ReviewTab, opts: { limit?: number; now?: Date } = {}): Promise<ReviewRow[]> {
  const now = opts.now ?? new Date();
  const join = and(
    eq(reviewAssignmentSchema.orgId, orgId),
    eq(reviewAssignmentSchema.kind, 'action'),
    eq(reviewAssignmentSchema.runId, actionRunSchema.id),
  );
  const notExpired = or(isNull(actionRunSchema.expiresAt), gt(actionRunSchema.expiresAt, now));
  const where = tab === 'decided'
    ? and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.status, DECIDED_STATUSES))
    : tab === 'snoozed'
      ? and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'), notExpired, gt(reviewAssignmentSchema.snoozedUntil, now))
      : and(
          eq(actionRunSchema.orgId, orgId),
          inArray(actionRunSchema.status, ['pending', 'failed']),
          notExpired,
          or(isNull(reviewAssignmentSchema.snoozedUntil), lte(reviewAssignmentSchema.snoozedUntil, now)),
        );

  const query = db
    .select({
      id: actionRunSchema.id,
      actionId: actionRunSchema.actionId,
      status: actionRunSchema.status,
      input: actionRunSchema.input,
      proposal: actionRunSchema.proposal,
      invokedBy: actionRunSchema.invokedBy,
      createdAt: actionRunSchema.createdAt,
      executedAt: actionRunSchema.executedAt,
      decidedAt: actionRunSchema.decidedAt,
      decidedBy: actionRunSchema.decidedBy,
      approvedByAgent: actionRunSchema.approvedByAgent,
      snoozedUntil: reviewAssignmentSchema.snoozedUntil,
      note: reviewAssignmentSchema.note,
      assignedTo: reviewAssignmentSchema.assignedTo,
    })
    .from(actionRunSchema)
    .leftJoin(reviewAssignmentSchema, join)
    .where(where)
    .orderBy(tab === 'decided' ? desc(sql`coalesce(${actionRunSchema.decidedAt}, ${actionRunSchema.executedAt}, ${actionRunSchema.createdAt})`) : desc(actionRunSchema.id));
  const rows = tab === 'decided' ? await query.limit(opts.limit ?? 200) : await query;

  const described = rows.map(row => ({
    id: row.id,
    actionId: row.actionId,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? row.executedAt ?? null,
    decidedBy: row.decidedBy ?? null,
    approvedByAgent: row.approvedByAgent === true,
    undoable: row.status === 'done' && getAction(row.actionId)?.undo !== undefined,
    snoozedUntil: row.snoozedUntil ?? null,
    note: row.note ?? null,
    assignedTo: row.assignedTo ?? null,
    input: row.input ?? {},
    proposal: (row.proposal as Record<string, unknown> | null) ?? null,
    invokedBy: row.invokedBy,
  }));
  return withRecordNames(orgId, described);
}

/** A row before it has been described — everything a describer reads. */
type RawRow = Omit<ReviewRow, 'described'> & { invokedBy: string | null };

function describe(row: RawRow, opts?: Parameters<typeof describeActionRun>[1]): ReviewRow {
  const { invokedBy, ...rest } = row;
  return { ...rest, described: describeActionRun({ id: row.id, actionId: row.actionId, input: row.input, proposal: row.proposal as never, invokedBy }, opts) };
}

/**
 * Describe every row, giving the ones whose record is still a bare id the
 * name the CRM mirror holds for it — one query for the whole page.
 *
 * `describeActionRun` stays pure over the payload, because the payload is
 * what the agent proposed and nothing more. Naming the record is a read of
 * what the workspace already knows, so it happens here, once, where the org
 * is in scope. A record the mirror cannot name keeps `fromId` and says "name
 * not synced" rather than showing the id as if it were a name.
 * @param orgId
 * @param rows
 */
async function withRecordNames(orgId: string, rows: RawRow[]): Promise<ReviewRow[]> {
  const first = rows.map(row => describe(row));
  const unnamed = first.filter(r => r.described.record?.fromId === true).map(r => r.described.record!.key);
  if (unnamed.length === 0) {
    return first;
  }
  const recordNames = await resolveRecordLabels(orgId, unnamed);
  return recordNames.size === 0 ? first : rows.map(row => describe(row, { recordNames }));
}

/** Rows that are about the same record, in one sheet. */
export type ReviewGroup = {
  key: string;
  record: ActionDescription['record'];
  rows: ReviewRow[];
};

/**
 * Collapse rows sharing a record key into groups, preserving first-seen
 * order. A row with no record (the fallback describer) is its own group,
 * keyed on the run id, so it is never lumped in with strangers.
 * @param rows
 */
export function groupByRecord(rows: ReviewRow[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const row of rows) {
    const key = recordKeyOf(row);
    const g = groups.get(key);
    if (g) {
      g.rows.push(row);
    } else {
      groups.set(key, { key, record: row.described.record, rows: [row] });
    }
  }
  return [...groups.values()];
}

/**
 * The rows for one record key — the decision sheet's contents. Open rows
 * first (what to answer), decided rows after (the record).
 * @param orgId
 * @param recordKey
 */
export async function listReviewRowsForRecord(orgId: string, recordKey: string): Promise<{ open: ReviewRow[]; decided: ReviewRow[] }> {
  const [open, decided] = await Promise.all([listReviewRows(orgId, 'open'), listReviewRows(orgId, 'decided', { limit: 500 })]);
  const match = (r: ReviewRow) => recordKeyOf(r) === recordKey;
  return { open: open.filter(match), decided: decided.filter(match) };
}

/**
 * One action-plane row by id, described — for a surface that holds a run id
 * and needs the row's context.
 * @param orgId
 * @param id
 */
export async function reviewRowById(orgId: string, id: number): Promise<ReviewRow | null> {
  const [row] = await db
    .select({
      id: actionRunSchema.id,
      actionId: actionRunSchema.actionId,
      status: actionRunSchema.status,
      input: actionRunSchema.input,
      proposal: actionRunSchema.proposal,
      invokedBy: actionRunSchema.invokedBy,
      createdAt: actionRunSchema.createdAt,
      executedAt: actionRunSchema.executedAt,
      decidedAt: actionRunSchema.decidedAt,
      decidedBy: actionRunSchema.decidedBy,
    })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, id)))
    .limit(1);
  if (!row) {
    return null;
  }
  const [described] = await withRecordNames(orgId, [{
    id: row.id,
    actionId: row.actionId,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? row.executedAt ?? null,
    decidedBy: row.decidedBy ?? null,
    snoozedUntil: null,
    note: null,
    assignedTo: null,
    input: row.input ?? {},
    proposal: (row.proposal as Record<string, unknown> | null) ?? null,
    invokedBy: row.invokedBy,
  }]);
  return described ?? null;
}
