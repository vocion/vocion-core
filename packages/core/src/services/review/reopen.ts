/**
 * Reopen a rejected action run: back to `pending`, in the queue and decidable
 * again. The rule for which runs qualify is `libs/actions/reopen.ts`; this
 * module does the writes.
 */

import type { ReopenRecord } from '@/libs/actions/reopen';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getAction } from '@/libs/actions/registry';
import { reopenRefusal, withReopenRecord } from '@/libs/actions/reopen';
import { db } from '@/libs/DB';
import { actionRunSchema, reviewAssignmentSchema } from '@/models/Schema';
import { ActionError } from '@/services/ActionService';

/** What a reopen did, for the caller. */
export type ReopenOutcome = { id: number; status: 'pending'; reopenedBy: string; reopenedAt: string };

type RejectedRun = typeof actionRunSchema.$inferSelect;

/**
 * The queue overlay row of this run: where a reviewer's note lives.
 * @param orgId - Org that owns the run.
 * @param runId - The action run.
 */
const assignmentOf = (orgId: string, runId: number) => and(
  eq(reviewAssignmentSchema.orgId, orgId),
  eq(reviewAssignmentSchema.kind, 'action'),
  eq(reviewAssignmentSchema.runId, runId),
);

/**
 * Refuse when the same record was proposed again and that newer run is open.
 * @param run - The rejected run.
 * @param orgId - Org that owns it.
 */
async function assertNotSuperseded(run: RejectedRun, orgId: string): Promise<void> {
  if (!run.dedupKey) {
    return;
  }
  const [open] = await db
    .select({ id: actionRunSchema.id })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, run.actionId),
      eq(actionRunSchema.dedupKey, run.dedupKey),
      inArray(actionRunSchema.status, ['pending', 'failed']),
      ne(actionRunSchema.id, run.id),
    ))
    .limit(1);
  if (open) {
    throw new ActionError('SUPERSEDED', `action_run ${run.id} was proposed again as action_run ${open.id}, which is still open — decide that one`);
  }
}

/**
 * Move the run to the pending shape and take the item's note off the queue,
 * in one transaction. The note was written for the decision being taken back
 * (a reject's note lands on the assignment), so it moves into the reopen
 * record instead of reading as current. Conditional on `rejected`, so two
 * concurrent reopens move the run once. Returns the note it cleared, or
 * `undefined` when the run was no longer rejected.
 * @param run - The rejected run, as read before the move.
 * @param orgId - Org that owns it.
 * @param record - This reopen, appended to the proposal envelope.
 */
async function moveToPending(run: RejectedRun, orgId: string, record: ReopenRecord): Promise<{ priorNote: string | null } | undefined> {
  return db.transaction(async (tx) => {
    const [assignment] = await tx.select({ note: reviewAssignmentSchema.note }).from(reviewAssignmentSchema).where(assignmentOf(orgId, run.id)).limit(1);
    const priorNote = assignment?.note ?? null;
    const [moved] = await tx
      .update(actionRunSchema)
      .set({
        status: 'pending',
        error: null,
        executedAt: null,
        decidedBy: null,
        decidedAt: null,
        // Undecided again: the three-state column goes back to "nobody has decided".
        approvedByAgent: null,
        proposal: withReopenRecord(run.proposal, priorNote === null ? record : { ...record, priorNote }) as never,
      })
      .where(and(eq(actionRunSchema.id, run.id), eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'rejected')))
      .returning({ id: actionRunSchema.id });
    if (!moved) {
      return undefined;
    }
    if (priorNote !== null) {
      await tx.update(reviewAssignmentSchema).set({ note: null }).where(assignmentOf(orgId, run.id));
    }
    return { priorNote };
  });
}

/**
 * Put the run (and its note) back exactly as the reject left it, but only
 * while it is still the undecided run this reopen made: a decision that
 * landed in between stands. Returns whether it was put back.
 * @param run - The rejected run, as read before the move.
 * @param orgId - Org that owns it.
 * @param priorNote - The note the move took off the item, put back with it.
 */
async function restoreRejected(run: RejectedRun, orgId: string, priorNote: string | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [restored] = await tx
      .update(actionRunSchema)
      .set({
        status: 'rejected',
        error: run.error,
        executedAt: run.executedAt,
        decidedBy: run.decidedBy,
        decidedAt: run.decidedAt,
        approvedByAgent: run.approvedByAgent,
        proposal: run.proposal as never,
      })
      .where(and(
        eq(actionRunSchema.id, run.id),
        eq(actionRunSchema.orgId, orgId),
        eq(actionRunSchema.status, 'pending'),
        isNull(actionRunSchema.decidedBy),
      ))
      .returning({ id: actionRunSchema.id });
    if (restored && priorNote !== null) {
      await tx.update(reviewAssignmentSchema).set({ note: priorNote }).where(and(assignmentOf(orgId, run.id), isNull(reviewAssignmentSchema.note)));
    }
    return restored !== undefined;
  });
}

/**
 * Put a person's rejection back. Throws `ActionError` with `NOT_FOUND` (no
 * such run in this org), `INVALID_STATE` (not rejected, including a second
 * reopen), `NOT_REOPENABLE` (see `reopenRefusal`), `SUPERSEDED` (a newer open
 * run holds the same dedup key) or `REOPEN_FAILED` (the action's hook threw;
 * the run is left rejected, unless someone decided it in the meantime).
 * @param runId - The rejected run.
 * @param orgId - Org that owns it; another org's run is NOT_FOUND.
 * @param opts - Who is reopening.
 * @param opts.by - Stamped on the run's reopen record.
 */
export async function reopenAction(runId: number, orgId: string, opts: { by: string }): Promise<ReopenOutcome> {
  const [run] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId))).limit(1);
  if (!run) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  const action = getAction(run.actionId);
  const now = new Date();
  const refusal = reopenRefusal(runId, run, action, now);
  if (refusal) {
    throw new ActionError(refusal.code, refusal.message);
  }
  // Since the reject, the same record may have been proposed again as a new
  // open run. Two open runs on one key would split the record in the queue.
  await assertNotSuperseded(run, orgId);

  const record: ReopenRecord = {
    by: opts.by,
    at: now.toISOString(),
    rejectedBy: run.decidedBy,
    rejectedAt: run.decidedAt?.toISOString() ?? null,
    rejectedReason: run.error,
  };
  const moved = await moveToPending(run, orgId, record);
  if (!moved) {
    throw new ActionError('INVALID_STATE', `action_run ${runId} is no longer rejected — only a rejected run can be reopened`);
  }

  try {
    await action?.onReopened?.({ orgId, invokedBy: run.invokedBy ?? undefined, reviewedBy: opts.by }, run.input, runId);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    const restored = await restoreRejected(run, orgId, moved.priorNote);
    throw new ActionError('REOPEN_FAILED', restored ? why : `${why} — the run was decided while it reopened, and that decision stands`);
  }

  return { id: runId, status: 'pending', reopenedBy: opts.by, reopenedAt: record.at };
}
