/**
 * WorkService against a real database: what the chat's "N running ›" chip
 * reads. On PGlite because the rules are the queries themselves — the
 * workspace scoping, the "running, or started since" window, and a Stop that
 * only touches a run of this workspace that is still running.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { eq } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { automationRunSchema, missionRunSchema, workerRunSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { stopWork, workSince } = await import('@/services/work/WorkService');

const ORG = 'org_work_northwind';
const OTHER = 'org_work_kestrel';
const HOUR = 60 * 60 * 1000;

async function mission(orgId: string, title: string, status: string, createdAt: Date, completedAt: Date | null = null) {
  const [row] = await db.insert(missionRunSchema).values({ orgId, title, brief: title, status, team: { lead: 'ops-lead', members: [] }, createdAt, completedAt }).returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  await db.delete(workerRunSchema);
  await db.delete(workflowRunSchema);
  await db.delete(workflowSchema);
  await db.delete(automationRunSchema);
});

describe('what the chip lists', () => {
  it('lists what runs now and what finished since the conversation began, in this workspace only', async () => {
    const now = Date.now();
    const since = new Date(now - HOUR);
    await mission(ORG, 'Reconcile the Northwind invoices', 'running', new Date(now - 3 * HOUR));
    await mission(ORG, 'Draft the Kestrel renewal', 'completed', new Date(now - 30 * 60 * 1000), new Date(now - 10 * 60 * 1000));
    await mission(ORG, 'Last week\'s audit', 'completed', new Date(now - 7 * 24 * HOUR), new Date(now - 7 * 24 * HOUR));
    await mission(OTHER, 'Someone else\'s mission', 'running', new Date(now - 5 * 60 * 1000));
    await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'eng-lead', summary: 'Fix the export button', status: 'running', createdAt: new Date(now - 5 * 60 * 1000) });
    const [wf] = await db.insert(workflowSchema).values({ orgId: ORG, slug: 'weekly-digest', name: 'Weekly digest', trigger: {}, steps: [] }).returning({ id: workflowSchema.id });
    await db.insert(workflowRunSchema).values({ orgId: ORG, workflowId: wf!.id, status: 'failed', createdAt: new Date(now - 20 * 60 * 1000), completedAt: new Date(now - 19 * 60 * 1000) });
    await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'triage-inbox', kind: 'agent', status: 'success', dryRun: true, startedAt: new Date(now - 5 * 60 * 1000) });

    const view = await workSince(ORG, since);

    expect(view.running.map(i => i.title).sort()).toEqual(['Fix the export button', 'Reconcile the Northwind invoices']);
    expect(view.finished.map(i => i.title)).toEqual(['Draft the Kestrel renewal', 'Weekly digest']);
    expect(view.finished.find(i => i.kind === 'workflow')).toMatchObject({ state: 'failed', href: '/dashboard/workflows/weekly-digest', canStop: false });
    expect(view.running.find(i => i.kind === 'mission')).toMatchObject({ canStop: true, href: expect.stringMatching(/^\/dashboard\/missions\/runs\/\d+$/) });
    // A dry run is a rehearsal, not work.
    expect([...view.running, ...view.finished].some(i => i.kind === 'automation')).toBe(false);
  });
});

describe('Stop', () => {
  it('cancels a running mission of this workspace, and nothing else', async () => {
    const running = await mission(ORG, 'Reconcile the Northwind invoices', 'running', new Date(Date.now() - 3 * HOUR));
    const done = await mission(ORG, 'Draft the Kestrel renewal', 'completed', new Date(), new Date());
    const theirs = await mission(OTHER, 'Someone else\'s mission', 'running', new Date());

    expect(await stopWork(ORG, `mission:${theirs}`)).toBe(false);
    expect(await stopWork(ORG, `mission:${done}`)).toBe(false);
    expect(await stopWork(ORG, `mission:${running}`)).toBe(true);

    const status = async (id: number) => (await db.select({ s: missionRunSchema.status }).from(missionRunSchema).where(eq(missionRunSchema.id, id)))[0]!.s;

    expect(await status(running)).toBe('cancelled');
    expect(await status(done)).toBe('completed');
    expect(await status(theirs)).toBe('running');

    // Stopped from this conversation, it is listed as finished, stopped — though it started earlier.
    const view = await workSince(ORG, new Date(Date.now() - 1000));

    expect(view.finished.find(i => i.key === `mission:${running}`)).toMatchObject({ state: 'stopped' });
  });

  it('asks a running worker run to stop; refuses what has no stop', async () => {
    const [w] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'eng-lead', status: 'running' }).returning({ id: workerRunSchema.id });

    expect(await stopWork(ORG, `worker:${w!.id}`)).toBe(true);

    const [row] = await db.select({ stop: workerRunSchema.stopRequested }).from(workerRunSchema).where(eq(workerRunSchema.id, w!.id));

    expect(row!.stop).toBe(true);
    expect(await stopWork(ORG, 'workflow:1')).toBe(false);
    expect(await stopWork(ORG, 'mission:not-a-number')).toBe(false);
  });
});
