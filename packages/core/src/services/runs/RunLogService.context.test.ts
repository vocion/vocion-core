import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The org's pages are not under test: requests open on the generic record here.
vi.mock('@/services/objects/recordHref', async () => {
  const { genericRecordLinker, NO_RECORD_PAGES } = await import('@/libs/workspace/recordHref');
  const links = { ...NO_RECORD_PAGES, codes: new Map([['request', 'FE'], ['architecture_plan', 'PL']]) };
  return { recordLinkerForOrg: async () => genericRecordLinker, recordLinksForOrg: async () => links };
});

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, workerRunSchema } = await import('@/models/Schema');
const { readRunLog, runContext, whyOfAttempt } = await import('./RunLogService');
const { recoveryStage } = await import('@/services/factory/recovery');

const ORG = 'org_run_context';

async function clear() {
  await db.delete(workerRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
}

beforeEach(clear);

afterAll(clear);

describe('where an engineering run belongs (Chris, 2026-09-29)', () => {
  it('its feature, its task\'s plan, which attempt it is of that feature, and how much acceptance it carries', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request' }).returning({ id: businessObjectTypeSchema.id });
    await db.insert(businessObjectSchema).values([
      { id: 41, orgId: ORG, typeId: type!.id, title: 'Room PDF export', metadata: {} },
      { id: 52, orgId: ORG, typeId: type!.id, title: 'Render the room to PDF', metadata: {} },
      { id: 60, orgId: ORG, typeId: type!.id, title: 'Room PDF export task', metadata: { planId: 52 } },
    ]);
    const task = { request_id: '41', acceptance_contract: ['A PDF downloads', 'It keeps the layout', 'It names the room'] };
    const [first] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'failed', input: { task, record: { id: 60, type: 'engineering_task' } } }).returning();
    const [second] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'running', input: { task, record: { id: 60, type: 'engineering_task' } } }).returning();

    const c = await runContext(second!);

    expect(c).toMatchObject({
      feature: { id: 41, title: 'Room PDF export', href: '/dashboard/objects/41' },
      plan: { id: 52, title: 'Render the room to PDF', href: '/dashboard/objects/52' },
      task: { id: 60, href: '/dashboard/objects/60' },
      // A person's build: not one of the automatic attempts, so no count.
      attempt: null,
      others: [{ runId: first!.id, status: 'failed', href: `/dashboard/p/runs/${first!.id}` }],
      acceptance: { count: 3, href: '/dashboard/objects/41#report-acceptance', criteria: [{ text: 'A PDF downloads', state: null }, { text: 'It keeps the layout', state: null }, { text: 'It names the room', state: null }] },
      why: null,
    });
  });

  it('counts the attempt the way its feature does, titles it with the feature, and says why: CI failed (Chris, 2026-09-30, run #435)', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request' }).returning({ id: businessObjectTypeSchema.id });
    const task = { task_id: 'northwind-t61', request_id: '41', title: 'Room PDF export', objective: 'Add a PDF export to the room share menu.', repo: 'https://github.com/example/northwind-portal.git', acceptance_contract: ['A PDF downloads', 'It keeps the layout'] };
    const [a] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'completed', input: { task, record: { id: 60, type: 'engineering_task' } } }).returning();
    const [b] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'completed', input: { task, record: { id: 61, type: 'engineering_task' } } }).returning();
    const [c] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'running', input: { task, record: { id: 62, type: 'engineering_task' } }, result: {}, progress: { keptBranch: 'factory/northwind-t62' } }).returning();
    // The feature's own account: a person's build (a), then two automatic ones (b, c).
    const recovery = {
      stage: 'recovering',
      limit: 3,
      attempts: [
        { n: 1, at: '2026-09-30T08:00:00Z', kind: 'build', trigger: 'retry', runId: b!.id, taskId: 61, line: 'QA sent attempt #60 back', failure: null },
        { n: 2, at: '2026-09-30T09:00:00Z', kind: 'plan', trigger: 'recovery', runId: null, taskId: null, line: 'the plan was stale', failure: null },
        { n: 3, at: '2026-09-30T10:00:00Z', kind: 'build', trigger: 'retry', runId: c!.id, taskId: 62, line: 'CI failed: test (unit); back with the engineer.', failure: null },
      ],
    };
    await db.insert(businessObjectSchema).values([
      { id: 41, orgId: ORG, typeId: type!.id, title: 'Room PDF export', metadata: { recovery } },
      { id: 61, orgId: ORG, typeId: type!.id, title: 'Room PDF export task', metadata: { prUrl: 'https://github.com/example/northwind-portal/pull/27', verdict: { value: 'approve', proven: 2, total: 2, at: '2026-09-30T09:30:00Z' }, ciFailure: { at: '2026-09-30T09:55:00Z', checks: 'test (unit)', failing: 'test (unit)', detail: 'test (unit): AssertionError: expected 200 to be 403 src/features/admin/admin.test.ts:121\n  last lines of the log' } } },
      { id: 62, orgId: ORG, typeId: type!.id, title: 'Room PDF export task', metadata: { previousTaskId: 61, autoRetryOf: 61 } },
    ]);

    const ctx = await runContext(c!);

    // The same count the feature page shows: builds only, against the limit.
    expect(ctx?.attempt).toEqual({ n: 2, of: 3 });
    expect(recoveryStage({ recovery })?.label).toBe('Recovering (attempt 2 of 3)');
    expect(ctx?.why).toEqual({
      kind: 'ci',
      line: 'CI failed on the pull request: test (unit)',
      detail: 'test (unit): AssertionError: expected 200 to be 403 src/features/admin/admin.test.ts:121',
      href: 'https://github.com/example/northwind-portal/pull/27',
    });
    expect(ctx?.branch).toEqual({ name: 'factory/northwind-t62', href: 'https://github.com/example/northwind-portal/tree/factory/northwind-t62' });

    const data = await readRunLog(ORG, String(c!.id));

    expect(data?.header.title).toBe('Room PDF export');
    expect(data?.header.taskId).toBe('northwind-t61');
    expect(data?.header.seat).toBe('Engineer');
    expect(a).toBeDefined();
  });

  it('a run that names no feature belongs nowhere it can say', async () => {
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'running', input: {} }).returning();

    expect(await runContext(run!)).toBeNull();
  });
});

describe('why this attempt, in one line', () => {
  it('QA\'s send-back when it came after any CI failure', () => {
    expect(whyOfAttempt({ previous: { verdict: { value: 'changes', proven: 2, total: 5, note: 'The empty state is missing.\nMore detail.', at: '2026-09-30T10:00:00Z' }, ciFailure: { at: '2026-09-30T09:00:00Z', failing: 'lint' } }, note: null, byPerson: false, recoveryLine: null }))
      .toEqual({ kind: 'review', line: 'QA sent it back (2 of 5 proven)', detail: 'The empty state is missing.', href: null });
  });

  it('what the person asked, when they started it', () => {
    expect(whyOfAttempt({ previous: { verdict: { value: 'changes', note: 'x' } }, note: 'Keep the old export too.', byPerson: true, recoveryLine: null }))
      .toEqual({ kind: 'note', line: 'Keep the old export too.', detail: null, href: null });
  });

  it('nothing on a first attempt', () => {
    expect(whyOfAttempt({ previous: null, note: null, byPerson: true, recoveryLine: null })).toBeNull();
  });
});
