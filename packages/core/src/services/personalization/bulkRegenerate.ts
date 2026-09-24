import type { BulkLeadOutcome } from '@/models/Schema';
/**
 * Bulk brief regeneration (Metacto ticket 071).
 *
 * A reviewer picks the leads the queue shows and asks for their briefs to be
 * written again with one note. Each is a full agent pass, so the work is a
 * Temporal workflow that walks the leads two at a time on the worker; this
 * module owns the job ROW that the person watches while it runs and that
 * remains afterwards, and the guards on what may enter a job at all.
 *
 * Only the Review lane is accepted. A brief regenerate on a lead in Hand off
 * or Sent resets it to queued, files a NEW card for a contact who is already
 * receiving emails, and an approve on that card would replace the live
 * enrollment (`personalization-enroll.ts` unenrolls first). Refused by name.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { getTemporalClient, VOCION_WORKFLOWS_TASK_QUEUE } from '@/libs/temporal/client';
import { leadBriefSchema, personalizationBulkJobSchema } from '@/models/Schema';
import { REVIEW_STATUS } from '@/services/PersonalizationQueueService';

export const BULK_BRIEF_REGENERATE_WORKFLOW = 'bulkBriefRegenerate';

export type StartBulkResult
  = | { ok: true; jobId: number; total: number }
    | { ok: false; reason: 'empty' | 'not_in_review' | 'queue_unreachable'; message: string; refused?: Array<{ id: number; contactName: string; status: string }> };

export function bulkWorkflowIdFor(orgId: string, jobId: number): string {
  return `bulk-brief-regenerate:${orgId}:${jobId}`;
}

/**
 * Create the job and start its workflow. Nothing is reset here: each lead is
 * reset by its own activity, so a job that cannot start changes nothing.
 * @param orgId
 * @param opts
 * @param opts.leadIds - The leads, as the queue showed them.
 * @param opts.note - The reviewer's one instruction, required.
 * @param opts.by - Who asked.
 */
export async function startBulkBriefRegenerate(orgId: string, opts: { leadIds: number[]; note: string; by: string }): Promise<StartBulkResult> {
  const ids = [...new Set(opts.leadIds.filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) {
    return { ok: false, reason: 'empty', message: 'No leads were named.' };
  }
  const rows = await db
    .select({ id: leadBriefSchema.id, contactName: leadBriefSchema.contactName, status: leadBriefSchema.status })
    .from(leadBriefSchema)
    .where(and(eq(leadBriefSchema.orgId, orgId), inArray(leadBriefSchema.id, ids)));
  const found = new Map(rows.map(r => [r.id, r]));
  const missing = ids.filter(id => !found.has(id));
  const refused = rows.filter(r => r.status !== REVIEW_STATUS).map(r => ({ id: r.id, contactName: r.contactName, status: r.status }));
  if (missing.length > 0 || refused.length > 0) {
    const names = refused.slice(0, 5).map(r => `${r.contactName} (${r.status.replace(/_/g, ' ')})`).join(', ');
    return {
      ok: false,
      reason: 'not_in_review',
      message: refused.length > 0
        ? `Only leads waiting in Review can be regenerated in bulk. ${refused.length} of these ${refused.length === 1 ? 'is' : 'are'} not: ${names}${refused.length > 5 ? ', …' : ''}.`
        : `${missing.length} of these leads ${missing.length === 1 ? 'is' : 'are'} not on this workspace's queue.`,
      refused,
    };
  }

  const [job] = await db
    .insert(personalizationBulkJobSchema)
    .values({
      orgId,
      kind: 'regenerate_brief',
      note: opts.note,
      leadIds: ids,
      total: ids.length,
      status: 'queued',
      outcomes: ids.map(id => ({ leadId: id, contactName: found.get(id)?.contactName ?? null, state: 'queued' as const })),
      createdBy: opts.by,
    })
    .returning({ id: personalizationBulkJobSchema.id });
  const jobId = job!.id;
  const workflowId = bulkWorkflowIdFor(orgId, jobId);

  try {
    const client = await getTemporalClient();
    await client.workflow.start(BULK_BRIEF_REGENERATE_WORKFLOW, {
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      workflowId,
      args: [{ orgId, jobId, leadIds: ids, note: opts.note, by: opts.by }],
    });
  } catch (err) {
    // The row must not outlive a workflow that never started: a job page
    // showing "queued" forever would be a promise nothing is keeping.
    await db.delete(personalizationBulkJobSchema).where(eq(personalizationBulkJobSchema.id, jobId)).catch(() => {});
    const { logger } = await import('@/libs/Logger');
    logger.warn('bulk brief regenerate could not start its workflow', { orgId, jobId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, reason: 'queue_unreachable', message: 'The work queue could not be reached, so nothing was changed. Try again in a minute.' };
  }
  await db.update(personalizationBulkJobSchema).set({ workflowId, updatedAt: new Date() }).where(eq(personalizationBulkJobSchema.id, jobId));
  return { ok: true, jobId, total: ids.length };
}

export type BulkJob = typeof personalizationBulkJobSchema.$inferSelect;

export async function getBulkJob(orgId: string, jobId: number): Promise<BulkJob | null> {
  const [row] = await db
    .select()
    .from(personalizationBulkJobSchema)
    .where(and(eq(personalizationBulkJobSchema.orgId, orgId), eq(personalizationBulkJobSchema.id, jobId)))
    .limit(1);
  return row ?? null;
}

export async function markBulkJobRunning(orgId: string, jobId: number): Promise<void> {
  await db
    .update(personalizationBulkJobSchema)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(personalizationBulkJobSchema.orgId, orgId), eq(personalizationBulkJobSchema.id, jobId), eq(personalizationBulkJobSchema.status, 'queued')));
}

