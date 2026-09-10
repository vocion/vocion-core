/**
 * `resumeMission` concurrency (vocion-core#112).
 *
 * The review UI's approve action, and the MCP `mission_approve` tool, both
 * land on `resumeMission`. Before this fix it read the run, decided it was
 * resumable, and only then wrote — no predicate tying that write to the
 * status it had just read. Two approve clicks (a slow reviewer double-click,
 * or the UI action plus an MCP call) could both pass the read, both flip the
 * gated task to `pending`, and both call `executeMissionRun`, so the same
 * task ran through `runAgentDeep` twice: duplicate LLM spend, duplicate
 * artifacts, and whichever execution's `patch()` wrote last silently
 * clobbered the other's task output.
 *
 * `runAgentDeep` is mocked — no live model call — and every call is logged
 * so a test can tell "ran once" from "ran twice" without depending on the
 * order two racing promises happen to settle in. The DB is the PGlite test
 * mock (`vi.mock('@/libs/DB')`), so the claim itself runs for real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { cancelMission, getMissionRun, MissionRunNotResumableError, resumeMission } = await import('@/services/MissionService');

const mockRun = vi.mocked(runAgentDeep);

const ORG = 'org_resume_race';
const OTHER_ORG = 'org_resume_race_other';

type SeedTask = { id: string; title: string; ownerAgentSlug: string; type: string; status: string; approvalRequired?: boolean };

/**
 * A single gated task sitting at the approval gate, ready to resume.
 * @param id
 */
function gatedTask(id = 't1'): SeedTask {
  return {
    id,
    title: 'Draft the outreach note',
    ownerAgentSlug: 'agent-x',
    // Not an EXTERNAL_TYPES entry, so once `approvalRequired` clears it
    // won't immediately re-gate itself at a low autonomy level.
    type: 'analysis',
    status: 'awaiting_approval',
    approvalRequired: true,
  };
}

