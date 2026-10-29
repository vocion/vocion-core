import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentTurnSignalSchema } = await import('@/models/Schema');
const { listFlaggedTurns, loadAgentScoreboard, recordTurnSignals, sortScores } = await import('./signals');

const available = ['recommend_action', 'remember_preference'];
const turn = (over: Partial<Parameters<typeof recordTurnSignals>[0]>) => ({ orgId: 'org_a', agentSlug: 'pipeline-analyst', level: 'quick', toolLoading: 'history', answer: 'Done.', calls: [], available, ...over });

describe('live turn signals', () => {
  beforeEach(async () => {
    await db.delete(agentTurnSignalSchema);
  });

  it('keeps one row per turn with its counts and flags, and no text', async () => {
    const flags = await recordTurnSignals(turn({ answer: 'I don\'t have a tool to update HubSpot.', conversationId: 12, traceId: 'tr-1' }));

    expect(flags).toEqual(['refusedWithAction']);

    const [row] = await db.select().from(agentTurnSignalSchema);

    expect(row).toMatchObject({ orgId: 'org_a', agentSlug: 'pipeline-analyst', level: 'quick', toolLoading: 'history', flags: ['refusedWithAction'], conversationId: 12, traceId: 'tr-1', judge: null });
    expect(JSON.stringify(row)).not.toContain('HubSpot');
  });

  it('scores by agent and level over the window, worst agent first, and only this workspace', async () => {
    const fail = { tool: 'render_chart', error: true };
    await recordTurnSignals(turn({ calls: [fail, fail, fail] }));
    await recordTurnSignals(turn({ answer: 'Noted.' }));
    await recordTurnSignals(turn({ level: 'standard', toolLoading: 'core', calls: [{ tool: 'recommend_action', error: false }] }));
    await recordTurnSignals(turn({ agentSlug: 'workspace-lead', level: null }));
    await recordTurnSignals(turn({ orgId: 'org_b', answer: 'Noted.' }));
    await db.insert(agentTurnSignalSchema).values({ orgId: 'org_a', agentSlug: 'pipeline-analyst', level: 'quick', flags: ['claimedSave'], createdAt: new Date(Date.now() - 40 * 86_400_000) });

    const { scores } = await loadAgentScoreboard('org_a', { days: 30 });

    expect(scores.map(s => `${s.agentSlug}/${s.level}`)).toEqual(['pipeline-analyst/quick', 'pipeline-analyst/standard', 'workspace-lead/unknown']);
    expect(scores[0]).toMatchObject({ turns: 2, toolCalls: 3, toolErrors: 3, toolFailures: 1, claimedSave: 1, refusedWithAction: 0, flagged: 2, loading: ['history'] });
    expect(scores[1]).toMatchObject({ turns: 1, flagged: 0, loading: ['core'] });
  });

  it('counts the judge\'s verdicts where each applied, and lists a judged-wrong turn with the flagged ones', async () => {
    await db.insert(agentTurnSignalSchema).values([
      { orgId: 'org_a', agentSlug: 'revenue-lead', level: 'standard', judge: { grounded: false, argsCorrect: null, unjustifiedRefusal: false, completed: true } },
      { orgId: 'org_a', agentSlug: 'revenue-lead', level: 'standard', judge: { grounded: true, argsCorrect: true, unjustifiedRefusal: false, completed: true } },
      { orgId: 'org_a', agentSlug: 'revenue-lead', level: 'standard' },
    ]);

    const { scores } = await loadAgentScoreboard('org_a', { days: 1 });

    expect(scores[0]).toMatchObject({ turns: 3, judged: 2, grounded: { passed: 1, of: 2 }, argsCorrect: { passed: 1, of: 1 }, unjustifiedRefusals: 0, flagged: 0 });

    const listed = await listFlaggedTurns('org_a', { since: new Date(Date.now() - 86_400_000) });

    expect(listed.map(t => t.judge?.grounded)).toEqual([false]);
  });

  it('lists the flagged turns newest first, for one agent when asked', async () => {
    await recordTurnSignals(turn({ answer: 'Noted.' }));
    await recordTurnSignals(turn({ agentSlug: 'workspace-lead', answer: 'Noted.' }));
    await recordTurnSignals(turn({}));

    const since = new Date(Date.now() - 86_400_000);

    expect((await listFlaggedTurns('org_a', { since })).map(t => t.agentSlug)).toEqual(['workspace-lead', 'pipeline-analyst']);
    expect((await listFlaggedTurns('org_a', { since, agentSlug: 'pipeline-analyst' })).map(t => t.flags)).toEqual([['claimedSave']]);
  });

  it('orders levels by effort within an agent', () => {
    const s = (agentSlug: string, level: string, flagged = 0) => ({ agentSlug, level, flagged, turns: 1, toolCalls: 0, toolErrors: 0, searches: 0, toolFailures: 0, refusedWithAction: 0, claimedSave: 0, loading: [], lastAt: null, judged: 0, grounded: { passed: 0, of: 0 }, argsCorrect: { passed: 0, of: 0 }, unjustifiedRefusals: 0 });

    expect(sortScores([s('b', 'standard'), s('b', 'quick'), s('a', 'deep', 1)]).map(x => `${x.agentSlug}/${x.level}`)).toEqual(['a/deep', 'b/quick', 'b/standard']);
  });
});
