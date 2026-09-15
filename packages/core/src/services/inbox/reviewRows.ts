import type { ActionDescription } from './describeActionRun';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, reviewAssignmentSchema } from '@/models/Schema';
import { describeActionRun } from './describeActionRun';

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
  snoozedUntil: Date | null;
  note: string | null;
  assignedTo: string | null;
  input: Record<string, unknown>;
  proposal: Record<string, unknown> | null;
  described: ActionDescription;
};

const DECIDED_STATUSES = ['done', 'rejected', 'executing', 'approved'];

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
      snoozedUntil: reviewAssignmentSchema.snoozedUntil,
      note: reviewAssignmentSchema.note,
      assignedTo: reviewAssignmentSchema.assignedTo,
    })
    .from(actionRunSchema)
    .leftJoin(reviewAssignmentSchema, join)
    .where(where)
    .orderBy(tab === 'decided' ? desc(sql`coalesce(${actionRunSchema.decidedAt}, ${actionRunSchema.executedAt}, ${actionRunSchema.createdAt})`) : desc(actionRunSchema.id));
  const rows = tab === 'decided' ? await query.limit(opts.limit ?? 200) : await query;

  return rows.map(row => ({
    id: row.id,
    actionId: row.actionId,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? row.executedAt ?? null,
    decidedBy: row.decidedBy ?? null,
    snoozedUntil: row.snoozedUntil ?? null,
    note: row.note ?? null,
    assignedTo: row.assignedTo ?? null,
    input: row.input ?? {},
    proposal: (row.proposal as Record<string, unknown> | null) ?? null,
    described: describeActionRun({ id: row.id, actionId: row.actionId, input: row.input ?? {}, proposal: row.proposal as never, invokedBy: row.invokedBy }),
  }));
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
    const key = row.described.record?.key ?? `run:${row.id}`;
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
  const match = (r: ReviewRow) => (r.described.record?.key ?? `run:${r.id}`) === recordKey;
  return { open: open.filter(match), decided: decided.filter(match) };
}
