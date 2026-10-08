/**
 * A TEAM THREAD THROUGH REAL deepagents LOOPS.
 *
 * Every turn here is a real `createDeepAgent` graph — the loop, its
 * middleware, its message handling — with only the model written down. Each
 * agent's model keeps what it was shown, so what is asserted is what each
 * specialist actually read: two specialists' posts are visible to each other,
 * and the round cap ends the thread with the lead's outcome. Nobody marks
 * complete and the lead never settles, so the cap is the only rule that can.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { ThreadTurn } from './TeamThreadService';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { createDeepAgent } from 'deepagents';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, missionRunSchema, teamSchema } = await import('@/models/Schema');
const { openTeamThread, runTeamThread } = await import('./TeamThreadService');

const ORG = 'proj_thread_harness';

/** A model that answers each call with the next line of its script and keeps every prompt it was given. */
class ScriptedModel extends BaseChatModel {
  seen: string[] = [];
  constructor(private readonly script: string[]) {
    super({});
  }

  _llmType(): string {
    return 'scripted';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    // What the person-side of the turn said: the thread's message to this agent.
    const asked = messages.filter(m => m.getType() === 'human').map(m => String(m.content)).join('\n');
    this.seen.push(asked);
    const reply = this.script[Math.min(this.seen.length - 1, this.script.length - 1)]!;
    return { generations: [{ text: reply, message: new AIMessage({ content: reply }) }] };
  }
}

/**
 * Each agent's turn, run through its own real graph.
 * @param models - Agent slug → its model.
 */
function realLoops(models: Record<string, ScriptedModel>): ThreadTurn {
  return async ({ agentSlug, message }) => {
    const graph = createDeepAgent({ model: models[agentSlug]!, systemPrompt: `You are ${agentSlug}.` });
    const out = await graph.invoke({ messages: [{ role: 'user', content: message }] } as never) as { messages: BaseMessage[] };
    const last = out.messages.at(-1);
    return { response: typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content) };
  };
}

const never = { readMember: async () => ({ complete: false }), readLead: async () => ({ settled: false }) };

beforeEach(async () => {
  await db.delete(missionRunSchema).where(eq(missionRunSchema.orgId, ORG));
  await db.delete(teamSchema).where(eq(teamSchema.orgId, ORG));
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.insert(teamSchema).values({ orgId: ORG, slug: 'revenue-ops', name: 'Revenue Ops', leadAgentSlug: 'revenue-lead' });
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'Lead.', teamSlug: 'revenue-ops' },
    { orgId: ORG, slug: 'pipeline-analyst', name: 'Pipeline Analyst', systemPrompt: 'Analyse.', teamSlug: 'revenue-ops' },
    { orgId: ORG, slug: 'follow-up-coordinator', name: 'Follow-Up Coordinator', systemPrompt: 'Follow up.', teamSlug: 'revenue-ops' },
  ] as never);
});

describe('a team thread, each turn a real deepagents loop', () => {
  it('shows each specialist the other\'s posts, and ends at the round cap with the lead\'s outcome', async () => {
    const analyst = new ScriptedModel([
      'ANALYST-1: Northwind has sat at Negotiation for 19 days against a median of 9.',
      'ANALYST-2: Agreed with the coordinator — re-run with a reply this week, the odds go to 74%.',
    ]);
    const coordinator = new ScriptedModel([
      'COORDINATOR-1: Those 19 days are our unanswered terms request from Oct 2.',
      'COORDINATOR-2: The analyst\'s 74% holds only if the account owner replies by Thursday.',
    ]);
    const lead = new ScriptedModel([
      'LEAD-REVIEW-1: Analyst, re-run the odds assuming a reply this week; coordinator, who sends it?',
      'LEAD-OUTCOME: It lands this quarter if the terms reply goes out by Thursday; the account owner sends it.',
    ]);
    const { runId } = await openTeamThread({ orgId: ORG, lead: 'revenue-lead', question: 'Will the Northwind renewal land this quarter?', openedBy: 'agent:revenue-lead', maxRounds: 2 });

    const result = await runTeamThread(ORG, runId, { runTurn: realLoops({ 'revenue-lead': lead, 'pipeline-analyst': analyst, 'follow-up-coordinator': coordinator }), ...never });

    // The cap, and only the cap, ended it — and the lead wrote the outcome.
    expect(result).toMatchObject({ status: 'completed', settledBy: 'round_cap', rounds: 2 });
    expect(result.outcome).toBe('LEAD-OUTCOME: It lands this quarter if the terms reply goes out by Thursday; the account owner sends it.');

    // Round two: each specialist read the other's round-one post, and the lead's steer.
    expect(analyst.seen).toHaveLength(2);
    expect(coordinator.seen).toHaveLength(2);
    expect(analyst.seen[1]).toContain('COORDINATOR-1: Those 19 days are our unanswered terms request from Oct 2.');
    expect(coordinator.seen[1]).toContain('ANALYST-1: Northwind has sat at Negotiation for 19 days against a median of 9.');
    expect(analyst.seen[1]).toContain('LEAD-REVIEW-1');
    // Round one was parallel: neither had seen the other yet.
    expect(analyst.seen[0]).not.toContain('COORDINATOR-1');
    expect(coordinator.seen[0]).not.toContain('ANALYST-1');

    // The lead reviewed once (between the rounds), then wrote the outcome over the whole thread.
    expect(lead.seen).toHaveLength(2);
    expect(lead.seen[1]).toContain('It reached its round cap: 2 of 2 rounds.');

    for (const post of ['ANALYST-1', 'ANALYST-2', 'COORDINATOR-1', 'COORDINATOR-2']) {
      expect(lead.seen[1]).toContain(post);
    }

    // One run holds all of it, step by step.
    const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, runId));

    expect(row!.plan!.tasks.map(t => [t.id, t.status])).toEqual([
      ['r1:pipeline-analyst', 'completed'],
      ['r1:follow-up-coordinator', 'completed'],
      ['r1:review', 'completed'],
      ['r2:pipeline-analyst', 'completed'],
      ['r2:follow-up-coordinator', 'completed'],
      ['outcome', 'completed'],
    ]);
    expect(row!.thread).toMatchObject({ settledBy: 'round_cap', round: 2, outcome: result.outcome });
  });

  it('in sequential order, the second specialist reads the first one\'s post in the same round', async () => {
    const analyst = new ScriptedModel(['ANALYST-1: 19 days at Negotiation.']);
    const coordinator = new ScriptedModel(['COORDINATOR-1: Because of our terms request.']);
    const lead = new ScriptedModel(['LEAD-OUTCOME: Answer the terms request.']);
    const { runId } = await openTeamThread({ orgId: ORG, lead: 'revenue-lead', question: 'Why is Northwind stalled?', openedBy: 'agent:revenue-lead', maxRounds: 1, turnOrder: 'sequential' });

    const result = await runTeamThread(ORG, runId, { runTurn: realLoops({ 'revenue-lead': lead, 'pipeline-analyst': analyst, 'follow-up-coordinator': coordinator }), ...never });

    expect(result.settledBy).toBe('round_cap');
    expect(coordinator.seen[0]).toContain('ANALYST-1: 19 days at Negotiation.');
    expect(lead.seen[0]).toContain('COORDINATOR-1: Because of our terms request.');
  });
});
