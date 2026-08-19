/**
 * Automation dispatch against PGlite. Seeds automation rows, mocks the
 * workflow/mission starters, and verifies fireAutomation routes `do`
 * correctly — plus EventService firing event-when automations.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 210 })),
}));
vi.mock('@/services/MissionService', () => ({
  getMission: vi.fn(async () => ({ id: 1, name: 'No Lead Goes Cold', goal: 'goal', successCriteria: [] })),
  scheduledCheckBrief: vi.fn(() => 'check brief'),
  startMission: vi.fn(async () => ({ id: 305, status: 'completed' })),
}));

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, eventLogSchema, workflowSchema } = await import('@/models/Schema');
const { startWorkflow } = await import('@/services/WorkflowService');
const { startMission } = await import('@/services/MissionService');
const { fireAutomation, listAutomationRuns } = await import('@/services/AutomationService');
const { emitEvent } = await import('@/services/EventService');

const ORG = 'org_auto';

async function seedAutomation(slug: string, whenConfig: Record<string, unknown>, doConfig: Record<string, unknown>, status = 'active') {
  await db.insert(automationSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    status,
    whenConfig: whenConfig as never,
    doConfig: doConfig as never,
  });
}

beforeEach(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  await db.delete(workflowSchema);
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
});

describe('fireAutomation', () => {
  it('dispatches do.workflow through startWorkflow with merged input', async () => {
    await seedAutomation('reply-followup', { event: 'prospect.reply' }, { workflow: 'discovery_followup', input: { channel: 'email' } });

    const res = await fireAutomation(ORG, 'reply-followup', { input: { dealId: 9 } });

    expect(res).toEqual({ kind: 'workflow', runId: 210, automationRunId: expect.any(Number) });
    expect(vi.mocked(startWorkflow)).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      slug: 'discovery_followup',
      input: { channel: 'email', dealId: 9 },
    }));
  });

  it('dispatches do.checkMission as a check-mode mission run', async () => {
    await seedAutomation('follow-up-check', { schedule: '0 15 * * 1-5' }, { checkMission: 'follow-up-queue' });

    const res = await fireAutomation(ORG, 'follow-up-check');

    expect(res).toEqual({ kind: 'mission_check', runId: 305, automationRunId: expect.any(Number) });
    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      missionSlug: 'follow-up-queue',
      mode: 'check',
      brief: 'check brief',
    }));
  });

  it('refuses to fire disabled automations', async () => {
    await seedAutomation('paused-one', { schedule: '0 12 * * *' }, { checkMission: 'x' }, 'disabled');

    await expect(fireAutomation(ORG, 'paused-one')).rejects.toThrow(/not active/);
  });

  /**
   * A `job` dispatch used to persist nothing at all, so an hourly sweep that
   * scanned nothing, ran clean, or threw were indistinguishable afterwards.
   */
  it('records a run row carrying the merged input and the job result', async () => {
    await seedAutomation('sweeper', { schedule: '0 * * * *' }, { job: 'discovery-sweep', input: { sellerDomain: 'metacto.com' } });

    const res = await fireAutomation(ORG, 'sweeper', { input: { dryRun: true }, invokedBy: 'dashboard:test-run', dryRun: true });

    expect(res.kind).toBe('job');

    const [row] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, res.automationRunId));

    expect(row).toMatchObject({
      slug: 'sweeper',
      kind: 'job',
      status: 'ok',
      invokedBy: 'dashboard:test-run',
      dryRun: true,
      error: null,
    });
    expect(row?.input).toMatchObject({ sellerDomain: 'metacto.com', dryRun: true });
    expect(row?.result).toMatchObject({ dryRun: true, meetingsScanned: 0 });
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it('records the failure and still rethrows when the do throws', async () => {
    await seedAutomation('broken', { schedule: '0 * * * *' }, { job: 'no-such-job' });

    await expect(fireAutomation(ORG, 'broken')).rejects.toThrow(/unknown automation job/);

    const rows = await db.select().from(automationRunSchema).where(eq(automationRunSchema.slug, 'broken'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'error' });
    expect(rows[0]?.error).toMatch(/unknown automation job/);
  });

  it('lists runs newest first', async () => {
    await seedAutomation('sweeper', { schedule: '0 * * * *' }, { job: 'discovery-sweep', input: { sellerDomain: 'metacto.com' } });

    const first = await fireAutomation(ORG, 'sweeper');
    const second = await fireAutomation(ORG, 'sweeper');

    const runs = await listAutomationRuns(ORG, 'sweeper', 5);

    expect(runs.map(r => r.id)).toEqual([second.automationRunId, first.automationRunId]);
  });
});

describe('emitEvent → automations', () => {
  it('fires event-when automations whose type + filter match', async () => {
    await seedAutomation('hot-reply', { event: 'prospect.reply', filter: { pipeline: 'default' } }, { workflow: 'discovery_followup' });

    const miss = await emitEvent({ orgId: ORG, type: 'prospect.reply', payload: { pipeline: 'other' } });

    expect(miss.triggered).toHaveLength(0);

    const hit = await emitEvent({ orgId: ORG, type: 'prospect.reply', payload: { pipeline: 'default' } });

    expect(hit.triggered).toEqual([{ slug: 'automation:hot-reply', runId: 210 }]);
  });

  it('ignores schedule-when automations on events', async () => {
    await seedAutomation('morning', { schedule: '0 12 * * 1-5' }, { checkMission: 'daily-revenue-briefing' });

    const out = await emitEvent({ orgId: ORG, type: 'prospect.reply', payload: {} });

    expect(out.triggered).toHaveLength(0);
  });
});
