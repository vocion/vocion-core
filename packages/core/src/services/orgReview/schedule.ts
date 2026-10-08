/**
 * The org review's clock: one durable schedule per workspace, firing the
 * `org.review` job on the workspace's own cron (`defaults.orgReview.schedule`,
 * Mondays 14:00 UTC by default). Written when a workspace is applied and
 * re-asserted for every workspace when the executor boots, so a workspace that
 * has not been re-applied since this shipped still gets its review; a
 * workspace that turned the review off has its schedule removed.
 */

import type { ScheduleSpec } from '@/libs/durable/jobs';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { scheduleJob, unscheduleJob } from '@/libs/durable/jobs';
import { resolveOrgReviewConfig } from '@/libs/orgReview/config';
import { projectSchema } from '@/models/Schema';
import { JOB } from '@/services/background/catalog';

/**
 * Schedule name convention — `org-review-<orgId>`.
 * @param orgId - The workspace.
 */
export function orgReviewScheduleIdFor(orgId: string): string {
  return `org-review-${orgId}`;
}

/**
 * The schedule for one workspace's review. Pure.
 * @param orgId - The workspace.
 * @param cron - When it runs, 5-field UTC.
 */
export function orgReviewScheduleSpec(orgId: string, cron: string): ScheduleSpec {
  return { name: orgReviewScheduleIdFor(orgId), cron, job: JOB.orgReview, input: { orgId } };
}

/**
 * Bring one workspace's review schedule in line with its settings.
 * @param orgId - The workspace.
 * @returns What it did: `scheduled` (with the cron), `removed`, or `no_project`.
 */
export async function reconcileOrgReviewSchedule(orgId: string): Promise<{ state: 'scheduled'; cron: string } | { state: 'removed' | 'no_project' }> {
  const [project] = await db
    .select({ orgReview: projectSchema.orgReview, kind: projectSchema.kind })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    await unscheduleJob(orgReviewScheduleIdFor(orgId));
    return { state: 'no_project' };
  }
  const config = resolveOrgReviewConfig(project.orgReview, project.kind);
  if (!config.enabled) {
    await unscheduleJob(orgReviewScheduleIdFor(orgId));
    return { state: 'removed' };
  }
  await scheduleJob(orgReviewScheduleSpec(orgId, config.schedule));
  return { state: 'scheduled', cron: config.schedule };
}

/**
 * Re-assert every workspace's review schedule. Idempotent; one workspace that
 * fails is logged and the rest still apply.
 */
export async function reconcileAllOrgReviewSchedules(): Promise<{ scheduled: number; removed: number; failed: string[] }> {
  const projects = await db.select({ id: projectSchema.id }).from(projectSchema);
  const out = { scheduled: 0, removed: 0, failed: [] as string[] };
  for (const { id } of projects) {
    try {
      const res = await reconcileOrgReviewSchedule(id);
      if (res.state === 'scheduled') {
        out.scheduled += 1;
      } else {
        out.removed += 1;
      }
    } catch (error) {
      out.failed.push(id);
      console.error(`[orgReview] could not reconcile the review schedule for ${id}`, error);
    }
  }
  return out;
}
