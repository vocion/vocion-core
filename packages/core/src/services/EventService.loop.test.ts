/**
 * The runaway of 20 September 2026, and the two rules that stop it.
 *
 * `wiki-debrief` subscribed to `mission_run.completed`; each fire was a
 * mission check; each check's completion raised the event; which fired it
 * again — sixty runs in minutes. Here:
 *
 *   - a fire stamps its chain on the mission run it starts, the run's
 *     completion carries the chain, and the automation on it is refused —
 *     with a `skipped` row saying why — while a different automation on the
 *     same event still fires;
 *   - a completed run of the mission an automation checks is refused even
 *     when the chain is missing (a run started before the chain existed);
 *   - past `when.maxFiresPer10m` (default 6) event fires in ten minutes, the
 *     fire is held, one coalesced fire is arranged after the window, and
 *     when it runs its result says how many it covered.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 210 })),
}));
vi.mock('@/services/MissionService', () => ({
  getMission: vi.fn(async (_orgId: string, slug: string) => ({ id: slug === 'wiki-debrief' ? 1 : 2, name: slug, goal: 'goal', successCriteria: [] })),
  scheduledCheckBrief: vi.fn(() => 'check brief'),
  startMission: vi.fn(async () => ({ id: 2505, status: 'completed' })),
}));

const temporal = {
  start: vi.fn(async (_type: string, _opts: unknown) => {}),
};
vi.mock('@/libs/temporal/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/temporal/client')>();
  return {
    ...actual,
    getTemporalClient: vi.fn(async () => ({ workflow: { start: temporal.start } })),
  };
});

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, eventLogSchema } = await import('@/models/Schema');
const { startMission } = await import('@/services/MissionService');
const { fireAutomation, recentSkipsBySlug, SKIPPED_RUN_KIND, lastRunBySlug } = await import('@/services/AutomationService');
const { emitEvent, MISSION_RUN_COMPLETED } = await import('@/services/EventService');
const { automationCoalescedWorkflowIdFor } = await import('@/libs/temporal/client');
const { RATE_LIMIT_WINDOW_MS } = await import('@/services/automations/fireGuards');

const ORG = 'org_loop';

async function seed(slug: string, checkMission: string, when: Record<string, unknown> = { event: MISSION_RUN_COMPLETED }) {
  await db.insert(automationSchema).values({ orgId: ORG, slug, name: slug, status: 'active', whenConfig: when as never, doConfig: { checkMission } });
}

/**
 * A `mission_run.completed` payload, as the runtime raises it.
 * @param missionSlug
 * @param missionRunId
 */
function completed(missionSlug: string, missionRunId = 2505) {
  return { missionRunId, missionId: 1, missionSlug, title: `wiki-debrief: ${missionSlug}`, agentSlug: 'wiki-researcher', mode: 'check', summary: '…', tasksTotal: 1, tasksFailed: 0, completedAt: new Date().toISOString() };
}

async function runsOf(slug: string) {
  return db.select().from(automationRunSchema).where(eq(automationRunSchema.slug, slug));
}

beforeEach(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
});

