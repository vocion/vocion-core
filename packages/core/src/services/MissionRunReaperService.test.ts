/**
 * `reapStaleMissionRuns` — the mission-run analogue of `WorkerRunService`'s
 * lease reaper (ADR 0004) for a run mode with no lease to lapse.
 *
 * Evidence (prod, 2026-09-28): 28 `mission_run` rows sat at `running` for
 * days — 15 `wiki-debrief`, 13 `increase-discovery-calls`, the oldest since
 * 10 July — because a mission run executes in-process and a restart or crash
 * leaves nothing to notice it died.
 *
 * A stranded run traced back to an EVENT automation (`regenerate-brief-on-
 * request`, `handoff-on-reply`) answers a specific payload that has nowhere
 * else to come from, so it is replayed once, inside 24h, as its own
 * `automation.fire` job — never run inline here, and never
 * replayed a second time. A stranded run traced to a SCHEDULE automation
 * (`wiki-debrief`, `process-new-mqls`) is superseded by its own next fire, so
 * it is only marked failed.
 *
 * The DB is the PGlite test mock (`vi.mock('@/libs/DB')`); the job start is
 * mocked — the assertions check what this code asked to start, not that the
 * fire actually ran.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A concrete, round bound makes the "N min" wording in the error easy to
// assert on, and exercises the env override at the same time. Set before the
// dynamic import below, since MissionService reads it once at module load.
process.env.VOCION_MISSION_RUN_REAP_AFTER_MS = String(20 * 60_000);

vi.mock('@/libs/DB');
vi.mock('@/libs/durable/jobs', async () => {
  const actual = await vi.importActual<typeof import('@/libs/durable/jobs')>('@/libs/durable/jobs');
  return { ...actual, startJob: vi.fn() };
});

const { db } = await import('@/libs/DB');
const { automationRunSchema, missionRunSchema, toolCallSchema } = await import('@/models/Schema');
const { automationRefireWorkflowIdFor } = await import('@/libs/durable/scheduleIds');
const { startJob } = await import('@/libs/durable/jobs');
const { reapStaleMissionRuns } = await import('@/services/MissionService');

const mockStartJob = vi.mocked(startJob);

const ORG = 'org_reap';
const OTHER_ORG = 'org_reap_other';
const NOW = new Date('2026-09-28T12:00:00Z');
const BOUND_MS = 20 * 60_000;

let workflowStart: ReturnType<typeof vi.fn>;

type SeedTask = { id: string; title: string; ownerAgentSlug: string; type: string; status: string };

function seedTask(status = 'running'): SeedTask {
  return { id: 't1', title: 'Working task', ownerAgentSlug: 'agent-x', type: 'analysis', status };
}

async function seedMissionRun(opts: {
  orgId?: string;
  status?: string;
  updatedAt: Date;
  tasks?: SeedTask[];
  causedBy?: Array<{ automationSlug: string; automationRunId?: number; missionRunId?: number }> | null;
}): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId: opts.orgId ?? ORG,
      title: 'Stranded run',
      brief: 'do the thing',
      status: opts.status ?? 'running',
      team: { lead: 'agent-x', members: [] },
      plan: { tasks: (opts.tasks ?? [seedTask()]) as never },
      causedBy: opts.causedBy ?? null,
      updatedAt: opts.updatedAt,
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

async function seedAutomationRun(opts: {
  orgId?: string;
  slug?: string;
  invokedBy: string;
  startedAt: Date;
  status?: string;
  input?: Record<string, unknown>;
}): Promise<number> {
  const [row] = await db
    .insert(automationRunSchema)
    .values({
      orgId: opts.orgId ?? ORG,
      slug: opts.slug ?? 'regenerate-brief-on-request',
      kind: 'mission_check',
      status: opts.status ?? 'running',
      invokedBy: opts.invokedBy,
      input: opts.input ?? { threadId: 'thread-1' },
      startedAt: opts.startedAt,
    })
    .returning({ id: automationRunSchema.id });
  return row!.id;
}

async function seedToolCall(orgId: string, missionRunId: number, createdAt: Date): Promise<void> {
  await db.insert(toolCallSchema).values({
    orgId,
    agentSlug: 'agent-x',
    tool: 'search_knowledge',
    missionRunId,
    createdAt,
  });
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  await db.delete(automationRunSchema);
  await db.delete(toolCallSchema);
  mockStartJob.mockReset();
  mockStartJob.mockResolvedValue({ id: 'started' });
  workflowStart = mockStartJob as never;
});

describe('reapStaleMissionRuns — reaps stale, skips fresh, skips terminal', () => {
  it('marks a run past the bound with no activity as failed, with the interruption error text', async () => {
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const id = await seedMissionRun({ status: 'running', updatedAt: staleAt });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 0, ids: [id] });

    const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, id));

    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('Stopped: the run was interrupted (no activity for 20 min; the server restarted or the process died)');
    expect(row!.completedAt).toEqual(NOW);
    // The plan is left exactly as the crash left it — same as the in-process
    // crash handler in missions/runtime.ts, which never rewrites task status.
    expect(row!.plan!.tasks[0]).toMatchObject({ id: 't1', status: 'running' });
  });

  it('leaves a run inside the bound alone', async () => {
    const freshAt = new Date(NOW.getTime() - 5 * 60_000);
    const id = await seedMissionRun({ status: 'running', updatedAt: freshAt });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 0, refired: 0, ids: [] });

    const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, id));

    expect(row!.status).toBe('running');
  });

  it.each(['completed', 'failed', 'cancelled'])('never touches a %s run however old', async (status) => {
    const ancientAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60_000);
    const id = await seedMissionRun({ status, updatedAt: ancientAt });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 0, refired: 0, ids: [] });

    const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, id));

    expect(row!.status).toBe(status);
  });

  it('leaves a run alone whose own row is stale but which has a tool call inside the bound', async () => {
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const id = await seedMissionRun({ status: 'running', updatedAt: staleAt });
    await seedToolCall(ORG, id, new Date(NOW.getTime() - 5 * 60_000));

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 0, refired: 0, ids: [] });
  });

  it('reaps a run whose only tool call is also outside the bound', async () => {
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const id = await seedMissionRun({ status: 'running', updatedAt: staleAt });
    await seedToolCall(ORG, id, new Date(NOW.getTime() - BOUND_MS - 30_000));

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 0, ids: [id] });
  });

  it('reaps a run with no linked automation without touching anything else', async () => {
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const id = await seedMissionRun({ status: 'running', updatedAt: staleAt, causedBy: null });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 0, ids: [id] });
    expect(workflowStart).not.toHaveBeenCalled();
  });
});

describe('reapStaleMissionRuns — the linked automation_run', () => {
  it('replays an event-triggered fire inside 24h as its own automationFire workflow with the original payload', async () => {
    const automationRunId = await seedAutomationRun({
      invokedBy: 'event:thread.replied',
      startedAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
      input: { threadId: 'thread-1' },
    });
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const missionRunId = await seedMissionRun({
      status: 'running',
      updatedAt: staleAt,
      causedBy: [{ automationSlug: 'regenerate-brief-on-request', automationRunId }],
    });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 1, ids: [missionRunId] });

    const [automationRun] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, automationRunId));

    expect(automationRun!.status).toBe('error');
    expect(automationRun!.error).toContain(`mission run ${missionRunId}`);
    expect(automationRun!.targetRunId).toBe(missionRunId);
    expect(automationRun!.finishedAt).toEqual(NOW);

    expect(workflowStart).toHaveBeenCalledTimes(1);
    expect(workflowStart).toHaveBeenCalledWith(automationRefireWorkflowIdFor(ORG, automationRunId, missionRunId), {
      job: 'automation.fire',
      input: {
        orgId: ORG,
        slug: 'regenerate-brief-on-request',
        input: { threadId: 'thread-1' },
        invokedBy: 'reap-refire:event:thread.replied',
      },
    });
  });

  it('marks a schedule-triggered fire failed but never replays it', async () => {
    const automationRunId = await seedAutomationRun({
      slug: 'wiki-debrief',
      invokedBy: 'automation:wiki-debrief',
      startedAt: new Date(NOW.getTime() - 45 * 60_000),
    });
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const missionRunId = await seedMissionRun({
      status: 'running',
      updatedAt: staleAt,
      causedBy: [{ automationSlug: 'wiki-debrief', automationRunId }],
    });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 0, ids: [missionRunId] });

    const [automationRun] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, automationRunId));

    expect(automationRun!.status).toBe('error');
    expect(workflowStart).not.toHaveBeenCalled();
  });

  it('marks an event-triggered fire failed but does not replay it once the event is older than 24h', async () => {
    const automationRunId = await seedAutomationRun({
      invokedBy: 'event:thread.replied',
      startedAt: new Date(NOW.getTime() - 25 * 60 * 60_000),
    });
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const missionRunId = await seedMissionRun({
      status: 'running',
      updatedAt: staleAt,
      causedBy: [{ automationSlug: 'regenerate-brief-on-request', automationRunId }],
    });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 0, ids: [missionRunId] });
    expect(workflowStart).not.toHaveBeenCalled();
  });

  it('never replays a fire that was itself a replay', async () => {
    const automationRunId = await seedAutomationRun({
      invokedBy: 'reap-refire:event:thread.replied',
      startedAt: new Date(NOW.getTime() - 60 * 60_000),
    });
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const missionRunId = await seedMissionRun({
      status: 'running',
      updatedAt: staleAt,
      causedBy: [{ automationSlug: 'regenerate-brief-on-request', automationRunId }],
    });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 0, ids: [missionRunId] });

    const [automationRun] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, automationRunId));

    expect(automationRun!.status).toBe('error');
    expect(workflowStart).not.toHaveBeenCalled();
  });

  it('leaves an automation_run already closed by something else alone', async () => {
    const automationRunId = await seedAutomationRun({
      invokedBy: 'event:thread.replied',
      startedAt: new Date(NOW.getTime() - 60 * 60_000),
      status: 'ok',
    });
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const missionRunId = await seedMissionRun({
      status: 'running',
      updatedAt: staleAt,
      causedBy: [{ automationSlug: 'regenerate-brief-on-request', automationRunId }],
    });

    const result = await reapStaleMissionRuns(NOW);

    expect(result).toEqual({ reaped: 1, refired: 0, ids: [missionRunId] });

    const [automationRun] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, automationRunId));

    expect(automationRun!.status).toBe('ok');
    expect(workflowStart).not.toHaveBeenCalled();
  });
});

describe('reapStaleMissionRuns — org scoping', () => {
  it('never closes or replays another org\'s automation_run even when a run\'s caused_by names its id', async () => {
    const otherOrgAutomationRunId = await seedAutomationRun({
      orgId: OTHER_ORG,
      invokedBy: 'event:thread.replied',
      startedAt: new Date(NOW.getTime() - 60 * 60_000),
    });
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const missionRunId = await seedMissionRun({
      orgId: ORG,
      status: 'running',
      updatedAt: staleAt,
      causedBy: [{ automationSlug: 'regenerate-brief-on-request', automationRunId: otherOrgAutomationRunId }],
    });

    const result = await reapStaleMissionRuns(NOW);

    // The mission run in ORG is still reaped on its own merits.
    expect(result).toEqual({ reaped: 1, refired: 0, ids: [missionRunId] });

    // But the other org's automation_run — looked up scoped to ORG, which
    // does not match it — is never found, so it is never touched or replayed.
    const [otherOrgRun] = await db.select().from(automationRunSchema).where(eq(automationRunSchema.id, otherOrgAutomationRunId));

    expect(otherOrgRun!.status).toBe('running');
    expect(otherOrgRun!.orgId).toBe(OTHER_ORG);
    expect(workflowStart).not.toHaveBeenCalled();
  });

  it('reaps and replays two orgs independently in one sweep', async () => {
    const autoA = await seedAutomationRun({ orgId: ORG, invokedBy: 'event:thread.replied', startedAt: new Date(NOW.getTime() - 60_000) });
    const autoB = await seedAutomationRun({ orgId: OTHER_ORG, invokedBy: 'event:thread.replied', startedAt: new Date(NOW.getTime() - 60_000) });
    const staleAt = new Date(NOW.getTime() - BOUND_MS - 60_000);
    const runA = await seedMissionRun({ orgId: ORG, status: 'running', updatedAt: staleAt, causedBy: [{ automationSlug: 'regenerate-brief-on-request', automationRunId: autoA }] });
    const runB = await seedMissionRun({ orgId: OTHER_ORG, status: 'running', updatedAt: staleAt, causedBy: [{ automationSlug: 'regenerate-brief-on-request', automationRunId: autoB }] });

    const result = await reapStaleMissionRuns(NOW);

    expect(result.reaped).toBe(2);
    expect(result.refired).toBe(2);
    expect(result.ids.toSorted()).toEqual([runA, runB].toSorted());
    expect(workflowStart).toHaveBeenCalledTimes(2);

    const orgsDispatched = workflowStart.mock.calls.map(call => (call[1] as { input: { orgId: string } }).input.orgId).toSorted();

    expect(orgsDispatched).toEqual([ORG, OTHER_ORG].toSorted());
  });
});
