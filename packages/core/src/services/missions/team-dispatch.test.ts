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
 *
 * SLICE 2 (second describe): that resolution landed in
 * services/missions/roster.ts — a template mission owned by the
 * WORKSPACE LEAD (project.lead_agent_slug) resolves its members to the
 * team leads from the `team` table; lead-less teams ride the brief as
 * a "no lead yet" note (acceptance #5); every other lead keeps the
 * parentAgentSlug reverse-lookup this file's gate-B half proved.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, missionRunSchema, missionSchema, projectSchema, teamSchema, tenantAccountSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { startMission } = await import('@/services/MissionService');
const { leadlessTeamsNote, resolveMissionRoster } = await import('@/services/missions/roster');

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

describe('mission roster resolution from the team table (F1 slice 2)', () => {
  const ORG2 = 'proj_f1_slice2';
  const DIRECTOR = 'revenue-director';
  const TEAM_LEADS = ['revenue-lead', 'deal-desk-lead', 'marketing-lead'];

  /** One task per team lead + the director's synthesis. */
  const LEADS_PLAN_JSON = JSON.stringify({
    tasks: [
      { id: 't1', title: 'RevOps status', ownerAgentSlug: 'revenue-lead', type: 'analysis' },
      { id: 't2', title: 'Deal Desk status', ownerAgentSlug: 'deal-desk-lead', type: 'analysis' },
      { id: 't3', title: 'Marketing status', ownerAgentSlug: 'marketing-lead', type: 'analysis' },
      { id: 't4', title: 'Assemble the quarter summary', ownerAgentSlug: DIRECTOR, type: 'synthesis', dependsOn: ['t1', 't2', 't3'] },
    ],
  });

  beforeEach(async () => {
    mockRun.mockReset();
    await db.delete(missionRunSchema);
    await db.delete(missionSchema);
    await db.delete(teamSchema);
    await db.delete(agentSchema);
    await db.delete(projectSchema);
    await db.delete(tenantAccountSchema);

    await db.insert(tenantAccountSchema).values({ id: 'acct-f1', name: 'MetaCTO', slug: 'metacto' });
    // The workspace lead is project CONFIG (0044), not a special team.
    await db.insert(projectSchema).values({ id: ORG2, accountId: 'acct-f1', slug: 'revenue', name: 'Revenue', leadAgentSlug: DIRECTOR });
    await db.insert(teamSchema).values([
      { orgId: ORG2, slug: 'revenue-ops', name: 'RevOps', leadAgentSlug: 'revenue-lead' },
      { orgId: ORG2, slug: 'deal-desk', name: 'Deal Desk', leadAgentSlug: 'deal-desk-lead' },
      { orgId: ORG2, slug: 'marketing', name: 'Marketing', leadAgentSlug: 'marketing-lead' },
      // The acceptance-#5 case: a team the lead CANNOT consult.
      { orgId: ORG2, slug: 'founder-gtm', name: 'Founder GTM', leadAgentSlug: null },
      // The workspace lead leading a team of its own must not
      // self-assign as a mission member.
      { orgId: ORG2, slug: 'office', name: 'Office of the Director', leadAgentSlug: DIRECTOR },
    ]);
    await db.insert(missionSchema).values({
      orgId: ORG2,
      slug: 'quarter-check',
      name: 'Quarter check',
      goal: 'Know how the quarter is going, across every team.',
      agentSlug: DIRECTOR,
    });
  });

  it('resolves a workspace-lead mission to the team leads and briefs lead-less teams as "no lead yet"', async () => {
    mockRun.mockImplementation(async ({ agentSlug, message }) => ({
      response: message.includes('planning an open-ended mission')
        ? `\`\`\`json\n${LEADS_PLAN_JSON}\n\`\`\``
        : `done: ${agentSlug}`,
      traceId: `trace-${agentSlug}`,
      toolCalls: [],
    }) as Awaited<ReturnType<typeof runAgentDeep>>);

    const run = await startMission({
      orgId: ORG2,
      invokedBy: 'f1-slice-2',
      brief: 'How is the quarter tracking?',
      missionSlug: 'quarter-check',
    });

    // Members came from the team table (roster.ts), NOT parentAgentSlug:
    // one entry per led team, the director excluded from its own roster.
    expect(run.team).toEqual({ lead: DIRECTOR, members: TEAM_LEADS });
    expect(run.status).toBe('completed');

    // Acceptance #5: the lead-less team is IN the brief, by name — and
    // because runtime.ts taskMessage embeds the brief in every task, the
    // director's synthesis sees it too. Degrade per team, never omit.
    expect(run.brief).toContain('the Founder GTM team has no lead yet');

    // The planner call went to the director with the team-lead roster
    // (planner.ts:21–35) and the same "no lead yet" note.
    const first = mockRun.mock.calls[0]![0];

    expect(first.agentSlug).toBe(DIRECTOR);

    for (const lead of TEAM_LEADS) {
      expect(first.message).toContain(lead);
    }

    expect(first.message).toContain('Founder GTM team has no lead yet');

    // Dispatch fan-out unchanged from gate B: every team lead ran, the
    // director's synthesis ran last.
    const taskCalls = mockRun.mock.calls.slice(1).map(c => c[0].agentSlug);

    expect(new Set(taskCalls)).toEqual(new Set([DIRECTOR, ...TEAM_LEADS]));
    expect(taskCalls.at(-1)).toBe(DIRECTOR);
    expect(run.plan!.tasks.at(-1)!.output).toBe(`done: ${DIRECTOR}`);
  });

  it('keeps the parentAgentSlug reverse-lookup for a lead that is not the workspace lead', async () => {
    await db.insert(agentSchema).values([
      { orgId: ORG2, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'x' },
      { orgId: ORG2, slug: 'pipeline-analyst', name: 'Pipeline Analyst', systemPrompt: 'x', parentAgentSlug: 'revenue-lead' },
      { orgId: ORG2, slug: 'follow-up-coordinator', name: 'Follow-Up Coordinator', systemPrompt: 'x', parentAgentSlug: 'revenue-lead' },
    ]);

    const roster = await resolveMissionRoster(ORG2, 'revenue-lead');

    expect(roster.team).toEqual({ lead: 'revenue-lead', members: ['pipeline-analyst', 'follow-up-coordinator'] });
    expect(roster.leadlessTeams).toEqual([]);
  });

  it('falls back to the parent lookup for a workspace lead in a workspace with no team rows (acceptance #13)', async () => {
    await db.delete(teamSchema);
    await db.insert(agentSchema).values([
      { orgId: ORG2, slug: DIRECTOR, name: 'Revenue Director', systemPrompt: 'x' },
      { orgId: ORG2, slug: 'pipeline-analyst', name: 'Pipeline Analyst', systemPrompt: 'x', parentAgentSlug: DIRECTOR },
    ]);

    const roster = await resolveMissionRoster(ORG2, DIRECTOR);

    expect(roster.team).toEqual({ lead: DIRECTOR, members: ['pipeline-analyst'] });
    expect(roster.leadlessTeams).toEqual([]);
  });

  it('leadlessTeamsNote names every team plainly and is null when all teams have leads', () => {
    expect(leadlessTeamsNote([])).toBeNull();

    const note = leadlessTeamsNote(['Founder GTM', 'Deal Desk'])!;

    expect(note).toContain('the Founder GTM team has no lead yet');
    expect(note).toContain('the Deal Desk team has no lead yet');
    expect(note).toContain('never silently omit');
  });
});
