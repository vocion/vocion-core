import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentTurnSignalSchema, conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { judgePrompt, judgeLiveTurns, parseVerdict, stratifiedSample } = await import('./judge');
const { runAgentEvalsNightly } = await import('@/services/jobs/agentEvalsNightly');

const VERDICT = '{"grounded": false, "argsCorrect": true, "unjustifiedRefusal": false, "completed": true, "note": "Says Negotiation; HubSpot says Proposal."}';

/**
 * One live turn: a conversation, the person's message, the assistant's row its trace wrote, and the turn's signal row.
 * @param agentSlug - The agent.
 * @param level - The level.
 * @param traceId - The trace.
 */
async function liveTurn(agentSlug: string, level: string, traceId: string) {
  const [conv] = await db.insert(conversationSchema).values({ orgId: 'org_a', agentSlug, title: 'Pipeline' }).returning({ id: conversationSchema.id });
  await db.insert(conversationMessageSchema).values({ conversationId: conv!.id, role: 'user', content: 'The Atlas pilot is in Negotiation, right?' });
  await db.insert(conversationMessageSchema).values({ conversationId: conv!.id, role: 'assistant', content: 'Yes, it is in Negotiation.', langfuseTraceId: traceId, runsJson: [{ type: 'tool', name: 'hubspot_list_deals', input: {}, output: '{"stage":"Proposal"}', state: 'done' }] });
  await db.insert(agentTurnSignalSchema).values({ orgId: 'org_a', agentSlug, level, traceId, conversationId: conv!.id });
}

describe('the live judge', () => {
  beforeEach(async () => {
    await db.delete(agentTurnSignalSchema);
  });

  it('reads a reply into a verdict, and refuses one that is not', () => {
    expect(parseVerdict(`Here you go: ${VERDICT}`)).toEqual({ grounded: false, argsCorrect: true, unjustifiedRefusal: false, completed: true, note: 'Says Negotiation; HubSpot says Proposal.' });
    expect(parseVerdict('{"grounded": "maybe"}')).toBeNull();
    expect(parseVerdict('no json')).toBeNull();
  });

  it('shows the judge the question, each call with its result, and the answer, clipped', () => {
    const prompt = judgePrompt({ question: 'Q', tools: [{ name: 'render_chart', input: { type: 'bar' }, output: 'x'.repeat(2000), failed: true }], answer: 'A' });

    expect(prompt).toContain('PERSON:\nQ');
    expect(prompt).toContain('1. render_chart (FAILED)');
    expect(prompt).toContain('…');
    expect(prompt.length).toBeLessThan(1200);
  });

  it('samples across agents and levels before taking a second turn from any', () => {
    const rows = [
      { id: 1, agentSlug: 'a', level: 'quick' },
      { id: 2, agentSlug: 'a', level: 'quick' },
      { id: 3, agentSlug: 'a', level: 'quick' },
      { id: 4, agentSlug: 'b', level: 'standard' },
      { id: 5, agentSlug: 'a', level: 'standard' },
    ];

    expect(stratifiedSample(rows, 3).map(r => r.id)).toEqual([1, 4, 5]);
    expect(stratifiedSample(rows, 10)).toHaveLength(5);
  });

  it('judges the sample, writes each verdict to its turn, and leaves judged turns alone the next night', async () => {
    await liveTurn('pipeline-analyst', 'quick', 'tr-1');
    await liveTurn('workspace-lead', 'standard', 'tr-2');
    const seen: string[] = [];
    const model = vi.fn(async (_system: string, user: string) => {
      seen.push(user);
      return { text: VERDICT };
    });

    const first = await runAgentEvalsNightly('org_a', { sample: 5 }, { model });

    expect(first).toMatchObject({ judged: 2, unreadable: 0, failed: 0 });
    expect(seen[0]).toContain('The Atlas pilot is in Negotiation, right?');
    expect(seen[0]).toContain('hubspot_list_deals');

    const rows = await db.select().from(agentTurnSignalSchema);

    expect(rows.map(r => r.judge?.grounded)).toEqual([false, false]);

    const second = await judgeLiveTurns('org_a', { sample: 5, since: new Date(Date.now() - 86_400_000), model });

    expect(second.judged).toBe(0);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it('counts a turn it cannot find or a reply it cannot read, and leaves it for another night', async () => {
    await db.insert(agentTurnSignalSchema).values({ orgId: 'org_a', agentSlug: 'x', level: 'quick', traceId: 'gone', conversationId: 999_999 });
    await liveTurn('pipeline-analyst', 'quick', 'tr-3');

    const out = await judgeLiveTurns('org_a', { sample: 5, since: new Date(Date.now() - 86_400_000), model: async () => ({ text: 'I think it was fine.' }) });

    expect(out).toEqual({ judged: 0, unreadable: 1, failed: 1 });
    expect((await db.select().from(agentTurnSignalSchema)).every(r => r.judge === null)).toBe(true);
  });

  it('caps the sample whatever the automation asks', async () => {
    await liveTurn('pipeline-analyst', 'quick', 'tr-4');
    const model = vi.fn(async () => ({ text: VERDICT }));

    expect((await runAgentEvalsNightly('org_a', { sample: 0 }, { model })).judged).toBe(0);
    expect((await runAgentEvalsNightly('org_a', { sample: 'lots' }, { model })).judged).toBe(0);
    expect(model).not.toHaveBeenCalled();
  });
});
