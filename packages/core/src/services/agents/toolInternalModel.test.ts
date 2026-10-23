import type { RawStreamEvent } from './traceEmitter';
import { tool } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ScriptedChatModel } from '@/libs/llm/scripted';
import { extractChunk, isToolInternalModelEvent } from './traceEmitter';

/**
 * A model a tool calls streams through the turn's event stream: LangChain
 * hands the turn's callbacks down to it. On 2026-10-23 the mail labeller that
 * `freshen_source` runs printed `{"state": "outbound_spam", …}` in a Founder
 * GTM answer. Captured from the real agent stack, so a framework change that
 * moves where these events land fails here.
 * @param graph
 * @param graph.streamEvents
 * @param line
 */
async function eventsOf(graph: { streamEvents: (input: never, config: never) => Promise<AsyncIterable<RawStreamEvent>> }, line: string): Promise<RawStreamEvent[]> {
  const out: RawStreamEvent[] = [];
  const stream = await graph.streamEvents({ messages: [{ role: 'user', content: line }] } as never, { version: 'v2' } as never);
  for await (const ev of stream) {
    out.push(ev);
  }
  return out;
}

function agentText(events: RawStreamEvent[]): string {
  return events
    .filter(ev => ev.event === 'on_chat_model_stream' && !isToolInternalModelEvent(ev))
    .map(ev => extractChunk(ev.data?.chunk).text)
    .join('');
}

describe('a model a tool calls never speaks for the agent', () => {
  it('drops the labeller inside a tool from the agent\'s words and keeps the agent\'s own', async () => {
    const lead = new ScriptedChatModel({ script: { turns: [{ match: 'how is my week', steps: [{ tool: 'freshen_source', args: {} }], reply: 'Three replies came in.' }], fallback: 'unscripted' } as never });
    const labeller = new ScriptedChatModel({ script: { turns: [{ match: 'label', steps: [], reply: '{"state":"outbound_spam","category":"other","ask":""}' }], fallback: 'unscripted' } as never });
    const freshen = tool(async () => {
      const labelled = await labeller.invoke([{ role: 'user', content: 'label this thread' }] as never);
      return `freshened: ${String(labelled.content).length} chars of labels`;
    }, { name: 'freshen_source', description: 'Freshen a source.', schema: z.object({}) });
    const graph = createDeepAgent({ model: lead as never, tools: [freshen], systemPrompt: 'Answer.', subagents: [] });

    const events = await eventsOf(graph as never, 'how is my week?');

    const inner = events.filter(ev => ev.event === 'on_chat_model_stream' && extractChunk(ev.data?.chunk).text.includes('outbound_spam'));

    expect(inner.length).toBeGreaterThan(0);
    expect(inner.every(isToolInternalModelEvent)).toBe(true);
    expect(agentText(events)).toBe('Three replies came in.');
  }, 30_000);

  it('keeps a teammate\'s words: a specialist inside task runs in its own model node', async () => {
    const model = new ScriptedChatModel({
      script: {
        turns: [
          { match: 'ask the researcher', steps: [{ tool: 'task', args: { subagent_type: 'researcher', description: 'find the renewal date' } }], reply: 'The researcher found it.' },
          { match: 'find the renewal date', steps: [], reply: 'Renewal is March 3.' },
        ],
        fallback: 'unscripted',
      },
    } as never);
    const graph = createDeepAgent({ model: model as never, tools: [], systemPrompt: 'Answer.', subagents: [{ name: 'researcher', description: 'Researches.', systemPrompt: 'Research.' }] });

    const events = await eventsOf(graph as never, 'ask the researcher');
    const specialist = events.filter(ev => ev.event === 'on_chat_model_stream' && extractChunk(ev.data?.chunk).text.includes('March 3'));

    expect(specialist.length).toBeGreaterThan(0);
    expect(specialist.some(isToolInternalModelEvent)).toBe(false);
  }, 30_000);
});
