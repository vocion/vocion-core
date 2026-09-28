/**
 * A tool call written as text is still the call (conversation 355,
 * 2026-09-28). BLOCKS is the product manager's reply, verbatim, from its first
 * `<recommend_action>` to the end of its second: it reached the transcript as
 * raw JSON.
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentEvent, RuntimeContext } from './types';
import { describe, expect, it, vi } from 'vitest';
import { AnswerStreamer } from './answerStream';
import { extractTextCalls, parseTextCall, runTextCalls } from './textToolCalls';

vi.mock('@/services/objects/recordHref', () => ({
  recordHref: async (_org: string, ref: { objectType: string; id: number }) => `/w/squatch-factory/dashboard/p/${ref.objectType === 'request' ? 'feature' : 'objects'}/${ref.id}`,
}));

const { recommendActionTool } = await import('./tools/recommendAction');

const BLOCKS = '<recommend_action>\n{"action_id":"objects.update_meta","action_input":{"objectType":"request","id":124,"set":{"outcome":"Notify people of events by email, and show the same notifications in-app, without any push channel.","mainRisk":"In-app notifications land in core, so a mistake in the read model affects every product on the platform, not just this one."},"reason":"Chris removed push from scope on 2026-09-28: email notifications only, with in-app notifications split out to core."},"label":"Write the narrowed scope onto 124","confidence":0.55,"rationale":"Records the scope decision on the record itself so the contract a person approves matches what was actually decided.","suggested_decision":"approve","suggested_decision_reason":"Chris stated the scope change directly; the only doubt is whether 124 is a request record."}\n</recommend_action>\n\n<recommend_action>\n{"action_id":"objects.propose_candidate","action_input":{"objectType":"request","title":"Add in-app notifications to core","fields":{"product":"vocion","kind":"gap","surface":"ui","sizeClass":"minor","why":["platform_leverage","user_request"],"whyNote":"Split out of 124 by Chris on 2026-09-28 when push was cut; belongs in core so every product on the platform reads the same notification inbox rather than rebuilding it."},"dedupOn":["title","product"],"summary":"In-app notification list with read/unread, written by the same events that trigger the email send. No push, no digests, no preferences UI.","extractionNotes":"Scope carved out of [feature 124](/w/squatch-factory/dashboard/p/feature/124) in chat; needs its own acceptance criteria and a decision on where in core the read model lives."},"label":"File in-app notifications as its own request in core","confidence":0.7,"rationale":"Splitting it out of 124 without a record is how scope gets lost — this keeps the work visible with the reason it was separated.","suggested_decision":"approve","suggested_decision_reason":"Chris named it as separate work belonging in core."}\n</recommend_action>';
const BEFORE = 'What the remaining scope should commit to, so the contract is checkable:\n- No device tokens anywhere in the diff.\n\n';
const AFTER = '\n\nWant me to have the designer sketch the in-app inbox surface?';
const REPLY = `${BEFORE}${BLOCKS}${AFTER}`;

function ctxWithSink(sink: AgentEvent[]): RuntimeContext {
  return {
    orgId: 'org_text_calls',
    userId: 'user-1',
    agentSlug: 'product-manager',
    connectorSources: [],
    objectTypeSlugs: ['request'],
    searchConfig: {},
    harnessConfig: {},
    emit: (event: AgentEvent) => {
      sink.push(event);
    },
    citationSeq: { current: 0 },
  } as unknown as RuntimeContext;
}

/**
 * Stream a reply in small chunks, as a model does.
 * @param text - The reply.
 * @param size - Chunk size.
 */
function stream(text: string, size: number) {
  const s = new AnswerStreamer();
  let answer = '';
  const calls: Array<{ tag: string; body: string }> = [];
  for (let i = 0; i < text.length; i += size) {
    const r = s.push(text.slice(i, i + size));
    answer += r.answer;
    calls.push(...r.calls);
  }
  const t = s.flush();
  return { answer: answer + t.answer, calls: [...calls, ...t.calls] };
}

