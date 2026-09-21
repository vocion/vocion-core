/**
 * The workspace off switch — one hold, one guard, four refusals.
 *
 *   - The switch writes who, when and why on the project row, and clears the
 *     three columns together on resume.
 *   - The guard refuses each of the four paths that start work the factory
 *     does by itself: an automation fire (scheduled and event), a mission
 *     run, a worker run queued or claimed, and a gated action that is not a
 *     hand-off.
 *   - Chat with an agent is not gated, and neither is a worker already
 *     holding a lease: it finishes, reports, and its completion event is
 *     recorded while raising no automation.
 *   - Resuming restores per-automation pauses EXACTLY, because the workspace
 *     pause never wrote to an automation in the first place.
 *   - `workspace:apply` does not clear a pause.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 77 })),
}));
vi.mock('@/libs/temporal/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/temporal/client')>();
  return { ...actual, getTemporalClient: vi.fn(async () => {
    throw new Error('temporal unavailable in this suite');
  }) };
});

const { db } = await import('@/libs/DB');
const {
  actionRunSchema,
  automationRunSchema,
  automationSchema,
  eventLogSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
  workerRunSchema,
} = await import('@/models/Schema');
const {
  assertWorkspaceRunning,
  pauseWorkspace,
  readWorkspacePauseWithName,
  resumeWorkspace,
  WorkspacePausedError,
  WorkspacePauseStateError,
} = await import('@/services/workspacePause');
const { beginAutomationFire, listAutomationRuns, pauseAutomation } = await import('@/services/AutomationService');
const { emitEvent } = await import('@/services/EventService');
const workerRuns = await import('@/services/WorkerRunService');
const { fromRepoRoot } = await import('@/libs/repo-root');

const ORG = 'proj-factory';
const ACCT = 'acct-factory';
const CHRIS = { id: 'usr-chris', name: 'Chris' };
const AT = new Date('2026-09-21T15:14:00Z');

async function seedWorkspace(): Promise<void> {
  await db.insert(tenantAccountSchema).values({ id: ACCT, name: 'Squatch', slug: 'squatch' } as never).onConflictDoNothing();
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCT, slug: 'factory', name: 'Squatch Factory' } as never);
  await db.insert(userSchema).values({ id: CHRIS.id, name: 'Chris', email: 'chris@example.com' } as never);
}

async function seedAutomation(slug: string, whenConfig: Record<string, unknown>): Promise<void> {
  await db.insert(automationSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    status: 'active',
    whenConfig: whenConfig as never,
    doConfig: { workflow: 'wf' } as never,
  });
}

/**
 * Pull the switch, with the note the banner will show.
 * @param note
 */
async function pull(note = 'holding the factory until the release goes out'): Promise<void> {
  await pauseWorkspace(ORG, { by: CHRIS, note, now: AT });
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(workerRunSchema);
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  await db.delete(projectSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
  await seedWorkspace();
  vi.clearAllMocks();
});

afterEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(workerRunSchema);
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  await db.delete(projectSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
});