async function seedRun(opts: { status: string; tasks: SeedTask[]; orgId?: string }): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId: opts.orgId ?? ORG,
      title: 'Race test run',
      brief: 'do the thing',
      status: opts.status,
      pauseReason: opts.status === 'awaiting_review' ? `awaiting_approval:${opts.tasks[0]?.id}` : null,
      pausedAt: opts.status === 'awaiting_review' ? new Date() : null,
      team: { lead: 'agent-x', members: [] },
      plan: { tasks: opts.tasks as never },
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  mockRun.mockReset();
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('resumeMission — claiming the run before executing', () => {
  it('runs the gated task once across two simultaneous resumes; the loser gets a clear not-resumable error', async () => {
    const runLog: string[] = [];
    mockRun.mockImplementation(async ({ agentSlug }) => {
      runLog.push(agentSlug);
      return { response: 'drafted', traceId: 'trace-1', toolCalls: [] };
    });
    const runId = await seedRun({ status: 'awaiting_review', tasks: [gatedTask()] });

    const outcomes = await Promise.allSettled([
      resumeMission(runId, ORG),
      resumeMission(runId, ORG),
    ]);

    expect(outcomes.map(o => o.status).toSorted()).toEqual(['fulfilled', 'rejected']);

    const refusal = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;

    expect(refusal.reason).toBeInstanceOf(MissionRunNotResumableError);
    // The agent did the work once, not twice — the whole point of the claim.
    expect(runLog).toEqual(['agent-x']);
  });

  it('leaves plan.tasks and artifacts coherent after a raced resume — no duplicate artifact entries', async () => {
    mockRun.mockImplementation(async () => ({
      response: 'drafted',
      traceId: 'trace-1',
      toolCalls: [{ tool: 'generate_image', input: {}, output: 'saved to /artifacts/outreach-1.png' }],
    }));
    const runId = await seedRun({ status: 'awaiting_review', tasks: [gatedTask()] });

    await Promise.allSettled([
      resumeMission(runId, ORG),
      resumeMission(runId, ORG),
    ]);

    const finalRun = await getMissionRun(runId, ORG);

    expect(finalRun!.plan!.tasks).toHaveLength(1);
    expect(finalRun!.plan!.tasks[0]).toMatchObject({ id: 't1', status: 'completed', output: 'drafted' });
    // One execution, one artifact — a second racer writing its own copy of
    // the artifacts array on top is exactly how this used to double up.
    expect(finalRun!.artifacts).toHaveLength(1);
    expect(finalRun!.artifacts![0]).toMatchObject({ taskId: 't1', kind: 'image', url: '/artifacts/outreach-1.png' });
  });

  it('a normal single resume still advances the task past the approval gate', async () => {
    mockRun.mockResolvedValue({ response: 'drafted', traceId: 'trace-1', toolCalls: [] });
    const runId = await seedRun({ status: 'awaiting_review', tasks: [gatedTask()] });

    const result = await resumeMission(runId, ORG);

    expect(result.plan!.tasks[0]).toMatchObject({ id: 't1', status: 'completed', approvalRequired: false });
    expect(result.pauseReason).toBeNull();
    expect(result.status).toBe('completed');
  });

  it('rejects resuming a run that is currently running', async () => {
    const runId = await seedRun({ status: 'running', tasks: [gatedTask()] });

    await expect(resumeMission(runId, ORG)).rejects.toBeInstanceOf(MissionRunNotResumableError);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('rejects resuming a run that has already completed', async () => {
    const runId = await seedRun({ status: 'completed', tasks: [{ ...gatedTask(), status: 'completed', approvalRequired: false }] });

    await expect(resumeMission(runId, ORG)).rejects.toBeInstanceOf(MissionRunNotResumableError);
    expect(mockRun).not.toHaveBeenCalled();
  });

  // Note on what this test can and can't prove: `resumeMission` checks the
  // org twice — once reading the row (`getMissionRun`), once inside the
  // claim UPDATE's own WHERE. Both checks are handed the exact same `orgId`
  // argument, and a run's `id` is a global primary key (not scoped per org),
  // so there is no way to reach the UPDATE with an `orgId` that disagrees
  // with what the read already checked — the read always loses first. That
  // makes the UPDATE's own `eq(missionRunSchema.orgId, orgId)` real
  // belt-and-suspenders (the right call for an atomic claim to stand on its
  // own even if the surrounding function changes later), but it also means
  // this test — and no test written against the public `resumeMission` API
  // — can independently prove that specific line matters today. Removing it
  // would only be caught by a change to `resumeMission` that drops or
  // reorders the earlier `getMissionRun` guard, not by this test.
  it('rejects a cross-org resume at the initial read, before the claim UPDATE ever runs', async () => {
    const runId = await seedRun({ status: 'awaiting_review', tasks: [gatedTask()] });

    await expect(resumeMission(runId, OTHER_ORG)).rejects.toThrow();
    expect(mockRun).not.toHaveBeenCalled();

    // The run itself is untouched — a cross-org call didn't clear the gate.
    const untouched = await getMissionRun(runId, ORG);

    expect(untouched!.status).toBe('awaiting_review');
    expect(untouched!.plan!.tasks[0]).toMatchObject({ status: 'awaiting_approval' });
  });
});

describe('resumeMission — a crash right after the claim does not strand the run at "running"', () => {
  it('lands the run at "failed" (never a silent "running") when execution setup throws before its own patch', async () => {
    const runId = await seedRun({ status: 'awaiting_review', tasks: [gatedTask()] });

    // The claim UPDATE inside resumeMission already flipped this row to
    // `running`. `executeMissionRun`'s very first statement is a `db.select`
    // read of that same row — before it has ever called its own `patch()`.
    // Forcing that read to throw reproduces "the process dies between the
    // claim and the first patch": before this fix, nothing downstream could
    // ever move the row off `running` again, because the reclaim predicate
    // in resumeMission only matches `awaiting_review`.
    const selectSpy = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('simulated db outage right after the claim');
    });

    const result = await resumeMission(runId, ORG);
    selectSpy.mockRestore();

    // The reviewer gets a plain failed run back, not an unhandled error and
    // not a run quietly sitting at "running" with no way to touch it again.
    expect(result.status).toBe('failed');
    expect(result.status).not.toBe('running');
    expect(result.error).toContain('simulated db outage right after the claim');
    expect(mockRun).not.toHaveBeenCalled();

    // Read it back fresh too, not just the value resumeMission handed back —
    // proves the failed status was actually persisted, not just returned.
    const stored = await getMissionRun(runId, ORG);

    expect(stored!.status).toBe('failed');
  });

  it('leaves a deliberate cancellation alone instead of writing over it when the tasks finish', async () => {
    const runId = await seedRun({ status: 'awaiting_review', tasks: [gatedTask()] });

    // A person cancels while the gated task is still running. `cancelMission`
    // writes `cancelled` with no status guard, and the execution loop used to
    // write its own outcome straight over the top — the cancellation simply
    // disappeared and the reviewer saw a run that carried on regardless.
    mockRun.mockImplementationOnce(async () => {
      await cancelMission(runId, ORG, 'cancelled by the reviewer mid-run');
      return { response: 'work the reviewer no longer wants', traceId: 'trace-cancel', toolCalls: [] };
    });

    await resumeMission(runId, ORG);

    const stored = await getMissionRun(runId, ORG);

    expect(stored!.status).toBe('cancelled');
    expect(stored!.error).toBe('cancelled by the reviewer mid-run');
  });

  it('records a finished run as completed when a transient blip breaks the first attempt to write that status', async () => {
    mockRun.mockResolvedValue({ response: 'drafted', traceId: 'trace-blip', toolCalls: [] });
    const runId = await seedRun({ status: 'awaiting_review', tasks: [gatedTask()] });

    // The tasks all succeeded; only the write recording that outcome blew
    // up, and only once. Reporting `failed` here would tell the reviewer
    // their work was lost when it was not — the run finished, the database
    // just hiccuped on the way to writing it down.
    const originalUpdate = db.update.bind(db);
    let alreadyFailedOnce = false;
    const updateSpy = vi.spyOn(db, 'update').mockImplementation(((table: Parameters<typeof db.update>[0]) => {
      const builder = originalUpdate(table);
      const originalSet = builder.set.bind(builder);
      builder.set = ((values: Record<string, unknown>) => {
        if (values?.status === 'completed' && !alreadyFailedOnce) {
          alreadyFailedOnce = true;
          throw new Error('simulated db blip while recording the outcome');
        }
        return originalSet(values as never);
      }) as typeof builder.set;
      return builder;
    }) as typeof db.update);

    await resumeMission(runId, ORG);
    updateSpy.mockRestore();

    const stored = await getMissionRun(runId, ORG);

    expect(alreadyFailedOnce).toBe(true);
    expect(stored!.status).toBe('completed');
    expect(stored!.error).toBeNull();
  });
});
