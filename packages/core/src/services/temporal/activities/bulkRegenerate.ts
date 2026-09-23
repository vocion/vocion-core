/**
 * The per-lead step of a bulk brief regeneration (Metacto ticket 071), run on
 * the worker under Temporal: reset the brief with the note, then fire the
 * workspace's regenerate automation for that one lead and wait for the pass.
 *
 * Same two moves as the single-lead Regenerate on the lead page, with two
 * differences. The event skips the per-automation ceiling, because the
 * workflow calling this is already the pacing. And the outcome is written to
 * the job row, landed or failed with the reason, so the person watching the
 * job sees each lead settle.
 */
import { Context } from '@temporalio/activity';
import { finishBulkJob, markBulkJobRunning, recordBulkLeadOutcome } from '@/services/personalization/bulkRegenerate';

export type RegenerateLeadBriefActivityInput = { orgId: string; jobId: number; leadId: number; note: string; by: string };

const HEARTBEAT_EVERY_MS = 30_000;

export async function regenerateLeadBriefActivity(input: RegenerateLeadBriefActivityInput): Promise<{ state: 'landed' | 'failed' }> {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const ctx = Context.current();
    ctx.heartbeat('starting');
    heartbeat = setInterval(() => {
      try {
        ctx.heartbeat('running');
      } catch {
        /* the attempt is over */
      }
    }, HEARTBEAT_EVERY_MS);
  } catch {
    /* not running under Temporal (tests) */
  }
  try {
    await markBulkJobRunning(input.orgId, input.jobId);
    const { regenerateBrief } = await import('@/services/PersonalizationQueueService');
    const reset = await regenerateBrief(input.orgId, { id: input.leadId, note: input.note });
    if (!reset.regenerated) {
      // A business refusal, not an infrastructure failure: recorded, not retried.
      await recordBulkLeadOutcome(input.orgId, input.jobId, { leadId: input.leadId, contactName: null, state: 'failed', error: 'The lead is no longer on this workspace queue.' });
      return { state: 'failed' };
    }
    const { emitEvent, PERSONALIZATION_BRIEF_REGENERATE_REQUESTED } = await import('@/services/EventService');
    const res = await emitEvent({
      orgId: input.orgId,
      type: PERSONALIZATION_BRIEF_REGENERATE_REQUESTED,
      payload: { briefId: input.leadId, contactRef: reset.contactRef, contactName: reset.contactName ?? null, note: input.note, bulkJobId: input.jobId },
      invokedBy: input.by,
      dispatchMode: 'inline',
      ignoreCeiling: true,
    });
    if (res.triggered.length === 0) {
      await recordBulkLeadOutcome(input.orgId, input.jobId, { leadId: input.leadId, contactName: reset.contactName ?? null, state: 'failed', error: 'No automation in this workspace answers a brief regenerate request, so the lead is queued for the next scheduled pass.' });
      return { state: 'failed' };
    }
    await recordBulkLeadOutcome(input.orgId, input.jobId, { leadId: input.leadId, contactName: reset.contactName ?? null, state: 'landed' });
    return { state: 'landed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Dynamic: the worker bundle must never statically reach libs/Logger
    // (its top-level await is fatal under tsx CommonJS; temporal-worker.imports.test).
    const { logger } = await import('@/libs/Logger');
    logger.warn('bulk regenerate: lead did not land', { orgId: input.orgId, jobId: input.jobId, leadId: input.leadId, error: message });
    await recordBulkLeadOutcome(input.orgId, input.jobId, { leadId: input.leadId, contactName: null, state: 'failed', error: message }).catch(() => {});
    // Rethrown so Temporal retries once; a retry that lands overwrites the failure.
    throw err;
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

export async function finishBulkJobActivity(input: { orgId: string; jobId: number }): Promise<void> {
  await finishBulkJob(input.orgId, input.jobId);
}