describe('pulling and lifting the switch', () => {
  it('writes who, when and why on the project row, and reads back with the name resolved', async () => {
    const pause = await pauseWorkspace(ORG, { by: CHRIS, note: '  holding the factory  ', now: AT });

    expect(pause).toEqual({ by: CHRIS, at: AT, note: 'holding the factory' });

    const [row] = await db.select().from(projectSchema).where(eq(projectSchema.id, ORG));

    expect(row!.pausedAt).toEqual(AT);
    expect(row!.pausedBy).toBe('usr-chris');
    expect(row!.pausedNote).toBe('holding the factory');

    await expect(readWorkspacePauseWithName(ORG)).resolves.toEqual({
      by: { id: 'usr-chris', name: 'Chris' },
      at: AT,
      note: 'holding the factory',
    });
  });

  it('clears all three columns on resume, and says whose hold it lifted', async () => {
    await pull('CRM sync is down');

    const { lifted } = await resumeWorkspace(ORG, { by: { id: 'usr-other', name: 'Someone else' } });

    expect(lifted).toEqual({ by: { id: 'usr-chris', name: 'Chris' }, at: AT, note: 'CRM sync is down' });

    const [row] = await db.select().from(projectSchema).where(eq(projectSchema.id, ORG));

    expect(row!.pausedAt).toBeNull();
    expect(row!.pausedBy).toBeNull();
    expect(row!.pausedNote).toBeNull();
    await expect(readWorkspacePauseWithName(ORG)).resolves.toBeNull();
  });

  it('refuses a stop with no reason — the banner would have nothing to say', async () => {
    await expect(pauseWorkspace(ORG, { by: CHRIS, note: '   ' })).rejects.toBeInstanceOf(WorkspacePauseStateError);
  });

  it('refuses a second pause and a resume on a running workspace — a second operator learns the first got there', async () => {
    await pull();

    await expect(pull()).rejects.toThrow(/already paused/);

    await resumeWorkspace(ORG, { by: CHRIS });

    await expect(resumeWorkspace(ORG, { by: CHRIS })).rejects.toThrow(/not paused/);
  });

  it('names an API token as itself, because no person is behind it in the moment', async () => {
    await pauseWorkspace(ORG, { by: { id: 'token:abc123' }, note: 'stopped from a terminal', now: AT });

    await expect(readWorkspacePauseWithName(ORG)).resolves.toMatchObject({
      by: { id: 'token:abc123', name: 'API token abc123' },
    });
  });
});

describe('the guard refuses the four paths that start work', () => {
  it('names what it refused and carries the note, so the refusal says what to do', async () => {
    await pull('holding until the release goes out');

    const err = await assertWorkspaceRunning(ORG, 'mission_run').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspacePausedError);
    expect((err as { code: string }).code).toBe('WORKSPACE_PAUSED');
    expect((err as Error).message).toContain('holding until the release goes out');
    expect((err as Error).message).toContain('a mission run will not start');
    expect((err as Error).message).toContain('Chris');
  });

  it('refuses a scheduled automation fire and writes a skipped run saying why', async () => {
    await seedAutomation('hourly-check', { schedule: '0 * * * *' });
    await pull();

    await expect(beginAutomationFire(ORG, 'hourly-check')).rejects.toBeInstanceOf(WorkspacePausedError);

    const { runs } = await listAutomationRuns(ORG, { slug: 'hourly-check' });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: 'skipped', status: 'ok', invokedBy: 'automation:hourly-check' });
    expect(runs[0]!.result).toMatchObject({ kind: 'skipped', reason: 'workspace_paused' });
  });

  it('refuses an event automation, records the skip, and still logs the event', async () => {
    await seedAutomation('wiki-debrief', { event: 'worker_run.completed' });
    await pull();

    const result = await emitEvent({ orgId: ORG, type: 'worker_run.completed', payload: { workerRunId: 1 } });

    expect(result.triggered).toEqual([]);
    expect(result.skipped).toEqual([{ slug: 'wiki-debrief', automationRunId: expect.any(Number), reason: 'workspace_paused' }]);

    // The event itself is still on the record — a completion that happened
    // happened, whether or not anything was allowed to act on it.
    const events = await db.select().from(eventLogSchema);

    expect(events).toHaveLength(1);
    expect(events[0]!.triggered).toEqual([]);

    const { runs } = await listAutomationRuns(ORG, { slug: 'wiki-debrief' });

    expect(runs[0]!.result).toMatchObject({ reason: 'workspace_paused' });
    expect((runs[0]!.result as { detail: string }).detail).toContain('Chris');
  });

  it('refuses a mission run', async () => {
    const { startMission } = await import('@/services/MissionService');
    await pull();

    await expect(startMission({ orgId: ORG, brief: 'ship it', team: { lead: 'a', members: [] } }))
      .rejects
      .toBeInstanceOf(WorkspacePausedError);
  });

  it('refuses a worker run at the queue and at the claim', async () => {
    const queued = await workerRuns.createWorkerRun({ orgId: ORG, agentSlug: 'task-engineer', input: {} });
    await pull();

    await expect(workerRuns.createWorkerRun({ orgId: ORG, agentSlug: 'task-engineer', input: {} }))
      .rejects
      .toBeInstanceOf(WorkspacePausedError);
    // The claim is the half that matters: the Fargate worker polls, so this
    // is what stops work starting on runs queued before the switch.
    await expect(workerRuns.claimWorkerRun({ orgId: ORG, id: queued.id, workerId: 'w1' }))
      .rejects
      .toBeInstanceOf(WorkspacePausedError);
  });

  it('refuses a gated action, and leaves the run where the approver left it', async () => {
    const { executeAction } = await import('@/services/ActionService');
    // A registered, non-manual kind: it runs code on the workspace's behalf,
    // which is precisely what a stopped workspace must not do.
    const [run] = await db.insert(actionRunSchema).values({
      orgId: ORG,
      actionId: 'mission.update_notes',
      status: 'pending',
      input: {},
    } as never).returning();
    await pull();

    await expect(executeAction(run!.id, ORG)).rejects.toBeInstanceOf(WorkspacePausedError);

    const [after] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, run!.id));

    expect(after!.status).toBe('pending');
  });
});

