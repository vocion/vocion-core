/**
 * What the person asked for — work, an answer, or work held — read by a
 * model from their own words (2026-10-01, CHAT-423: three questions started a
 * build). The reference case replays CHAT-423's three messages with invented
 * names.
 */
import { describe, expect, it } from 'vitest';
import { readAsked } from './turnJudge';

const CHAT_423 = [
  'how does this work without me manually registering an app with the assistant vendor?',
  'how do we implement this so it\'s a globally available assistant plugin? and not require manual intervention for every Northwind user?',
  'i\'m also here, and don\'t understand how to manually add. your instructions. what do I need to do to manually build and test this?',
];

function modelSaying(args: Record<string, unknown>, seen: unknown[] = []) {
  return {
    bindTools: (tools: Array<{ name: string }>, opts: unknown) => {
      seen.push({ tools: tools.map(t => t.name), opts });
      return { invoke: async (messages: Array<{ content: string }>) => {
        seen.push(messages.map(m => m.content));
        return { tool_calls: [{ name: tools[0]!.name, args }] };
      } };
    },
  } as never;
}

describe('what the person asked for', () => {
  it('is the model\'s typed reading, with the report tool forced; null with no words or a failed read', async () => {
    const seen: unknown[] = [];

    expect(await readAsked({ orgId: 'org_asked', messages: [CHAT_423[0]!], filed: 'request FE-1: Explain the integration' }, modelSaying({ asked: 'answer', quote: CHAT_423[0] }, seen))).toEqual({ asked: 'answer', quote: CHAT_423[0] });
    expect(seen[0]).toEqual({ tools: ['report_asked'], opts: { tool_choice: 'report_asked' } });
    expect(String((seen[1] as string[])[1])).toContain('What the agent filed from it: request FE-1: Explain the integration');
    expect(await readAsked({ orgId: 'org_asked', messages: [] }, modelSaying({ asked: 'work', quote: null }))).toBeNull();
    expect(await readAsked({ orgId: 'org_asked', messages: ['x'] }, { bindTools: () => ({ invoke: async () => {
      throw new Error('rate limited');
    } }) } as never)).toBeNull();
  });
});

/**
 * Against the real classifier. Skipped unless a key is handed in as
 * `VOCION_ROUTER_LIVE_KEY`, so CI never calls a model.
 */
const LIVE_KEY = process.env.VOCION_ROUTER_LIVE_KEY;

describe.skipIf(!LIVE_KEY)('the reference case, live', () => {
  it('reads each of CHAT-423\'s three questions as asking for an answer, and a build or a hold as such', async () => {
    const { buildChatModel } = await import('@/libs/llm/langchain');
    process.env.ANTHROPIC_API_KEY = LIVE_KEY;
    const model = buildChatModel('classifier', { provider: 'anthropic', temperature: 0, streaming: false, maxTokens: 300 }) as never;
    const history: string[] = [];
    for (const q of CHAT_423) {
      history.unshift(q);

      expect((await readAsked({ orgId: 'org_asked_live', messages: history.slice(0, 2), filed: 'request: Explain the assistant integration' }, model))?.asked).toBe('answer');
    }

    expect((await readAsked({ orgId: 'org_asked_live', messages: ['Add a last-opened line to the room page.'] }, model))?.asked).toBe('work');
    expect((await readAsked({ orgId: 'org_asked_live', messages: ['Just file this, do not build it yet.'] }, model))?.asked).toBe('hold');
  });
});
