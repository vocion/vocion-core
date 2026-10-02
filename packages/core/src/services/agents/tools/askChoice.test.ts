import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { openStream } = await import('@/libs/streams/buffer');
const { readCard } = await import('@/libs/cards/card');
const { askChoiceTool } = await import('./askChoice');

let nextConversation = 1000;

/** A fresh conversation with its web-chat turn open. */
function turnConversation(): number {
  const conversationId = nextConversation++;
  openStream(`ask-conv-${conversationId}`, { orgId: 'org_ask', userId: 'u1' }, conversationId);
  return conversationId;
}

/**
 * A fresh ctx every call, the way the AgentCore tool endpoint builds one.
 * @param conversationId
 * @param emit
 * @param orgId
 */
function ctxFor(conversationId: number | undefined, emit: (event: unknown) => void, orgId = 'org_ask'): RuntimeContext {
  return { orgId, agentSlug: 'workspace-lead', conversationId, connectorSources: [], emit } as unknown as RuntimeContext;
}

/**
 * Open the web-chat turn a conversation's questions belong to.
 * @param conversationId
 * @param orgId
 */
function openTurn(conversationId: number, orgId = 'org_ask'): void {
  openStream(`ask-turn-${orgId}-${conversationId}-${Math.random()}`, { orgId, userId: 'u1' }, conversationId);
}

const THREE = [{ label: 'Ship faster' }, { label: 'Fewer bugs', description: 'Quality first' }, { label: 'Both' }];

