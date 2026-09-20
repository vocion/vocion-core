/**
 * list_recent_runs reads the org's worker runs — the Factory log's own rows —
 * whether or not a task record exists for them.
 *
 * 2026-09-20: the workspace lead answered "no worker runs" while the Factory
 * log showed fifteen. The tool listed workflow runs and action proposals
 * only; the runs were in `worker_run`, queued against no `engineering_task`.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, workerRunSchema } = await import('@/models/Schema');
const { listRecentRunsTool } = await import('./runs');

const ORG = 'org_runs_tool';
const OTHER = 'org_runs_tool_other';

function ctxFor(): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'chris',
    agentSlug: 'northwind-lead',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: () => {},
  } as unknown as RuntimeContext;
}

async function call(args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const out = await listRecentRunsTool(ctxFor()).invoke(args as never);
  return JSON.parse(String(out)) as Record<string, any>;
}

const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  await db.delete(workerRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.insert(workerRunSchema).values([
    // A dispatched job that finished and opened a PR — queued against no task record.
    {
      orgId: ORG,
      agentSlug: 'task-engineer',
      kind: 'worker',
      status: 'completed',
      input: { message: 'Add the export button to the invoices page' },
      result: { status: 'completed', pr_url: 'https://github.com/northwind/ledger/pull/41', branch: 'sf/invoices-export', base_sha: '000000', commit_sha: 'abc1234', files_changed: ['src/invoices/page.tsx', 'src/invoices/export.ts', 'src/invoices/export.test.ts'], checks: [{ name: 'lint', passed: true }, { name: 'test', passed: false }], task_id: 41, risk_class: 'low', attempt: 1 },
      summary: 'Added the button, two tests, PR opened.',
      cents: 312,
      tokens: 90_000,
      claimedAt: at('2026-09-19T10:00:00Z'),
      completedAt: at('2026-09-19T10:41:00Z'),
      createdAt: at('2026-09-19T09:58:00Z'),
    },
    // One still running, queued for a task record.
    {
      orgId: ORG,
      agentSlug: 'task-engineer',
      kind: 'worker',
      status: 'running',
      input: { task: { objective: 'Fix the flaky sync test' }, record: { type: 'engineering_task', id: 12 } },
      cents: 40,
      claimedAt: at('2026-09-20T08:00:00Z'),
      heartbeatAt: at('2026-09-20T08:05:00Z'),
      createdAt: at('2026-09-20T07:59:00Z'),
    },
    // A failed run: no result; the kept work is on the last heartbeat's progress.
    {
      orgId: ORG,
      agentSlug: 'task-engineer',
      kind: 'worker',
      status: 'failed',
      input: { task: { objective: 'Migrate the mailer to the new queue' } },
      progress: { phase: 'checks', keptBranch: 'sf/mailer-queue', prUrl: 'https://github.com/northwind/ledger/pull/42', continue: 'git fetch origin sf/mailer-queue && npm test' },
      error: 'test failed (exit 1); kept work at https://github.com/northwind/ledger/pull/42',
      failures: [{ scope: 'kept-work', message: 'branch pushed, PR open', at: '2026-09-18T12:00:00Z' }],
      cents: 90,
      claimedAt: at('2026-09-18T11:00:00Z'),
      completedAt: at('2026-09-18T12:00:00Z'),
      createdAt: at('2026-09-18T10:59:00Z'),
    },
    // The lead's planning tick.
    { orgId: ORG, agentSlug: 'northwind-lead', kind: 'lead', status: 'completed', input: {}, cents: 5, createdAt: at('2026-09-18T06:00:00Z'), completedAt: at('2026-09-18T06:02:00Z') },
    // Bookkeeping — the machinery's own noise, left out by default.
    { orgId: ORG, agentSlug: 'northwind-lead', kind: 'snapshot', status: 'completed', input: {}, createdAt: at('2026-09-18T05:00:00Z') },
    // Somebody else's run.
    { orgId: OTHER, agentSlug: 'task-engineer', kind: 'worker', status: 'completed', input: {}, cents: 999, createdAt: at('2026-09-20T09:00:00Z') },
  ]);
});

afterAll(async () => {
  await db.delete(workerRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('list_recent_runs — the factory\'s runs, whether or not a task exists', () => {
  it('counts the org\'s worker runs and lists them newest first with what the worker reported', async () => {
    const out = await call();

    expect(out.workerRunCount).toBe(4);
    expect(out.byStatus).toEqual({ completed: 2, running: 1, failed: 1 });
    expect(out.centsSpent).toBe(447);
    expect(out.showing).toBe(4);
    expect(out.note).toContain('4 worker runs on record');
    expect(out.workerRuns.map((r: { kind: string }) => r.kind)).toEqual(['worker', 'worker', 'worker', 'lead']);

    const [running, shipped, failed] = out.workerRuns;

    expect(running).toMatchObject({
      status: 'running',
      agent: 'task-engineer',
      objective: 'Fix the flaky sync test',
      record: { type: 'engineering_task', id: 12 },
      cents: 40,
      startedAt: '2026-09-20T08:00:00.000Z',
      endedAt: null,
      heartbeatAt: '2026-09-20T08:05:00.000Z',
    });
    expect(shipped).toMatchObject({
      status: 'completed',
      objective: 'Add the export button to the invoices page',
      record: null,
      summary: 'Added the button, two tests, PR opened.',
      prUrl: 'https://github.com/northwind/ledger/pull/41',
      branch: 'sf/invoices-export',
      commit: 'abc1234',
      filesChanged: 3,
      checks: [{ name: 'lint', status: 'passed' }, { name: 'test', status: 'failed' }],
      taskId: 41,
      riskClass: 'low',
      keptWork: null,
      cents: 312,
      startedAt: '2026-09-19T10:00:00.000Z',
      endedAt: '2026-09-19T10:41:00.000Z',
    });
    // A failed run has no result; its kept work comes off the last heartbeat.
    expect(failed).toMatchObject({
      status: 'failed',
      objective: 'Migrate the mailer to the new queue',
      error: expect.stringContaining('kept work at'),
      prUrl: 'https://github.com/northwind/ledger/pull/42',
      branch: 'sf/mailer-queue',
      commit: null,
      checks: null,
      keptWork: { keptBranch: 'sf/mailer-queue', prUrl: 'https://github.com/northwind/ledger/pull/42', continue: 'git fetch origin sf/mailer-queue && npm test' },
    });
    // The snapshot and the other org's run are not here.
    expect(out.workerRuns.some((r: { kind: string }) => r.kind === 'snapshot')).toBe(false);
    expect(out.workerRuns.some((r: { cents: number }) => r.cents === 999)).toBe(false);
  });

  it('says plainly when the workspace tracks no releases', async () => {
    const out = await call();

    expect(out.releaseCount).toBeNull();
    expect(out.releases).toContain('no `release` object type');
  });

  it('rides recent releases along when the workspace has the noun', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'release', label: 'Release' }).returning();
    await db.insert(businessObjectSchema).values([
      { orgId: ORG, typeId: type!.id, title: 'Northwind v1.4.0', status: 'active', metadata: { product: 'ledger', version: 'v1.4.0', releasedAt: '2026-09-19T12:00:00Z', prUrls: ['https://github.com/northwind/ledger/pull/41'], taskIds: [12, 13], sizeClass: 'minor' } },
      { orgId: ORG, typeId: type!.id, title: 'Northwind v1.3.9', status: 'active', metadata: { product: 'ledger', version: 'v1.3.9', releasedAt: '2026-09-10T12:00:00Z', taskIds: [9] } },
    ]);

    const out = await call();

    expect(out.releaseCount).toBe(2);
    expect(out.releases.recent.map((r: { version: string }) => r.version)).toEqual(['v1.4.0', 'v1.3.9']);
    expect(out.releases.recent[0]).toMatchObject({
      title: 'Northwind v1.4.0',
      product: 'ledger',
      releasedAt: '2026-09-19T12:00:00Z',
      sizeClass: 'minor',
      prUrls: 'https://github.com/northwind/ledger/pull/41',
      tasksCarried: 2,
    });
  });

  it('narrows by status, kind and agent, and includes bookkeeping only when asked', async () => {
    expect((await call({ status: 'running' })).workerRuns.map((r: { status: string }) => r.status)).toEqual(['running']);
    expect((await call({ kinds: ['lead'] })).workerRuns.map((r: { agent: string }) => r.agent)).toEqual(['northwind-lead']);
    expect((await call({ agentSlug: 'task-engineer' })).workerRunCount).toBe(3);

    const all = await call({ includeBookkeeping: true });

    expect(all.workerRunCount).toBe(5);
    expect(all.workerRuns.some((r: { kind: string }) => r.kind === 'snapshot')).toBe(true);
  });

  it('says there are none when there are none, instead of an empty list nobody reads', async () => {
    await db.delete(workerRunSchema);

    const out = await call();

    expect(out.workerRunCount).toBe(0);
    expect(out.note).toBe('No worker runs in this workspace yet.');
    expect(out.workerRuns).toEqual([]);
  });

  it('keeps the self-improver\'s view: feedback only, no worker runs\' releases', async () => {
    const out = await call({ withFeedbackOnly: true });

    expect(out.workflowRuns).toEqual([]);
    expect(out.actionRuns).toEqual([]);
    expect(out.releases).toBeUndefined();
  });
});