describe('an automation never fires on its own run\'s event', () => {
  it('stamps the chain on the mission run its check starts', async () => {
    await seed('wiki-debrief', 'wiki-debrief');

    const out = await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('some-other-mission', 2400) });

    expect(out.triggered).toHaveLength(1);

    const [automationRun] = await runsOf('wiki-debrief');

    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({
      missionSlug: 'wiki-debrief',
      causedBy: [{ automationSlug: 'wiki-debrief', automationRunId: automationRun!.id }],
    }));
  });

  it('refuses the automation whose run raised the event, and still fires a different one on it', async () => {
    await seed('wiki-debrief', 'wiki-debrief');
    await seed('product-debrief', 'product-debrief');
    // What the runtime raises when the debrief's own check completes: the
    // chain the check stamped on the run, with the run id filled in.
    const chain = [{ automationSlug: 'wiki-debrief', automationRunId: 41, missionRunId: 2505 }];

    const out = await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('wiki-debrief'), causedBy: chain, invokedBy: 'mission_run:2505' });

    // The other debrief fired, carrying the chain forward with itself in front.
    expect(vi.mocked(startMission)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({
      missionSlug: 'product-debrief',
      causedBy: [{ automationSlug: 'product-debrief', automationRunId: expect.any(Number) }, ...chain],
    }));
    expect(out.triggered.map(t => t.slug)).toEqual(['automation:product-debrief']);

    // The loop-closer is on the record, not silent.
    expect(out.skipped).toEqual([{ slug: 'wiki-debrief', automationRunId: expect.any(Number), reason: 'self_trigger' }]);

    const [skip] = await runsOf('wiki-debrief');

    expect(skip).toMatchObject({
      kind: SKIPPED_RUN_KIND,
      status: 'ok',
      invokedBy: `event:${MISSION_RUN_COMPLETED}`,
      result: { kind: 'skipped', reason: 'self_trigger', event: MISSION_RUN_COMPLETED, causedBy: chain },
    });
    expect((skip!.result as { detail: string }).detail).toContain('mission run 2505');

    // The event row carries the chain, so the loop can be read back later.
    // The other debrief's check raised `automation_run.completed` of its own,
    // with itself in front of the chain — and that row lands first, because
    // the outer event is written after its fires complete.
    const events = await db.select().from(eventLogSchema);
    const byType = new Map(events.map(e => [e.type, e.causedBy]));

    expect([...byType.keys()].sort()).toEqual(['automation_run.completed', MISSION_RUN_COMPLETED]);
    expect(byType.get(MISSION_RUN_COMPLETED)).toEqual(chain);
    expect(byType.get('automation_run.completed')).toEqual([{ automationSlug: 'product-debrief', automationRunId: expect.any(Number), missionRunId: 2505 }, ...chain]);
  });

  it('refuses a completed run of the mission it checks even with no chain — a run from before the chain existed', async () => {
    await seed('wiki-debrief', 'wiki-debrief');
    await seed('product-debrief', 'product-debrief');

    const out = await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('wiki-debrief') });

    expect(out.skipped.map(s => `${s.slug}:${s.reason}`)).toEqual(['wiki-debrief:self_trigger']);
    expect(vi.mocked(startMission)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startMission)).toHaveBeenCalledWith(expect.objectContaining({ missionSlug: 'product-debrief' }));
  });

  it('the whole loop: a debrief fire completing must not re-fire it', async () => {
    await seed('wiki-debrief', 'wiki-debrief');

    // Fire 1: some other mission's run completed. The debrief fires.
    await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('quarter-pipeline-watch', 2400), invokedBy: 'mission_run:2400' });
    const chain = vi.mocked(startMission).mock.calls[0]![0].causedBy!;
    vi.mocked(startMission).mockClear();

    // The check's own run completes and the runtime raises the event with the run's chain.
    const out = await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('wiki-debrief', 2505), causedBy: chain.map((l, i) => (i === 0 ? { ...l, missionRunId: 2505 } : l)), invokedBy: 'mission_run:2505' });

    expect(vi.mocked(startMission)).not.toHaveBeenCalled();
    expect(out.triggered).toEqual([]);
    expect(out.skipped).toHaveLength(1);

    // One real fire, one refusal — and the card's "last run" is the fire.
    const runs = await runsOf('wiki-debrief');

    expect(runs.map(r => r.kind).sort()).toEqual(['mission_check', SKIPPED_RUN_KIND]);
    expect((await lastRunBySlug(ORG)).get('wiki-debrief')?.kind).toBe('mission_check');
  });
});

