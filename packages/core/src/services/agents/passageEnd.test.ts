import type { RawStreamEvent } from './traceEmitter';
import { tool } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ScriptedChatModel } from '@/libs/llm/scripted';
import { endedOnToolCall } from './passage';
import { extractChunk } from './traceEmitter';

/**
 * Where a passage ends, and what it ends on, read off the real agent stack:
 * the message that says "Let me check the tracker" and then calls a tool is
 * narration, the one that ends without a tool is the answer (Chris,
 * 2026-10-23: "chain of thought thinking should be visually scoped to the
 * thinking line, not look like streaming text"). `AgentService` sends this as
 * `passage_end` at each lead message's `on_chat_model_end`.
 */
describe('endedOnToolCall — what a finished model message ended on', () => {
  it('a message that said a line and called a tool ended on work; the last one ended on the answer', async () => {
    const lead = new ScriptedChatModel({ script: { turns: [{ match: 'what do i owe', steps: [{ tool: 'lookup_objects', args: {}, say: 'Let me check the tracker.' }], reply: 'You owe Dana the revised scope.' }], fallback: 'unscripted' } as never });
    const lookup = tool(async () => 'FU-7: revised scope, due Friday', { name: 'lookup_objects', description: 'Read tracker rows.', schema: z.object({}) });
    const graph = createDeepAgent({ model: lead as never, tools: [lookup], systemPrompt: 'Answer.', subagents: [] });

    const events: RawStreamEvent[] = [];
    const stream = await (graph as unknown as { streamEvents: (i: never, c: never) => Promise<AsyncIterable<RawStreamEvent>> }).streamEvents({ messages: [{ role: 'user', content: 'what do I owe?' }] } as never, { version: 'v2' } as never);
    for await (const ev of stream) {
      events.push(ev);
    }

    // Each lead message: the words it streamed, and what it ended on.
    const byRun = new Map<string, string>();
    for (const ev of events) {
      if (ev.event === 'on_chat_model_stream') {
        const id = (ev as { run_id?: string }).run_id ?? '';
        byRun.set(id, (byRun.get(id) ?? '') + extractChunk(ev.data?.chunk).text);
      }
    }
    const ends = events.filter(ev => ev.event === 'on_chat_model_end').map(ev => ({ text: byRun.get((ev as { run_id?: string }).run_id ?? '') ?? '', work: endedOnToolCall(ev.data?.output) }));

    expect(ends).toEqual([
      { text: 'Let me check the tracker.', work: true },
      { text: 'You owe Dana the revised scope.', work: false },
    ]);
  }, 30_000);

  it('reads tool calls in any shape a provider hands back', () => {
    expect(endedOnToolCall({ tool_calls: [{ name: 'x' }] })).toBe(true);
    expect(endedOnToolCall({ tool_call_chunks: [{ name: 'x' }] })).toBe(true);
    expect(endedOnToolCall({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'x' }] })).toBe(true);
    expect(endedOnToolCall({ content: 'All done.', tool_calls: [] })).toBe(false);
    expect(endedOnToolCall(undefined)).toBe(false);
  });
});
