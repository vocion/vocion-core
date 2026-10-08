/**
 * TEAM THREADS, THE LOOP: who is in one, every settle rule, the caps, the cost
 * recorded once on the one run, and the tenant line. The DB is the PGlite test
 * mock; each turn and each read is a function handed in, so what is asserted
 * is the loop's own behaviour. The same loop through a real deepagents graph
 * is `TeamThreadService.harness.test.ts`; on the container,
 * `TeamThreadService.runtime.test.ts`.
 */
import type { ThreadDeps, ThreadTurn } from './TeamThreadService';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, missionRunSchema, projectSchema, teamSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { noteRunCost, withRunCost } = await import('@/services/budget/runCost');
const { getTeamThread, openTeamThread, resolveThreadTeam, runTeamThread, startTeamThread, TeamThreadError } = await import('./TeamThreadService');

const ORG = 'proj_northwind_revenue';
const OTHER = 'proj_kestrel_ops';
const LEAD = 'revenue-lead';
const ANALYST = 'pipeline-analyst';
const COORDINATOR = 'follow-up-coordinator';

async function seed(): Promise<void> {
  await db.delete(missionRunSchema);
  await db.delete(teamSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema).where(eq(userSchema.id, 'usr_owner'));
  await db.insert(userSchema).values({ id: 'usr_owner', email: 'owner@northwind.example', name: 'Morgan Hale' });
  await db.insert(tenantAccountSchema).values({ id: 'acct_threads', name: 'Northwind', slug: 'northwind' });
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct_threads', slug: 'revenue', name: 'Revenue', accountableUserId: 'usr_owner' },
    { id: OTHER, accountId: 'acct_threads', slug: 'ops', name: 'Ops' },
  ]);
  await db.insert(teamSchema).values([
    { orgId: ORG, slug: 'revenue-ops', name: 'Revenue Ops', leadAgentSlug: LEAD },
    // The same slugs in another workspace: never reachable from this one.
    { orgId: OTHER, slug: 'revenue-ops', name: 'Revenue Ops', leadAgentSlug: LEAD },
  ]);
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: LEAD, name: 'Revenue Lead', systemPrompt: 'Lead.', teamSlug: 'revenue-ops' },
    { orgId: ORG, slug: ANALYST, name: 'Pipeline Analyst', systemPrompt: 'Analyse.', teamSlug: 'revenue-ops' },
    { orgId: ORG, slug: COORDINATOR, name: 'Follow-Up Coordinator', systemPrompt: 'Follow up.', teamSlug: 'revenue-ops' },
    { orgId: ORG, slug: 'wiki-researcher', name: 'Wiki Researcher', systemPrompt: 'Research.' },
    { orgId: OTHER, slug: LEAD, name: 'Ops Lead', systemPrompt: 'Lead.', teamSlug: 'revenue-ops' },
    { orgId: OTHER, slug: 'kestrel-analyst', name: 'Kestrel Analyst', systemPrompt: 'Analyse.', teamSlug: 'revenue-ops' },
  ] as never);
}

beforeEach(seed);

type Call = Parameters<ThreadTurn>[0];

/**
 * A team that answers by script: each agent's posts in order, its last one repeated.
 * @param script - Agent slug → its replies.
 * @param costMicroCents - What each turn is charged, through the same call every model call makes.
 */
function team(script: Record<string, string[]>, costMicroCents = 0) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const runTurn: ThreadTurn = async (opts) => {
    calls.push(opts);
    const n = seen.get(opts.agentSlug) ?? 0;
    seen.set(opts.agentSlug, n + 1);
    if (costMicroCents > 0) {
      await noteRunCost(1_000, costMicroCents);
    }
    const replies = script[opts.agentSlug] ?? [`${opts.agentSlug} says nothing scripted`];
    return { response: replies[Math.min(n, replies.length - 1)]!, traceId: `trace-${opts.agentSlug}-${n}` };
  };
  return { calls, runTurn };
}

/**
 * Typed reads by script: which posts mark complete, which reviews settle.
 * @param complete - Post texts that mark their author complete.
 * @param settles - Review texts that settle the thread.
 */
function reads(complete: string[] = [], settles: string[] = []): Pick<ThreadDeps, 'readMember' | 'readLead'> {
  return {
    readMember: async ({ post }) => ({ complete: complete.includes(post) }),
    readLead: async ({ review }) => ({ settled: settles.includes(review) }),
  };
}