/**
 * Write one lead's outcome and recompute the counters from the list, so a
 * lead Temporal retried after a recorded failure counts once, as whatever it
 * ended as. Marks the job done when every lead has settled.
 * @param orgId
 * @param jobId
 * @param outcome
 */
export async function recordBulkLeadOutcome(orgId: string, jobId: number, outcome: Omit<BulkLeadOutcome, 'at'>): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ outcomes: personalizationBulkJobSchema.outcomes, total: personalizationBulkJobSchema.total })
      .from(personalizationBulkJobSchema)
      .where(and(eq(personalizationBulkJobSchema.orgId, orgId), eq(personalizationBulkJobSchema.id, jobId)))
      .limit(1)
      .for('update');
    if (!row) {
      return;
    }
    const at = new Date().toISOString();
    // A fresh entry, not a merge: a lead that failed and then landed on
    // Temporal's retry must not keep the failure's reason beside "landed".
    const settled = (prior?: BulkLeadOutcome): BulkLeadOutcome => ({
      leadId: outcome.leadId,
      contactName: outcome.contactName ?? prior?.contactName ?? null,
      state: outcome.state,
      ...(outcome.error ? { error: outcome.error } : {}),
      at,
    });
    const next = row.outcomes.some(o => o.leadId === outcome.leadId)
      ? row.outcomes.map(o => (o.leadId === outcome.leadId ? settled(o) : o))
      : [...row.outcomes, settled()];
    const done = next.filter(o => o.state === 'landed').length;
    const failed = next.filter(o => o.state === 'failed').length;
    await tx
      .update(personalizationBulkJobSchema)
      .set({ outcomes: next, done, failed, status: done + failed >= row.total ? 'done' : 'running', updatedAt: new Date() })
      .where(and(eq(personalizationBulkJobSchema.orgId, orgId), eq(personalizationBulkJobSchema.id, jobId)));
  });
}

export async function finishBulkJob(orgId: string, jobId: number): Promise<void> {
  await db
    .update(personalizationBulkJobSchema)
    .set({ status: 'done', updatedAt: new Date() })
    .where(and(eq(personalizationBulkJobSchema.orgId, orgId), eq(personalizationBulkJobSchema.id, jobId)));
}
