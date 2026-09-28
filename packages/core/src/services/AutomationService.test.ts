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
vi.mock('@/services/automations/requiredToolPass', () => ({
  forceRequiredTool: vi.fn(async () => ({ called: true, answer: 'recorded' })),
  missionRunReport: vi.fn(async () => 'the review, as written'),
}));
vi.mock('@/services/MissionService', () => ({
  getMission: vi.fn(async () => ({ id: 1, name: 'No Lead Goes Cold', goal: 'goal', successCriteria: [] })),
  scheduledCheckBrief: vi.fn((_template: unknown, prompt?: string) => prompt ? `check brief + ${prompt}` : 'check brief'),
  startMission: vi.fn(async () => ({ id: 305, status: 'completed' })),
}));
// The built-in registry is empty since discovery detection went agent-driven;
// a stub job keeps the `do: job` dispatch seam covered.
vi.mock('@/services/jobs/registry', () => ({
  isBuiltInJob: vi.fn((name: string) => name === 'stub-job'),
  runBuiltInJob: vi.fn(async (name: string, _orgId: string, input: Record<string, unknown>) => {
    if (name !== 'stub-job') {
      throw new Error(`unknown automation job: ${name}`);
    }
    return { echoed: input };
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, automationRunSchema, automationSchema, eventLogSchema, workflowSchema } = await import('@/models/Schema');
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

    expect(res).toMatchObject({ kind: 'mission_check', runId: 305, automationRunId: expect.any(Number) });
    // The branch used to discard `startMission`'s summary, so
    // `automation_run.result` was always null for a mission check.
    expect(res.result).toMatchObject({ kind: 'mission_check', missionRunId: 305, missionRunStatus: 'completed' });
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
    await seedAutomation('sweeper', { schedule: '0 * * * *' }, { job: 'stub-job', input: { sellerDomain: 'metacto.com' } });

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
    expect(row?.result).toMatchObject({ echoed: { sellerDomain: 'metacto.com', dryRun: true } });
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it('do.requireTool: a miss gets the forced recording pass over the run\'s report; a pass that cannot land it fails the fire', async () => {
    const { toolCallSchema } = await import('@/models/Schema');
    const { forceRequiredTool } = await import('@/services/automations/requiredToolPass');
    await db.delete(toolCallSchema);
    await seedAutomation('review-pr', { event: 'pr.checks_completed' }, { checkMission: 'prove-the-contract', prompt: 'Review it.', requireTool: 'record_verdict' });
    vi.mocked(startMission).mockResolvedValueOnce({ id: 401, status: 'completed' } as never);
    vi.mocked(forceRequiredTool).mockResolvedValueOnce({ called: false, answer: 'the model returned no tool call' });

    await expect(fireAutomation(ORG, 'review-pr', { input: { number: 50 } })).rejects.toThrow('run #401 ended without record_verdict, and the recording pass did not land it (the model returned no tool call)');
    expect(vi.mocked(startMission)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(forceRequiredTool)).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'record_verdict', missionRunId: 401, report: 'the review, as written', context: { number: 50 } }));

    // The recording pass lands it: the fire completes on the ONE mission run.
    vi.mocked(startMission).mockResolvedValueOnce({ id: 402, status: 'completed' } as never);
    vi.mocked(forceRequiredTool).mockResolvedValueOnce({ called: true, answer: 'Verdict recorded on task #157' });

    expect(await fireAutomation(ORG, 'review-pr', { input: { number: 50 } })).toMatchObject({ kind: 'mission_check', runId: 402 });

    // A refused call is not the work being done; an accepted one skips the pass.
    vi.mocked(forceRequiredTool).mockClear();
    await db.insert(toolCallSchema).values([
      { orgId: ORG, missionRunId: 403, tool: 'record_verdict', input: {}, output: 'Not recorded: an approve cannot carry 1 criteria that are not proven', agentSlug: 'change-reviewer' },
      { orgId: ORG, missionRunId: 404, tool: 'record_verdict', input: {}, output: 'Verdict recorded on task #157: changes, 4 of 7 criteria proven', agentSlug: 'change-reviewer' },
    ] as never);
    vi.mocked(startMission).mockResolvedValueOnce({ id: 404, status: 'completed' } as never);
    await fireAutomation(ORG, 'review-pr', { input: { number: 50 } });

    expect(vi.mocked(forceRequiredTool)).not.toHaveBeenCalled();

    vi.mocked(startMission).mockResolvedValueOnce({ id: 403, status: 'completed' } as never);
    vi.mocked(forceRequiredTool).mockResolvedValueOnce({ called: true, answer: 'Verdict recorded' });
    await fireAutomation(ORG, 'review-pr', { input: { number: 50 } });

    expect(vi.mocked(forceRequiredTool)).toHaveBeenCalledTimes(1);

    await db.delete(toolCallSchema);
  });

  it('do.requireTool: a run a person cancelled is not forced to record, and the fire does not fail', async () => {
    const { toolCallSchema } = await import('@/models/Schema');
    const { forceRequiredTool } = await import('@/services/automations/requiredToolPass');
    await db.delete(toolCallSchema);
    await seedAutomation('review-pr-cancelled', { event: 'pr.checks_completed' }, { checkMission: 'prove-the-contract', prompt: 'Review it.', requireTool: 'record_verdict' });
    vi.mocked(forceRequiredTool).mockClear();
    vi.mocked(startMission).mockResolvedValueOnce({ id: 405, status: 'cancelled' } as never);

    await expect(fireAutomation(ORG, 'review-pr-cancelled', { input: { number: 51 } })).resolves.toMatchObject({ kind: 'mission_check', runId: 405 });
    // No paid recording pass for a run someone stopped on purpose.
    expect(vi.mocked(forceRequiredTool)).not.toHaveBeenCalled();
  });

  it('carries do.prompt into the scheduled-check brief; the mission stays the standing context', async () => {
    await seedAutomation(
      'discovery-sweep',
      { schedule: '0 * * * *' },
      { checkMission: 'discovery-to-proposal', prompt: 'Run a detection pass over the last 3 days.' },
    );

    const res = await fireAutomation(ORG, 'discovery-sweep');

    expect(res.kind).toBe('mission_check');
    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({
      missionSlug: 'discovery-to-proposal',
      mode: 'check',
      brief: 'check brief + Run a detection pass over the last 3 days.',
    }));
  });

  it('hands an event fire\'s payload to the scheduled-check brief, so the check knows what it was fired for', async () => {
    const { scheduledCheckBrief } = await import('@/services/MissionService');
    await seedAutomation(
      'handoff-on-reply',
      { event: 'lead.replied' },
      { checkMission: 'increase-discovery-calls', prompt: 'Write the handoff brief for the lead in the payload.' },
    );

    await fireAutomation(ORG, 'handoff-on-reply', { input: { contactRef: 'contacts:9412', trigger: 'reply' } });

    expect(vi.mocked(scheduledCheckBrief)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'No Lead Goes Cold' }),
      'Write the handoff brief for the lead in the payload.',
      expect.objectContaining({ contactRef: 'contacts:9412', trigger: 'reply' }),
    );
  });

  it('a schedule fire with fixed do.input still reads as a scheduled check: no payload reaches the brief', async () => {
    const { scheduledCheckBrief } = await import('@/services/MissionService');
    await seedAutomation(
      'nightly-sweep',
      { schedule: '0 2 * * *' },
      { checkMission: 'increase-discovery-calls', prompt: 'Sweep.', input: { sinceDays: 3 } },
    );

    await fireAutomation(ORG, 'nightly-sweep');

    expect(vi.mocked(scheduledCheckBrief)).toHaveBeenCalledWith(expect.anything(), 'Sweep.', undefined);
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
    await seedAutomation('sweeper', { schedule: '0 * * * *' }, { job: 'stub-job', input: { sellerDomain: 'metacto.com' } });

    const first = await fireAutomation(ORG, 'sweeper');
    const second = await fireAutomation(ORG, 'sweeper');

    const { runs, total, nextCursor } = await listAutomationRuns(ORG, { slug: 'sweeper', limit: 5 });

    expect(runs.map(r => r.id)).toEqual([second.automationRunId, first.automationRunId]);
    expect(total).toBe(2);
    expect(nextCursor).toBeNull();
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

  it('fires an automation subscribed to several event types on any of them', async () => {
    await seedAutomation('debrief', { event: ['worker_run.completed', 'pr.merged'] }, { workflow: 'discovery_followup' });

    expect((await emitEvent({ orgId: ORG, type: 'worker_run.completed', payload: {} })).triggered).toEqual([{ slug: 'automation:debrief', runId: 210 }]);
    expect((await emitEvent({ orgId: ORG, type: 'pr.merged', payload: {} })).triggered).toEqual([{ slug: 'automation:debrief', runId: 210 }]);
    expect((await emitEvent({ orgId: ORG, type: 'worker_run.failed', payload: {} })).triggered).toHaveLength(0);
  });
});