async function runRow(id: number) {
  const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, id));
  return row!;
}

describe('who a thread assigns', () => {
  it('the lead\'s own team, from the registry, with the accountable human the team inherits', async () => {
    const t = await resolveThreadTeam(ORG, LEAD);

    expect(t.members).toEqual([ANALYST, COORDINATOR]);
    expect(t.left).toEqual([]);
    expect(t.teamSlug).toBe('revenue-ops');
    expect(t.accountableUserId).toBe('usr_owner');
  });

  it('narrows to named members, and names the ones the lead cannot reach instead of dropping them', async () => {
    const t = await resolveThreadTeam(ORG, LEAD, [COORDINATOR, 'wiki-researcher', 'kestrel-analyst']);

    expect(t.members).toEqual([COORDINATOR]);
    expect(t.left).toEqual(['wiki-researcher', 'kestrel-analyst']);
  });

  it('refuses a lead with no one to ask, in words', async () => {
    await expect(resolveThreadTeam(ORG, 'wiki-researcher')).rejects.toThrow(/has no specialists to open a thread with/);
    await expect(resolveThreadTeam(ORG, 'no-such-agent')).rejects.toBeInstanceOf(TeamThreadError);
  });

  it('refuses an empty question', async () => {
    await expect(openTeamThread({ orgId: ORG, lead: LEAD, question: '   ', openedBy: 'agent:revenue-lead' })).rejects.toThrow('A thread needs a question.');
  });
});