describe('what the switch deliberately allows', () => {
  it('is asked by exactly the four paths that start work — chat is not one of them', () => {
    // A structural test, because "chat stays available" is a claim about
    // where the guard is NOT called, and the only honest way to check that is
    // to read every call site. A fifth caller appearing here is a product
    // decision, so it should fail this test and be argued for.
    const callers = [
      'src/services/ActionService.ts',
      'src/services/AutomationService.ts',
      'src/services/MissionService.ts',
      'src/services/WorkerRunService.ts',
    ];
    for (const file of callers) {
      expect(readFileSync(fromRepoRoot(join('packages/core', file)), 'utf-8'), file).toContain('assertWorkspaceRunning(');
    }
    for (const file of ['src/services/ChatSurfaceService.ts', 'src/services/ConversationService.ts', 'src/services/AgentService.ts']) {
      expect(readFileSync(fromRepoRoot(join('packages/core', file)), 'utf-8'), file).not.toContain('assertWorkspaceRunning(');
    }
  });

  it('lets a worker already mid-run finish and report, and records its completion raising no automation', async () => {
    await seedAutomation('wiki-debrief', { event: 'worker_run.completed' });
    const run = await workerRuns.createWorkerRun({ orgId: ORG, agentSlug: 'task-engineer', input: {} });
    const claimed = await workerRuns.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1' });

    expect(claimed.run.status).toBe('running');

    // The switch is pulled with the worker already holding the lease.
    await pull();

    await workerRuns.heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1' });
    const done = await workerRuns.completeWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1', summary: 'Merged the fix.' });

    expect(done.status).toBe('completed');

    const events = await db.select().from(eventLogSchema);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('worker_run.completed');
    expect(events[0]!.triggered).toEqual([]);

    // Nothing was fired by it; the refusal is on the record instead.
    const { runs } = await listAutomationRuns(ORG, { slug: 'wiki-debrief' });

    expect(runs.every(r => r.kind === 'skipped')).toBe(true);
  });

  it('releases a hand-off action — a person doing the work by hand is not the factory', async () => {
    const { executeAction } = await import('@/services/ActionService');
    const { getAction } = await import('@/libs/actions/registry');
    const { isManualAction } = await import('@/libs/actions/manual');
    // `git.merge` is the factory's own hand-off — the one Chris performs by
    // hand, which is exactly why a paused workspace still releases it.
    const handoff = getAction('git.merge');

    expect(handoff && isManualAction(handoff)).toBe(true);

    const [run] = await db.insert(actionRunSchema).values({
      orgId: ORG,
      actionId: 'git.merge',
      status: 'pending',
      input: { riskClass: 'docs' },
    } as never).returning();
    await pull();

    const result = await executeAction(run!.id, ORG, { reviewedBy: CHRIS.id });

    expect(result.status).toBe('awaiting_execution');
  });
});

