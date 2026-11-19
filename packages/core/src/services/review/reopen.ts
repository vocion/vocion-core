/**
 * Reopen a rejected action run: back to `pending`, in the queue and decidable
 * again. The rule for which runs qualify is `libs/actions/reopen.ts`; this
 * module does the writes.
 */

import type { ReopenRecord } from '@/libs/actions/reopen';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { getAction } from '@/libs/actions/registry';
import { reopenRefusal, withReopenRecord } from '@/libs/actions/reopen';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';
import { ActionError } from '@/services/ActionService';

/** What a reopen did, for the caller. */
export type ReopenOutcome = { id: number; status: 'pending'; reopenedBy: string; reopenedAt: string };

/**
 * Put a person's rejection back. Throws `ActionError` with `NOT_FOUND` (no
 * such run in this org), `INVALID_STATE` (not rejected, including a second
 * reopen), `NOT_REOPENABLE` (see `reopenRefusal`), `SUPERSEDED` (a newer open
 * run holds the same dedup key) or `REOPEN_FAILED` (the action's hook threw;
 * the run is left rejected).
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
  if (run.dedupKey) {
    const [open] = await db
      .select({ id: actionRunSchema.id })
      .from(actionRunSchema)
      .where(and(
        eq(actionRunSchema.orgId, orgId),
        eq(actionRunSchema.actionId, run.actionId),
        eq(actionRunSchema.dedupKey, run.dedupKey),
        inArray(actionRunSchema.status, ['pending', 'failed']),
        ne(actionRunSchema.id, runId),
      ))
      .limit(1);
    if (open) {
      throw new ActionError('SUPERSEDED', `action_run ${runId} was proposed again as action_run ${open.id}, which is still open — decide that one`);
    }
  }

  const record: ReopenRecord = {
    by: opts.by,
    at: now.toISOString(),
    rejectedBy: run.decidedBy,
    rejectedAt: run.decidedAt?.toISOString() ?? null,
    rejectedReason: run.error,
  };
  // Conditional on `rejected`, so two concurrent reopens move it once.
  const [moved] = await db
    .update(actionRunSchema)
    .set({
      status: 'pending',
      error: null,
      executedAt: null,
      decidedBy: null,
      decidedAt: null,
      // Undecided again: the three-state column goes back to "nobody has decided".
      approvedByAgent: null,
      proposal: withReopenRecord(run.proposal, record) as never,
    })
    .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'rejected')))
    .returning({ id: actionRunSchema.id });
  if (!moved) {
    throw new ActionError('INVALID_STATE', `action_run ${runId} is no longer rejected — only a rejected run can be reopened`);
  }

  try {
    await action?.onReopened?.({ orgId, invokedBy: run.invokedBy ?? undefined, reviewedBy: opts.by }, run.input, runId);
  } catch (error) {
    // Put the run back exactly as it was, so run and record never disagree.
    await db
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
      .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)));
    throw new ActionError('REOPEN_FAILED', error instanceof Error ? error.message : String(error));
  }

  return { id: runId, status: 'pending', reopenedBy: opts.by, reopenedAt: record.at };
}