describe('a thread runs to its settle rule and its outcome', () => {
  it('settles on the lead\'s word: its review is the outcome, and nothing runs after it', async () => {
    const { calls, runTurn } = team({
      [ANALYST]: ['Northwind has sat at Negotiation for 19 days.'],
      [COORDINATOR]: ['The 19 days are our unanswered terms request.'],
      [LEAD]: ['Settled: it lands if the terms go out by Thursday.'],
    });
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew this quarter?', openedBy: 'agent:revenue-lead', userId: 'usr_owner', allowedSourceSlugs: ['hubspot'] });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads([], ['Settled: it lands if the terms go out by Thursday.']) });

    expect(result).toMatchObject({ status: 'completed', settledBy: 'lead', outcome: 'Settled: it lands if the terms go out by Thursday.', rounds: 1 });
    // Two posts and one review: no extra outcome turn.
    expect(calls.map(c => c.agentSlug)).toEqual([ANALYST, COORDINATOR, LEAD]);
    // Every turn is on the thread's run, as the person who opened it, under their ACL.
    expect(calls.every(c => c.missionRunId === runId && c.userId === 'usr_owner' && c.allowedSourceSlugs?.[0] === 'hubspot')).toBe(true);

    const row = await runRow(runId);

    expect(row.status).toBe('completed');
    expect(row.team).toEqual({ lead: LEAD, members: [ANALYST, COORDINATOR] });
    expect(row.thread).toMatchObject({ settledBy: 'lead', round: 1, outcome: 'Settled: it lands if the terms go out by Thursday.', accountableUserId: 'usr_owner' });
    expect(row.plan!.tasks.map(t => [t.id, t.ownerAgentSlug, t.status])).toEqual([
      ['r1:pipeline-analyst', ANALYST, 'completed'],
      ['r1:follow-up-coordinator', COORDINATOR, 'completed'],
      ['outcome', LEAD, 'completed'],
    ]);
  });

  it('settles when every member marks complete, and the lead then writes the outcome', async () => {
    const { calls, runTurn } = team({
      [ANALYST]: ['Stage aging is the risk. Nothing more from me.'],
      [COORDINATOR]: ['Terms reply is the blocker. That is all I have.'],
      [LEAD]: ['Outcome: send the terms by Thursday.'],
    });
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead' });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads(['Stage aging is the risk. Nothing more from me.', 'Terms reply is the blocker. That is all I have.']) });

    expect(result).toMatchObject({ status: 'completed', settledBy: 'all_complete', outcome: 'Outcome: send the terms by Thursday.', rounds: 1 });
    // No review: the rule held before the lead was asked; then the outcome turn.
    expect(calls.map(c => c.agentSlug)).toEqual([ANALYST, COORDINATOR, LEAD]);
    expect(calls[2]!.message).toContain('Every assigned member marked their part complete after 1 of 3 rounds.');
    expect((await runRow(runId)).thread!.complete).toEqual([ANALYST, COORDINATOR]);
  });

  it('lets a member who marked complete sit out the rounds after', async () => {
    const { calls, runTurn } = team({
      [ANALYST]: ['Done from my side.', 'never asked'],
      [COORDINATOR]: ['Still checking the terms request.', 'Confirmed: the terms request is unanswered. Done.'],
      [LEAD]: ['Coordinator: confirm the terms request.', 'Outcome: answer the terms.'],
    });
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead' });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads(['Done from my side.', 'Confirmed: the terms request is unanswered. Done.']) });

    expect(result.settledBy).toBe('all_complete');
    expect(calls.map(c => c.agentSlug)).toEqual([ANALYST, COORDINATOR, LEAD, COORDINATOR, LEAD]);

    const tasks = (await runRow(runId)).plan!.tasks;

    expect(tasks.find(t => t.id === 'r1:pipeline-analyst')!.title).toBe('Round 1 — marked complete');
    expect(tasks.some(t => t.id === 'r2:pipeline-analyst')).toBe(false);
  });

  it('ends at the round cap, with one review between rounds and the outcome after the last', async () => {
    const { calls, runTurn } = team({ [ANALYST]: ['A'], [COORDINATOR]: ['B'], [LEAD]: ['Steer: keep going.', 'Outcome: no consensus.'] });
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', maxRounds: 2 });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(result).toMatchObject({ status: 'completed', settledBy: 'round_cap', rounds: 2, outcome: 'Outcome: no consensus.' });
    expect(calls.map(c => c.agentSlug)).toEqual([ANALYST, COORDINATOR, LEAD, ANALYST, COORDINATOR, LEAD]);
    expect(calls.at(-1)!.message).toContain('It reached its round cap: 2 of 2 rounds.');
    expect((await runRow(runId)).plan!.tasks.map(t => t.id)).toEqual(['r1:pipeline-analyst', 'r1:follow-up-coordinator', 'r1:review', 'r2:pipeline-analyst', 'r2:follow-up-coordinator', 'outcome']);
  });

  it('ends at the budget cap, and the lead still writes the outcome', async () => {
    // 60¢ a turn against a $1.00 cap: the first round's two posts spend $1.20.
    const { calls, runTurn } = team({ [ANALYST]: ['A'], [COORDINATOR]: ['B'], [LEAD]: ['Outcome: stopped at the cap.'] }, 60_000_000);
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', capCents: 100 });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(result).toMatchObject({ status: 'completed', settledBy: 'budget_cap', rounds: 1, outcome: 'Outcome: stopped at the cap.' });
    expect(calls.map(c => c.agentSlug)).toEqual([ANALYST, COORDINATOR, LEAD]);
    expect(calls.at(-1)!.message).toContain('It reached its budget cap of $1.00 after 1 of 3 rounds.');
  });

  it('stops a sequential round where the cap is reached, mid-round', async () => {
    const { calls, runTurn } = team({ [ANALYST]: ['A'], [COORDINATOR]: ['B'], [LEAD]: ['Outcome.'] }, 120_000_000);
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', capCents: 100, turnOrder: 'sequential' });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(result.settledBy).toBe('budget_cap');
    // The coordinator never posted: the analyst's turn alone spent the cap.
    expect(calls.map(c => c.agentSlug)).toEqual([ANALYST, LEAD]);
  });

  it('in sequential order, a member reads the post written before it in the same round', async () => {
    const { calls, runTurn } = team({ [ANALYST]: ['Stage aging: 19 days.'], [COORDINATOR]: ['B'], [LEAD]: ['Outcome.'] });
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', maxRounds: 1, turnOrder: 'sequential' });

    await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(calls[1]!.agentSlug).toBe(COORDINATOR);
    expect(calls[1]!.message).toContain('[Round 1 · Pipeline Analyst (pipeline-analyst)]\nStage aging: 19 days.');
  });

  it('in parallel order, members of one round read the thread as it stood when the round began', async () => {
    const { calls, runTurn } = team({ [ANALYST]: ['Stage aging: 19 days.'], [COORDINATOR]: ['B'], [LEAD]: ['Outcome.'] });
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', maxRounds: 1 });

    await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(calls[1]!.message).not.toContain('Stage aging: 19 days.');
    expect(calls[1]!.message).toContain('(No posts yet — you are first.)');
  });

  it('records a failed post as a failed step, and the thread goes on', async () => {
    const calls: Call[] = [];
    const runTurn: ThreadTurn = async (opts) => {
      calls.push(opts);
      if (opts.agentSlug === COORDINATOR) {
        throw new Error('Budget exceeded for follow-up-coordinator');
      }
      return { response: opts.agentSlug === LEAD ? 'Outcome: one view only.' : 'A' };
    };
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', maxRounds: 1 });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(result.status).toBe('completed');

    const failed = (await runRow(runId)).plan!.tasks.find(t => t.id === 'r1:follow-up-coordinator')!;

    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Budget exceeded for follow-up-coordinator');
    // The lead was told the post failed, and why.
    expect(calls.at(-1)!.message).toContain('(This post failed and was not written: Error: Budget exceeded for follow-up-coordinator)');
  });

  it('fails, saying why, when the outcome could not be written', async () => {
    const runTurn: ThreadTurn = async (opts) => {
      if (opts.agentSlug === LEAD) {
        throw new Error('model unavailable');
      }
      return { response: 'A' };
    };
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', maxRounds: 1 });

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/the lead's outcome could not be written: Error: model unavailable/);

    const row = await runRow(runId);

    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/could not be written/);
  });

  it('stops when a person cancels it, without spending on an outcome', async () => {
    let runId = 0;
    const calls: Call[] = [];
    const runTurn: ThreadTurn = async (opts) => {
      calls.push(opts);
      // The person cancels while round one is being written.
      await db.update(missionRunSchema).set({ status: 'cancelled' }).where(eq(missionRunSchema.id, runId));
      return { response: 'A' };
    };
    ({ runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead' }));

    const result = await runTeamThread(ORG, runId, { runTurn, ...reads() });

    expect(result).toMatchObject({ status: 'cancelled', settledBy: 'cancelled', outcome: null });
    expect(calls.map(c => c.agentSlug)).toEqual([ANALYST, COORDINATOR]);
    expect((await runRow(runId)).status).toBe('cancelled');
  });
});

describe('the thread\'s cost is recorded once, on its run', () => {
  it('counts every turn on the thread\'s run and nothing on the chat turn that opened it', async () => {
    const { runTurn } = team({ [ANALYST]: ['A'], [COORDINATOR]: ['B'], [LEAD]: ['Steer.', 'Outcome.'] }, 25_000_000);

    // The lead's chat turn is its own cost scope (`conversationId`); the
    // thread opened inside it is the innermost scope, so its spend is its own.
    const { chatSpent, result } = await withRunCost({ conversationId: 9001 }, async (chat) => {
      await noteRunCost(500, 7_000_000);
      const started = await startTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead', maxRounds: 2 }, { runTurn, ...reads() });
      const done = await started.done;
      return { chatSpent: chat.microCents, result: done };
    });

    // 2 rounds × 2 posts + 1 review + 1 outcome = 6 turns at 25¢.
    expect(result.microCents).toBe(150_000_000);
    expect(chatSpent).toBe(7_000_000);

    const row = await runRow(result.runId);

    expect(row.microCents).toBe(150_000_000);
    expect(row.tokens).toBe(6_000);

    const view = await getTeamThread(ORG, result.runId);

    expect(view!.spentCents).toBe(150);
  });
});

describe('the tenant line', () => {
  it('assigns only this workspace\'s agents, even where another workspace uses the same slugs', async () => {
    const theirs = await resolveThreadTeam(OTHER, LEAD);

    expect(theirs.members).toEqual(['kestrel-analyst']);
    await expect(resolveThreadTeam(OTHER, ANALYST)).rejects.toBeInstanceOf(TeamThreadError);
  });

  it('reads a thread only in its own workspace', async () => {
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead' });

    expect(await getTeamThread(ORG, runId)).toMatchObject({ runId, question: 'Will Northwind renew?', accountable: { name: 'Morgan Hale' } });
    expect(await getTeamThread(OTHER, runId)).toBeNull();
  });

  it('never runs or touches another workspace\'s thread', async () => {
    const { runId } = await openTeamThread({ orgId: ORG, lead: LEAD, question: 'Will Northwind renew?', openedBy: 'agent:revenue-lead' });
    const { calls, runTurn } = team({});

    const result = await runTeamThread(OTHER, runId, { runTurn, ...reads() });

    expect(result.status).toBe('failed');
    expect(calls).toEqual([]);

    const row = await runRow(runId);

    expect(row.status).toBe('running');
    expect(row.orgId).toBe(ORG);
  });
});
