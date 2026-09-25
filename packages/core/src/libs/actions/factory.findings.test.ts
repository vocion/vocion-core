/**
 * A merge ask cannot be filed over a blocking QA finding (backlog 003). The
 * finding is read off the task, not off the proposer's input — a worker
 * that leaves it out of the ask is refused all the same.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { gitMergeAction, openBlockingFindings } = await import('./factory');

const ORG = 'org_findings_003';
const ctx = { orgId: ORG } as Parameters<NonNullable<typeof gitMergeAction.precheck>>[0];
const base = { commitSha: 'a1b2c3d', riskClass: 'ui', rollback: 'revert the merge commit and redeploy; no data written', steps: ['merge'] };

let seeded = 0;
async function seed(findings: unknown[] | undefined): Promise<number> {
  seeded += 1;
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: `engineering_task_${seeded}`, label: 'Task', schema: { type: 'object' } }).returning({ id: businessObjectTypeSchema.id });
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'send-0011', status: 'active', metadata: { verdict: { value: 'changes', commitSha: 'a1b2c3d', ...(findings ? { findings } : {}) } } }).returning({ id: businessObjectSchema.id });
  return row!.id;
}

describe('the merge ask and QA findings', () => {
  beforeEach(async () => {
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
  });

  afterAll(async () => {
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
  });

  it('refuses a merge ask while a block finding is open, and names the criterion it fails', async () => {
    const id = await seed([
      { against: 'criterion', ref: 'Every screen shows Stamp', severity: 'block', what: 'the settings screen still says Send (hunk L42)', closeBy: 'engineer' },
      { against: 'check', ref: 'typecheck', severity: 'note', what: 'two pre-existing warnings' },
    ]);

    const out = await gitMergeAction.precheck!(ctx, { ...base, taskId: id });

    expect(out).toMatch(/cannot be filed while a blocking QA finding is open/);
    expect(out).toMatch(/\[criterion\] Every screen shows Stamp — the settings screen still says Send/);
    expect(await openBlockingFindings(ORG, id)).toHaveLength(1);
  });

  it('lets the ask through when the findings are fix or note only, or when there are none', async () => {
    const fixOnly = await seed([{ against: 'path', ref: 'src/**', severity: 'fix', what: 'a file outside the allowed paths' }]);

    expect(await gitMergeAction.precheck!(ctx, { ...base, taskId: fixOnly })).toBeUndefined();

    const none = await seed(undefined);

    expect(await gitMergeAction.precheck!(ctx, { ...base, taskId: none })).toBeUndefined();
    expect(await gitMergeAction.precheck!(ctx, { ...base })).toBeUndefined();
  });
});
