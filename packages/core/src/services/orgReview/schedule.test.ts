/**
 * One durable schedule per workspace, on the workspace's own cron; removed for
 * a workspace that turned the review off; written for every workspace when the
 * executor boots.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const scheduleJob = vi.fn();
const unscheduleJob = vi.fn();

vi.mock('@/libs/durable/jobs', async orig => ({
  ...(await orig<typeof import('@/libs/durable/jobs')>()),
  scheduleJob: (...args: unknown[]) => scheduleJob(...args),
  unscheduleJob: (...args: unknown[]) => unscheduleJob(...args),
}));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { orgReviewScheduleSpec, reconcileAllOrgReviewSchedules, reconcileOrgReviewSchedule } = await import('./schedule');

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-sched', name: 'Northwind', slug: 'northwind-sched' });
  await db.insert(projectSchema).values([
    { id: 'p_shared', accountId: 'acct-sched', slug: 'northwind', name: 'Northwind' },
    { id: 'p_personal', accountId: 'acct-sched', slug: 'lili', name: 'Lili', kind: 'personal' },
  ]);
});

beforeEach(() => {
  scheduleJob.mockReset();
  unscheduleJob.mockReset();
});

describe('the review\'s schedule', () => {
  it('names the job and the workspace', () => {
    expect(orgReviewScheduleSpec('p_shared', '0 14 * * 1')).toEqual({ name: 'org-review-p_shared', cron: '0 14 * * 1', job: 'org.review', input: { orgId: 'p_shared' } });
  });

  it('is weekly by default, on the workspace\'s own cron when it set one, and gone when it turned the review off', async () => {
    expect(await reconcileOrgReviewSchedule('p_shared')).toEqual({ state: 'scheduled', cron: '0 14 * * 1' });
    expect(scheduleJob).toHaveBeenLastCalledWith(orgReviewScheduleSpec('p_shared', '0 14 * * 1'));

    await db.update(projectSchema).set({ orgReview: { schedule: '30 8 * * 5' } }).where(eq(projectSchema.id, 'p_shared'));

    expect(await reconcileOrgReviewSchedule('p_shared')).toEqual({ state: 'scheduled', cron: '30 8 * * 5' });

    await db.update(projectSchema).set({ orgReview: { enabled: false } }).where(eq(projectSchema.id, 'p_shared'));

    expect(await reconcileOrgReviewSchedule('p_shared')).toEqual({ state: 'removed' });
    expect(unscheduleJob).toHaveBeenCalledWith('org-review-p_shared');

    await db.update(projectSchema).set({ orgReview: null }).where(eq(projectSchema.id, 'p_shared'));
  });

  it('leaves a personal workspace off, and re-asserts every workspace at boot', async () => {
    expect(await reconcileOrgReviewSchedule('p_personal')).toEqual({ state: 'removed' });

    const out = await reconcileAllOrgReviewSchedules();

    expect(out).toEqual({ scheduled: 1, removed: 1, failed: [] });
    expect(scheduleJob.mock.calls.map(c => (c[0] as { name: string }).name)).toEqual(['org-review-p_shared']);
  });

  it('removes the schedule of a workspace that no longer exists', async () => {
    expect(await reconcileOrgReviewSchedule('p_gone')).toEqual({ state: 'no_project' });
    expect(unscheduleJob).toHaveBeenCalledWith('org-review-p_gone');
  });
});