describe('debriefs and initiative', () => {
  beforeEach(async () => {
    await db.delete(agentSchema);
    await db.insert(agentSchema).values([
      { orgId: ORG, slug: 'quiet-curator', name: 'Quiet', systemPrompt: 'x', initiative: 'low' },
      { orgId: ORG, slug: 'eager-researcher', name: 'Eager', systemPrompt: 'x', initiative: 'high' },
      { orgId: ORG, slug: 'plain-agent', name: 'Plain', systemPrompt: 'x' },
    ]);
  });

  afterAll(async () => {
    await db.delete(agentSchema);
  });

  it('skips a low-initiative agent\'s automation on a completion event, and fires everyone else\'s', async () => {
    await db.insert(automationSchema).values([
      { orgId: ORG, slug: 'quiet-debrief', name: 'q', status: 'active', whenConfig: { event: 'worker_run.completed' }, doConfig: { workflow: 'discovery_followup' }, ownerAgentSlug: 'quiet-curator' },
      { orgId: ORG, slug: 'eager-debrief', name: 'e', status: 'active', whenConfig: { event: 'worker_run.completed' }, doConfig: { workflow: 'discovery_followup' }, ownerAgentSlug: 'eager-researcher' },
      { orgId: ORG, slug: 'plain-debrief', name: 'p', status: 'active', whenConfig: { event: 'worker_run.completed' }, doConfig: { workflow: 'discovery_followup' }, ownerAgentSlug: 'plain-agent' },
    ]);

    const out = await emitEvent({ orgId: ORG, type: 'worker_run.completed', payload: { workerRunId: 1 } });

    expect(out.triggered.map(t => t.slug).sort()).toEqual(['automation:eager-debrief', 'automation:plain-debrief']);
    // Skipped, not refused: no run row says the quiet one was held.
    expect(await listAutomationRuns(ORG, { slug: 'quiet-debrief' })).toMatchObject({ runs: [], total: 0 });
  });

  it('leaves a low-initiative agent\'s other automations alone — initiative gates debriefs, not work', async () => {
    await seedAutomation('quiet-reply', { event: 'prospect.reply' }, { workflow: 'discovery_followup' });
    await db.update(automationSchema).set({ ownerAgentSlug: 'quiet-curator' }).where(eq(automationSchema.slug, 'quiet-reply'));

    const out = await emitEvent({ orgId: ORG, type: 'prospect.reply', payload: {} });

    expect(out.triggered).toEqual([{ slug: 'automation:quiet-reply', runId: 210 }]);
  });
});
