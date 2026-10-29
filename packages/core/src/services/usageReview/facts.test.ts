/**
 * The facts are code's: turns, time, spend, the effort and model each turn
 * ran at, tool failures and re-asks are worked out here, never by a model.
 */
import type { ReviewMessage, ReviewModelCall, ReviewToolCall } from './facts';
import { describe, expect, it } from 'vitest';
import { describeFacts, detectReasks, effortSignals, frictionScore, structuralOutcome, structuralThemes, threadFacts, turnFacts } from './facts';

const T0 = Date.parse('2026-10-28T15:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000);

let nextId = 1;
function msg(role: 'user' | 'assistant', content: string, s: number, over: Partial<ReviewMessage> = {}): ReviewMessage {
  return { id: nextId++, role, content, createdAt: at(s), status: role === 'assistant' ? 'complete' : null, statusReason: null, microCents: role === 'assistant' ? 2_000_000 : null, feedbackRating: null, agentSlug: role === 'assistant' ? 'deal-desk' : null, ...over };
}

describe('re-asks, found in code', () => {
  it('counts a message that repeats an earlier one, naming both', () => {
    nextId = 1;
    const thread = [
      msg('user', 'Draft the renewal quote for Contoso Supply with the new pricing', 0),
      msg('assistant', 'Here is a summary of Contoso Supply.', 10),
      msg('user', 'Draft the renewal quote for Contoso Supply using the new pricing please', 30),
      msg('assistant', 'Quote drafted.', 50),
    ];
    const r = detectReasks(thread);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ messageId: 3, kind: 'repeat', repeats: 1 });
    expect(r[0]!.similarity).toBeGreaterThan(0.45);
  });

  it('counts the message after a failed turn and after a thumbs-down, with no words compared', () => {
    nextId = 1;
    const thread = [
      msg('user', 'a', 0),
      msg('assistant', '', 5, { status: 'failed' }),
      msg('user', 'b', 10),
      msg('assistant', 'meh', 15, { feedbackRating: 'down' }),
      msg('user', 'c', 20),
    ];

    expect(detectReasks(thread).map(r => [r.messageId, r.kind])).toEqual([[3, 'after_failure'], [5, 'after_thumbs_down']]);
  });

  it('does not count a new question as asking again', () => {
    nextId = 1;
    const thread = [msg('user', 'What did Kestrel Capital say on Tuesday\'s call?', 0), msg('assistant', 'They asked for the deck.', 5), msg('user', 'Send Bellwater Hall the event dates for March', 20)];

    expect(detectReasks(thread)).toEqual([]);
  });
});

describe('each turn\'s facts', () => {
  it('reads the effort level and model from the turn\'s own model calls, its time from the ledger, and the tool failures in its span', () => {
    nextId = 1;
    const u = msg('user', 'Find the Northwind contract', 0);
    const a = msg('assistant', 'Found it.', 0, { startedAt: at(1), finishedAt: at(31) });
    const calls: ReviewModelCall[] = [
      { messageId: a.id, model: 'claude-haiku-4-5-20251001', effortLevel: 'quick', createdAt: at(2) },
      { messageId: a.id, model: 'claude-haiku-4-5-20251001', effortLevel: 'quick', createdAt: at(20) },
    ];
    const tools: ReviewToolCall[] = [
      { tool: 'search_knowledge', failed: false, durationMs: 400, createdAt: at(5) },
      { tool: 'read_document', failed: true, durationMs: 100, createdAt: at(10) },
      { tool: 'later', failed: true, durationMs: 1, createdAt: at(400) },
    ];
    const [t] = turnFacts([u, a], calls, tools);

    expect(t).toMatchObject({ effort: 'quick', model: 'claude-haiku-4-5-20251001', thinking: 'off', seconds: 30, cents: 2, toolCalls: 2, toolFailures: ['read_document'], status: 'complete' });
  });
});

describe('effort fit, from the numbers', () => {
  it('flags a Quick turn the person had to ask again after, pointing to Standard', () => {
    nextId = 1;
    const thread = [
      msg('user', 'Compare the three Contoso Supply proposals and rank the risks', 0),
      msg('assistant', 'They look similar.', 5),
      msg('user', 'Compare the three Contoso Supply proposals and rank the risks in detail', 20),
    ];
    const calls: ReviewModelCall[] = [{ messageId: 2, model: 'claude-haiku-4-5-20251001', effortLevel: 'quick', createdAt: at(1) }];
    const turns = turnFacts(thread, calls, []);
    const reasks = detectReasks(thread);

    expect(effortSignals(turns, reasks, thread)).toEqual([{ messageId: 2, level: 'quick', signal: 'reasked_after_quick', suggests: 'standard' }]);
  });

  it('flags a turn that ran into its ceiling, and a light request run at Deep', () => {
    nextId = 1;
    const thread = [
      msg('user', 'x', 0),
      msg('assistant', 'y', 0, { startedAt: at(0), finishedAt: at(89) }),
      msg('user', 'z', 100),
      msg('assistant', 'w', 100, { startedAt: at(100), finishedAt: at(110) }),
    ];
    const calls: ReviewModelCall[] = [
      { messageId: 2, model: 'claude-sonnet-4-6', effortLevel: 'standard', createdAt: at(1) },
      { messageId: 4, model: 'claude-opus-5-5', effortLevel: 'deep', createdAt: at(101) },
    ];
    const turns = turnFacts(thread, calls, []);

    expect(effortSignals(turns, [], thread).map(s => [s.messageId, s.signal, s.suggests])).toEqual([[2, 'hit_ceiling', 'deep'], [4, 'deep_for_light_work', 'standard']]);
  });
});

describe('a thread\'s structure', () => {
  it('reads an outcome without content: failed last turn, thumbs, re-asks, or unclear', () => {
    nextId = 1;
    const failed = threadFacts({ messages: [msg('user', 'a', 0), msg('assistant', '', 5, { status: 'failed' })], calls: [], tools: [] });
    nextId = 1;
    const liked = threadFacts({ messages: [msg('user', 'a', 0), msg('assistant', 'b', 5, { feedbackRating: 'up' })], calls: [], tools: [] });
    nextId = 1;
    const quiet = threadFacts({ messages: [msg('user', 'a', 0), msg('assistant', 'b', 5)], calls: [], tools: [] });

    expect(structuralOutcome(failed)).toBe('not_reached');
    expect(structuralOutcome(liked)).toBe('reached');
    expect(structuralOutcome(quiet)).toBe('unclear');
    expect(structuralThemes(failed)).toEqual(['turn_failed']);
    expect(frictionScore(failed)).toBeGreaterThan(frictionScore(quiet));
  });

  it('describes the facts to the judge with every turn\'s effort, model, time and spend, and no person\'s words', () => {
    nextId = 1;
    const f = threadFacts({
      messages: [msg('user', 'the Northwind secret plan', 0), msg('assistant', 'the reply text', 0, { startedAt: at(0), finishedAt: at(12) })],
      calls: [{ messageId: 2, model: 'claude-sonnet-4-6', effortLevel: 'standard', createdAt: at(1) }],
      tools: [],
    });
    const text = describeFacts(f);

    expect(text).toContain('turn 2: standard · claude-sonnet-4-6 · thinking agent · 12s · $0.02');
    expect(text).not.toContain('Northwind');
    expect(text).not.toContain('reply text');
  });
});