describe('the ceiling per automation', () => {
  async function priorEventFires(slug: string, n: number, ageMs = 0) {
    const startedAt = new Date(Date.now() - ageMs);
    for (let i = 0; i < n; i++) {
      await db.insert(automationRunSchema).values({ orgId: ORG, slug, kind: 'mission_check', status: 'ok', invokedBy: `event:${MISSION_RUN_COMPLETED}`, dryRun: false, input: {}, startedAt, finishedAt: startedAt });
    }
  }

  it('holds the seventh event fire in ten minutes, arranges one coalesced fire, and says so on the card', async () => {
    await seed('wiki-debrief', 'wiki-debrief');
    await priorEventFires('wiki-debrief', 6);

    const out = await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('quarter-pipeline-watch', 2400) });

    expect(vi.mocked(startMission)).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([{ slug: 'wiki-debrief', automationRunId: expect.any(Number), reason: 'rate_limited' }]);
    expect(temporal.start).toHaveBeenCalledTimes(1);
    expect(temporal.start).toHaveBeenCalledWith('automationFire', expect.objectContaining({
      workflowId: automationCoalescedWorkflowIdFor(ORG, 'wiki-debrief'),
      args: [{ orgId: ORG, slug: 'wiki-debrief', coalesce: true }],
      startDelay: RATE_LIMIT_WINDOW_MS,
    }));

    const skip = (await runsOf('wiki-debrief')).find(r => r.kind === SKIPPED_RUN_KIND)!;

    expect(skip.result).toMatchObject({ kind: 'skipped', reason: 'rate_limited', ceiling: 6, coalesce: 'scheduled', coalescedInto: null });

    const skips = await recentSkipsBySlug(ORG);

    expect(skips.get('wiki-debrief')).toEqual({ selfTrigger: 0, rateLimited: 1, ceiling: 6 });
  });

  it('a second held fire finds the coalesced fire already waiting', async () => {
    await seed('wiki-debrief', 'wiki-debrief');
    await priorEventFires('wiki-debrief', 6);
    temporal.start.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
      throw Object.assign(new Error('Workflow execution already started'), { name: 'WorkflowExecutionAlreadyStartedError' });
    });

    await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('a', 1) });
    await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('b', 2) });

    const coalesce = (await runsOf('wiki-debrief')).filter(r => r.kind === SKIPPED_RUN_KIND).map(r => (r.result as { coalesce: string }).coalesce).sort();

    expect(coalesce).toEqual(['pending', 'scheduled']);
  });

  it('the coalesced fire covers the held ones and its result says how many', async () => {
    await seed('wiki-debrief', 'wiki-debrief');
    await priorEventFires('wiki-debrief', 6);
    await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('a', 1) });
    await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('b', 2) });
    vi.mocked(startMission).mockClear();

    const fired = await fireAutomation(ORG, 'wiki-debrief', { invokedBy: 'event:coalesced', coalesce: true });

    expect(vi.mocked(startMission)).toHaveBeenCalledTimes(1);
    expect((fired.result as { coalesced: number }).coalesced).toBe(2);
    // The work was told what it stands in for.
    expect(vi.mocked(startMission).mock.calls[0]![0].brief).toBeDefined();

    const runs = await runsOf('wiki-debrief');
    const held = runs.filter(r => r.kind === SKIPPED_RUN_KIND);

    expect(held.map(r => (r.result as { coalescedInto: number }).coalescedInto)).toEqual([fired.automationRunId, fired.automationRunId]);
    expect(runs.find(r => r.id === fired.automationRunId)!.input).toMatchObject({ coalesced: 2 });

    // Covered once: a later coalesced fire finds nothing to claim.
    const again = await fireAutomation(ORG, 'wiki-debrief', { invokedBy: 'event:coalesced', coalesce: true });

    expect((again.result as { coalesced?: number } | undefined)?.coalesced).toBeUndefined();
  });

  it('honours an authored when.maxFiresPer10m', async () => {
    await seed('wiki-debrief', 'wiki-debrief', { event: MISSION_RUN_COMPLETED, maxFiresPer10m: 2 });
    await priorEventFires('wiki-debrief', 2);

    const out = await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('a', 1) });

    expect(out.skipped[0]?.reason).toBe('rate_limited');
    expect(vi.mocked(startMission)).not.toHaveBeenCalled();
  });

  it('counts only the window, and only event fires', async () => {
    await seed('wiki-debrief', 'wiki-debrief');
    // Six fires eleven minutes ago, plus six schedule fires just now — neither counts.
    await priorEventFires('wiki-debrief', 6, RATE_LIMIT_WINDOW_MS + 60_000);
    for (let i = 0; i < 6; i++) {
      await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'wiki-debrief', kind: 'mission_check', status: 'ok', invokedBy: 'automation:wiki-debrief', dryRun: false, input: {} });
    }

    const out = await emitEvent({ orgId: ORG, type: MISSION_RUN_COMPLETED, payload: completed('a', 1) });

    expect(out.skipped).toEqual([]);
    expect(vi.mocked(startMission)).toHaveBeenCalledTimes(1);
  });
});
