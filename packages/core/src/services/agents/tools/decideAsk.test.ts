import { beforeEach, describe, expect, it, vi } from 'vitest';

class AskError extends Error {}
const OPEN = { id: 221, orgId: 'org', status: 'open', title: 'Stopped: Document detail page is not scoped to the selected org', options: [{ id: 'approve', label: 'Build again' }, { id: 'reject', label: 'Leave it stopped' }], decision: null };
const getAsk = vi.fn(async () => OPEN as never);
const decideAsk = vi.fn(async (o: { id: number; decision: string }) => ({ ...OPEN, status: 'approved', decision: o.decision, decisionNote: null }));
vi.mock('@/services/AskService', () => ({ AskError, decideAsk, getAsk }));
// No database in this test: the gate reads `ctx.turnMessage`.
vi.mock('@/libs/DB', () => ({ db: { select: () => {
  throw new Error('no database in this test');
} } }));

const { decideAskTool } = await import('./decideAsk');

// Whether the person said to answer the ask this way is a model's reading of
// their words (`turnJudge.saidToDecide`); here, the messages it reads as consent.
const CONSENTING = new Set(['approve, fix and run', 'leave it stopped for now', 'approve']);
vi.mock('../turnJudge', () => ({
  saidToDecide: vi.fn(async ({ messages }: { messages: string[] }) => ({ said: CONSENTING.has(messages[0] ?? ''), quote: null })),
}));

const said = (turnMessage: string) => ({ orgId: 'org', userId: 'usr-1', conversationId: 378, connectorSources: [], turnMessage }) as never;

describe('decide_ask — the person answers an ask by saying so', () => {
  beforeEach(() => {
    getAsk.mockClear();
    decideAsk.mockClear();
  });

  it('answers the Stopped ask as the person when their message says approve (conversation 378)', async () => {
    const out = await decideAskTool(said('approve, fix and run')).invoke({ id: 221, decision: 'approve', note: 'approve, fix and run' });

    expect(out).toMatch(/^Decided ask #221/);
    expect(decideAsk).toHaveBeenCalledWith({ orgId: 'org', id: 221, decision: 'approve', note: 'approve, fix and run', decidedBy: 'usr-1' });
  });

  it('an option is answered by its label', async () => {
    await decideAskTool(said('leave it stopped for now')).invoke({ id: 221, decision: 'reject' });

    expect(decideAsk).toHaveBeenCalledWith(expect.objectContaining({ decision: 'reject' }));
  });

  it('refuses an answer the person did not give, and never decides it', async () => {
    expect(await decideAskTool(said('why did it stop?')).invoke({ id: 221, decision: 'approve' })).toMatch(/^Refused: the person has not said/);
    expect(await decideAskTool(said('don\'t approve it')).invoke({ id: 221, decision: 'approve' })).toMatch(/^Refused/);
    expect(decideAsk).not.toHaveBeenCalled();
  });

  it('an ask already decided is left as it is', async () => {
    getAsk.mockResolvedValueOnce({ ...OPEN, status: 'approved', decision: 'approve' } as never);

    expect(await decideAskTool(said('approve')).invoke({ id: 221, decision: 'approve' })).toContain('already decided');
    expect(decideAsk).not.toHaveBeenCalled();
  });

  it('refuses on an agent\'s own schedule — only a person answers', async () => {
    const mission = { orgId: 'org', userId: 'usr-1', missionRunId: 3, connectorSources: [], turnMessage: 'approve' } as never;

    expect(await decideAskTool(mission).invoke({ id: 221, decision: 'approve' })).toMatch(/^Refused: only a person/);
    expect(decideAsk).not.toHaveBeenCalled();
  });
});
