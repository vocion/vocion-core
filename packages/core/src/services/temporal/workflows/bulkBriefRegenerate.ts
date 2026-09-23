/**
 * Bulk brief regeneration (Metacto ticket 071): walk the leads two at a time,
 * one activity each, and never let one failure stop the rest.
 *
 * Two, because each activity is a full agent pass on the box, and the point
 * of a queue is that fifty requests do not become fifty concurrent passes.
 * Temporal keeps the position, so a worker restart mid-job resumes where it
 * was rather than starting over or losing the tail.
 */
import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '5 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    maximumAttempts: 2,
  },
});

export type BulkBriefRegenerateInput = {
  orgId: string;
  jobId: number;
  leadIds: number[];
  note: string;
  by: string;
};

export const BULK_BRIEF_REGENERATE_CONCURRENCY = 2;

export async function bulkBriefRegenerate(input: BulkBriefRegenerateInput): Promise<{ landed: number; failed: number }> {
  let landed = 0;
  let failed = 0;
  for (let i = 0; i < input.leadIds.length; i += BULK_BRIEF_REGENERATE_CONCURRENCY) {
    const chunk = input.leadIds.slice(i, i + BULK_BRIEF_REGENERATE_CONCURRENCY);
    const results = await Promise.all(chunk.map(async (leadId) => {
      try {
        return await acts.regenerateLeadBriefActivity({ orgId: input.orgId, jobId: input.jobId, leadId, note: input.note, by: input.by });
      } catch {
        // Both attempts failed; the activity recorded the reason on the job.
        return { state: 'failed' as const };
      }
    }));
    for (const r of results) {
      if (r.state === 'landed') {
        landed += 1;
      } else {
        failed += 1;
      }
    }
  }
  await acts.finishBulkJobActivity({ orgId: input.orgId, jobId: input.jobId });
  return { landed, failed };
}