describe('ask_choice', () => {
  it('lettered A, B, C with "Type your own answer" on', async () => {
    const conversationId = nextConversation++;
    openTurn(conversationId);
    const emit = vi.fn();
    const out = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'What matters most?', hint: 'Pick one', options: THREE }));

    const card = emit.mock.calls[0]![0].card;

    expect(card).toMatchObject({ kind: 'choice', title: 'What matters most?', body: 'Pick one', allowOther: true, state: 'proposed', actions: [], source: { agentSlug: 'workspace-lead', tool: 'ask_choice' } });
    expect(card.options.map((o: { id: string }) => o.id)).toEqual(['A', 'B', 'C']);
    expect(readCard(card).ok).toBe(true);
    expect(out).toMatch(/^Asked\. Stop here/);
  });

  it('refuses a second question in the same turn, even from a fresh ctx, and emits no second card', async () => {
    const conversationId = nextConversation++;
    openTurn(conversationId);
    const emit = vi.fn();
    await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'What matters most?', options: THREE });
    const out = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'And the team size?', options: THREE }));

    expect(out).toBe('You already asked "What matters most?" this turn. Stop and wait for the answer; ask the next question after it.');
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('allows the next question once the next turn has started', async () => {
    const conversationId = nextConversation++;
    const emit = vi.fn();
    openTurn(conversationId);
    await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'What matters most?', options: THREE });
    openTurn(conversationId);
    const out = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'And the team size?', options: THREE }));

    expect(out).toMatch(/^Asked\./);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('treats an entry older than 30 minutes as a new turn', async () => {
    const conversationId = nextConversation++;
    openTurn(conversationId);
    const emit = vi.fn();
    vi.useFakeTimers();
    try {
      await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'What matters most?', options: THREE });
      vi.setSystemTime(Date.now() + 31 * 60_000);
      const out = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'And the team size?', options: THREE }));

      expect(out).toMatch(/^Asked\./);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps conversations and workspaces apart', async () => {
    const conversationId = nextConversation++;
    openTurn(conversationId);
    const emit = vi.fn();
    await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'What matters most?', options: THREE });

    openTurn(conversationId + 5000);
    openTurn(conversationId, 'org_other');

    expect(String(await askChoiceTool(ctxFor(conversationId + 5000, emit)).invoke({ question: 'Other thread?', options: THREE }))).toMatch(/^Asked\./);
    expect(String(await askChoiceTool(ctxFor(conversationId, emit, 'org_other')).invoke({ question: 'Other workspace?', options: THREE }))).toMatch(/^Asked\./);
  });

  it('is for chat: no conversation, no card', async () => {
    const emit = vi.fn();
    const out = String(await askChoiceTool(ctxFor(undefined, emit)).invoke({ question: 'What matters most?', options: THREE }));

    expect(out).toMatch(/ask_choice is for chat/);
    expect(emit).not.toHaveBeenCalled();
  });

  it('refuses a bound action whose input fails its schema, naming the option and the field', async () => {
    const emit = vi.fn();
    const out = String(await askChoiceTool(ctxFor(turnConversation(), emit)).invoke({
      question: 'Describe it?',
      options: [{ label: 'Short', action: { actionId: 'workspace.describe', input: { description: 'short' } } }, { label: 'Other' }],
    }));

    expect(out).toMatch(/^Option A can't be offered: .*description/);
    expect(emit).not.toHaveBeenCalled();
  });

  it('refuses a bound unknown action id, and does not spend the turn on it', async () => {
    const conversationId = nextConversation++;
    openTurn(conversationId);
    const emit = vi.fn();
    const out = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({
      question: 'Which?',
      options: [{ label: 'One' }, { label: 'Two', action: { actionId: 'no.such.action', input: {} } }],
    }));

    expect(out).toMatch(/^Option B can't be offered: .*no\.such\.action/);
    expect(emit).not.toHaveBeenCalled();

    const retry = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'Which?', options: THREE }));

    expect(retry).toMatch(/^Asked\./);
  });

  it('refuses a binding to an action that changes something outside Vocion, and does not spend the turn on it', async () => {
    const conversationId = nextConversation++;
    openTurn(conversationId);
    const emit = vi.fn();
    const out = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({
      question: 'Move it?',
      options: [{ label: 'Yes', action: { actionId: 'tracker.comment', input: {} } }, { label: 'No' }],
    }));

    expect(out).toBe('Option A can\'t be offered: tracker.comment changes something outside Vocion, so it can\'t ride on an option. Leave the option unbound and propose the change after the answer, so the person approves exactly what it does.');
    expect(emit).not.toHaveBeenCalled();

    const retry = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'Move it?', options: THREE }));

    expect(retry).toMatch(/^Asked\./);
  });

  it('puts a valid bound action on the emitted option', async () => {
    const emit = vi.fn();
    const action = { actionId: 'workspace.describe', input: { description: 'Northwind portal rebuild for the support team.' } };
    const out = String(await askChoiceTool(ctxFor(turnConversation(), emit)).invoke({ question: 'Describe it?', options: [{ label: 'Use this', action }, { label: 'Something else' }] }));

    expect(out).toMatch(/^Asked\./);

    const card = emit.mock.calls[0]![0].card;

    expect(card.options[0].actions).toEqual([action]);
    expect(card.options[1].actions).toBeUndefined();
    expect(readCard(card).ok).toBe(true);
  });

  it('runs a bound action precheck now, so a refusal reaches the agent', async () => {
    const emit = vi.fn();
    const out = String(await askChoiceTool(ctxFor(turnConversation(), emit)).invoke({
      question: 'Connect?',
      options: [{ label: 'GitHub', action: { actionId: 'source.connect', input: { connector: 'ghosthub', config: {} } } }, { label: 'Skip' }],
    }));

    expect(out).toMatch(/^Option A can't be offered: /);
    expect(emit).not.toHaveBeenCalled();
  });

  it('two calls running side by side in one turn make one card and one refusal', async () => {
    const conversationId = turnConversation();
    const emit = vi.fn();
    const outs = (await Promise.all([
      askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'First?', options: THREE }),
      askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'Second?', options: THREE }),
    ])).map(String);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(outs.filter(o => o.startsWith('Asked.'))).toHaveLength(1);
    expect(outs.filter(o => o.startsWith('You already asked'))).toHaveLength(1);
  });

  it('after a refused bad binding, a corrected question in the same turn goes through', async () => {
    const conversationId = turnConversation();
    const emit = vi.fn();
    const bad = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({
      question: 'Describe it?',
      options: [{ label: 'Short', action: { actionId: 'workspace.describe', input: { description: 'short' } } }, { label: 'Other' }],
    }));
    const fixed = String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'Describe it?', options: THREE }));

    expect(bad).toMatch(/^Option A can't be offered/);
    expect(fixed).toMatch(/^Asked\./);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('outside the web chat (a conversation with no open turn) it refuses every time, never as "already asked"', async () => {
    const emit = vi.fn();
    const conversationId = nextConversation++;
    const sentence = 'ask_choice works only in the web chat. Ask your question in a plain sentence here.';

    expect(String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'What matters most?', options: THREE }))).toBe(sentence);
    expect(String(await askChoiceTool(ctxFor(conversationId, emit)).invoke({ question: 'And the team size?', options: THREE }))).toBe(sentence);
    expect(emit).not.toHaveBeenCalled();
  });
});
