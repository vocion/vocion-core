/**
 * F1 pre-build gate B — proof that `startMission` with an EXPLICIT
 * `{lead, members}` team dispatches the lead AND every member as real
 * agent runs, on today's machinery, with zero new code. No live model
 * call: `runAgentDeep` is mocked; the DB is the PGlite test mock.
 *
 * The mission path this proves (all citations against the current files):
 *  - MissionService.ts:59–76 — `startMission` accepts `team?: {lead,
 *    members}`; line 76 (`let team = opts.team`) makes the explicit team
 *    authoritative — the `parentAgentSlug` reverse-lookup fallback at
 *    MissionService.ts:92–98 only runs when no explicit team is given.
 *  - MissionService.ts:134 — the explicit team is handed to
 *    `planMission({ orgId, brief, goal, team, userId })`.
 *  - planner.ts:21–35 — the planning prompt's roster is exactly
 *    `[team.lead, ...team.members]`; planner.ts:59 + 78–80 — every
 *    planned task's `ownerAgentSlug` is validated against that same
 *    set (invalid owners re-assigned to the lead).
 *  - runtime.ts:62–96 — `executeMissionRun` walks the task graph and
 *    dispatches EACH task to its owner via
 *    `runAgentDeep({ agentSlug: task.ownerAgentSlug, ... })` (line 92).
 *
 * F1's slice-2 change is therefore only member RESOLUTION (team table
 * lookup instead of parentAgentSlug reverse-lookup) — the dispatch
 * machinery itself needs nothing new.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { startMission } = await import('@/services/MissionService');

const mockRun = vi.mocked(runAgentDeep);

const ORG = 'org_f1_gate_b';
const LEAD = 'revenue-lead';
const MEMBERS = ['pipeline-analyst', 'follow-up-coordinator', 'proposal-writer', 'revenue-insights'];

/** The plan the lead "returns" — one task per member + a lead synthesis. */
const PLAN_JSON = JSON.stringify({
  tasks: [
    { id: 't1', title: 'Pipeline health', ownerAgentSlug: 'pipeline-analyst', type: 'analysis' },
    { id: 't2', title: 'Follow-up status', ownerAgentSlug: 'follow-up-coordinator', type: 'analysis' },
    { id: 't3', title: 'Proposals out', ownerAgentSlug: 'proposal-writer', type: 'analysis' },
    { id: 't4', title: 'Insight trends', ownerAgentSlug: 'revenue-insights', type: 'analysis' },
    { id: 't5', title: 'Assemble the quarter summary', ownerAgentSlug: 'revenue-lead', type: 'synthesis', dependsOn: ['t1', 't2', 't3', 't4'] },
  ],
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('startMission with an explicit {lead, members} team (F1 gate B)', () => {
  it('plans via the lead and dispatches every team member + the lead as agent runs', async () => {
    mockRun.mockImplementation(async ({ agentSlug, message }) => ({
      response: message.includes('planning an open-ended mission')
        // Planning call (planner.ts:62–67) — the lead returns the task graph.
        ? `\`\`\`json\n${PLAN_JSON}\n\`\`\``
        // Task call (runtime.ts:90–96) — each owner produces its part.
        : `done: ${agentSlug}`,
      traceId: `trace-${agentSlug}`,
      toolCalls: [],
    }) as Awaited<ReturnType<typeof runAgentDeep>>);

    const run = await startMission({
      orgId: ORG,
      invokedBy: 'f1-gate-b',
      brief: 'How is the quarter tracking? Consult each team lead and assemble one summary.',
      team: { lead: LEAD, members: MEMBERS },
    });

    // The explicit team is authoritative and persisted on the run
    // (MissionService.ts:76 — no template, no parentAgentSlug lookup).
    expect(run.team).toEqual({ lead: LEAD, members: MEMBERS });
    expect(run.status).toBe('completed');

    // Call 1 is the planner and goes to the LEAD, with the full roster
    // in the prompt (planner.ts:21–35).
    const first = mockRun.mock.calls[0]![0];

    expect(first.agentSlug).toBe(LEAD);

    for (const member of MEMBERS) {
      expect(first.message).toContain(member);
    }

    // Calls 2..6 are the task executions — one per planned task, each
    // dispatched to its owner (runtime.ts:62–96). Every member AND the
    // lead ran; nothing else did.
    const taskCalls = mockRun.mock.calls.slice(1).map(c => c[0].agentSlug);

    expect(taskCalls).toHaveLength(5);
    expect(new Set(taskCalls)).toEqual(new Set([LEAD, ...MEMBERS]));

    // Every task completed with its owner's output; the lead's synthesis
    // ran last (its dependsOn gate — runtime.ts:22–27 — held it until
    // all four member tasks completed).
    const tasks = run.plan!.tasks;

    expect(tasks.every(t => t.status === 'completed')).toBe(true);
    expect(tasks.at(-1)!.output).toBe('done: revenue-lead');
    expect(taskCalls.at(-1)).toBe(LEAD);
  });
});