describe('resuming restores per-automation state exactly', () => {
  it('leaves the automations a person paused individually still paused, and the rest running', async () => {
    await seedAutomation('wiki-debrief', { event: 'worker_run.completed' });
    await seedAutomation('pr-debrief', { event: 'worker_run.completed' });
    await seedAutomation('hourly-check', { schedule: '0 * * * *' });
    await seedAutomation('nightly-sweep', { schedule: '0 3 * * *' });

    // Two were paused last week, one each way, for their own reasons.
    await pauseAutomation(ORG, 'wiki-debrief', { by: CHRIS, note: 'noisy since the 20th' });
    await pauseAutomation(ORG, 'nightly-sweep', { by: CHRIS, note: 'CRM sync' });

    const before = await automationPauseSnapshot();

    await pull();
    await resumeWorkspace(ORG, { by: CHRIS });

    // Byte for byte the same: the workspace pause never wrote to an
    // automation, so there was nothing to restore and nothing to lose.
    await expect(automationPauseSnapshot()).resolves.toEqual(before);
    expect(before).toEqual([
      { slug: 'hourly-check', paused: false, note: null },
      { slug: 'nightly-sweep', paused: true, note: 'CRM sync' },
      { slug: 'pr-debrief', paused: false, note: null },
      { slug: 'wiki-debrief', paused: true, note: 'noisy since the 20th' },
    ]);
  });

  it('still refuses the automations that were NOT individually paused, while the workspace is held', async () => {
    await seedAutomation('pr-debrief', { event: 'worker_run.completed' });
    await pull();

    await expect(beginAutomationFire(ORG, 'pr-debrief')).rejects.toBeInstanceOf(WorkspacePausedError);

    await resumeWorkspace(ORG, { by: CHRIS });
    const fired = await beginAutomationFire(ORG, 'pr-debrief');

    expect(fired.automationRunId).toEqual(expect.any(Number));
  });
});

describe('workspace:apply', () => {
  it('never writes the pause columns — a deploy does not lift a person\'s stop', () => {
    // The applier's project update names every column it sets. This asserts
    // the pause columns are not among them, which is the whole guarantee:
    // #494 made the same promise for `automation.paused_at` and this is its
    // workspace-level twin.
    const applier = readFileSync(fromRepoRoot('packages/core/src/libs/workspace/applier.ts'), 'utf-8');
    const updates = applier.match(/\.update\(projectSchema\)[\s\S]*?\.where\(/g) ?? [];

    expect(updates.length).toBeGreaterThan(0);

    for (const update of updates) {
      expect(update).not.toContain('pausedAt');
      expect(update).not.toContain('pausedBy');
      expect(update).not.toContain('pausedNote');
    }
  });

  it('leaves a pause standing across an apply of the project row', async () => {
    await pull('holding for the release');
    // Whatever else an apply rewrites, the three columns are untouched:
    // simulated here as the applier's own update, column for column.
    await db.update(projectSchema).set({ goal: 'ship the release', leadAgentSlug: 'factory-lead' }).where(eq(projectSchema.id, ORG));

    await expect(readWorkspacePauseWithName(ORG)).resolves.toMatchObject({ note: 'holding for the release' });
  });
});

/** Every automation's pause, ordered, for a before/after comparison. */
async function automationPauseSnapshot(): Promise<Array<{ slug: string; paused: boolean; note: string | null }>> {
  const rows = await db
    .select({ slug: automationSchema.slug, pausedAt: automationSchema.pausedAt, pausedNote: automationSchema.pausedNote })
    .from(automationSchema)
    .where(eq(automationSchema.orgId, ORG));
  return rows
    .map(r => ({ slug: r.slug, paused: r.pausedAt !== null, note: r.pausedNote }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