describe('the live stream never shows a call block', () => {
  it.each([1, 7, 64, 5000])('holds both blocks back whole, chunked by %i', (size) => {
    const out = stream(REPLY, size);

    expect(out.answer).not.toContain('recommend_action');
    expect(out.answer).not.toContain('action_id');
    expect(out.answer).toContain('No device tokens anywhere in the diff.');
    expect(out.answer).toContain('Want me to have the designer sketch');
    expect(out.calls.map(c => c.tag)).toEqual(['recommend_action', 'recommend_action']);
    expect(out.calls.every(c => parseTextCall(c as never).ok)).toBe(true);
  });

  it('a block the stream cut off is a call, not text', () => {
    const out = stream('Scope taken.\n\n<propose_action>\n{"action_id": "objects.update_meta", "action_in', 5);

    expect(out.answer).toBe('Scope taken.\n\n');
    expect(out.calls).toEqual([{ tag: 'propose_action', body: '\n{"action_id": "objects.update_meta", "action_in' }]);
  });

  it('still routes <scratch> to thinking', () => {
    const s = new AnswerStreamer();
    const r = s.push('<scratch>raw</scratch>Answer <recommend_action>{}</recommend_action> done');

    expect(r.thinking).toBe('raw');
    expect(r.answer + s.flush().answer).toBe('Answer  done');
  });
});

describe('the final answer loses the blocks and keeps the words', () => {
  it('extracts both, in order, and closes the hole', () => {
    const { text, calls } = extractTextCalls(REPLY);

    expect(calls).toHaveLength(2);
    expect(text).toBe(`${BEFORE.trim()}\n\n${AFTER.trim()}`);
    expect(parseTextCall(calls[0]!)).toMatchObject({ ok: true, label: 'Write the narrowed scope onto 124', args: { action_id: 'objects.update_meta', action_input: { objectType: 'request', id: 124 } } });
    expect(parseTextCall(calls[1]!)).toMatchObject({ ok: true, label: 'File in-app notifications as its own request in core', args: { action_id: 'objects.propose_candidate' } });
  });

  it('an answer with no block is returned as it was', () => {
    expect(extractTextCalls('Plain answer.\n\n\nWith gaps.')).toEqual({ text: 'Plain answer.\n\n\nWith gaps.', calls: [] });
  });
});

describe('each block runs as the real tool, so it renders as a card', () => {
  it('the exact blocks become two recommended_action cards through recommend_action', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as StructuredToolInterface;
    const { calls } = extractTextCalls(REPLY);
    const ran = await runTextCalls(calls, [tool]);

    expect(ran.notes).toEqual([]);
    expect(ran.outcomes.map(o => o.ok)).toEqual([true, true]);

    const cards = events.filter((e): e is Extract<AgentEvent, { type: 'recommended_action' }> => e.type === 'recommended_action').map(e => e.recommendation);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ actionId: 'objects.update_meta', label: 'Write the narrowed scope onto 124', input: { objectType: 'request', id: 124, set: { mainRisk: expect.stringContaining('In-app notifications land in core') } }, confidence: 0.55, href: '/w/squatch-factory/dashboard/p/feature/124', suggestedDecision: 'approve' });
    expect(cards[1]).toMatchObject({ actionId: 'objects.propose_candidate', label: 'File in-app notifications as its own request in core', input: { objectType: 'request', title: 'Add in-app notifications to core' } });
  });

  it('unparseable JSON is removed and becomes one "not a card" line', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as StructuredToolInterface;
    const { text, calls } = extractTextCalls('Done.\n\n<recommend_action>\n{"action_id": "objects.update_meta", "label": "Write the scope", "action_input": {\n</recommend_action>');
    const ran = await runTextCalls(calls, [tool]);

    expect(text).toBe('Done.');
    expect(events).toEqual([]);
    expect(ran.notes).toEqual(['- **Write the scope** — not a card: it was written as text and its JSON does not parse.']);
  });

  it('a block its tool refuses is a line, never a card that can only fail', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as StructuredToolInterface;
    const ran = await runTextCalls([{ tag: 'recommend_action', body: '{"action_id": "no.such.action", "action_input": {}, "label": "Do the thing"}' }], [tool]);

    expect(events).toEqual([]);
    expect(ran.outcomes[0]?.ok).toBe(false);
    expect(ran.notes[0]).toMatch(/^- \*\*Do the thing\*\* — not a card: No registered action "no\.such\.action"/);
  });

  it('a propose_action block runs propose_action; its refusal sentence is the line', async () => {
    const seen: unknown[] = [];
    const propose = {
      name: 'propose_action',
      invoke: async (args: unknown) => {
        seen.push(args);
        return 'Proposal refused: suggested_decision_reason is required.';
      },
    } as unknown as StructuredToolInterface;
    const ran = await runTextCalls([{ tag: 'propose_action', body: '```json\n{"action_id": "objects.update_meta", "action_input": {"objectType": "request", "id": 124, "set": {}}, "label": "Narrow 124"}\n```' }], [propose]);

    expect(seen).toEqual([{ action_id: 'objects.update_meta', action_input: { objectType: 'request', id: 124, set: {} }, label: 'Narrow 124' }]);
    expect(ran.notes).toEqual(['- **Narrow 124** — not a card: suggested_decision_reason is required.']);
  });
});
