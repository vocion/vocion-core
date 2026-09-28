/**
 * A tool's result is not the answer.
 *
 * LangGraph's v3 `run.messages` streams the `tools` node's results as
 * messages beside the model's own. Read as answer text, every tool output
 * reached the person as a reply: the first production turns on the Metacto
 * runtime (2026-09-28) answered "Tool error: endpoint returned 401 — {…}The
 * lookup failed…", and a successful lookup would have streamed its JSON the
 * same way.
 */
import type { AgentEvent, InvocationRequest } from './contract.js';
import { describe, expect, it, vi } from 'vitest';

/**
 * One `run.messages` stream: its node and the text it streams.
 * @param node - The graph node that produced it.
 * @param text - What it says.
 */
function stream(node: string, text: string) {
  return {
    node,
    text: (async function* () {
      yield text;
    })(),
    reasoning: (async function* () {})(),
  };
}

vi.mock('deepagents', () => ({
  StateBackend: class {},
  createDeepAgent: () => ({
    streamEvents: () => Promise.resolve({
      messages: (async function* () {
        yield stream('model_request', 'Checking. ');
        yield stream('tools', '{"status":"shipped","internal_id":42}');
        yield stream('model_request', 'It shipped.');
      })(),
      subagents: (async function* () {})(),
      toolCalls: (async function* () {})(),
    }),
  }),
  StoreBackend: class {},
  CompositeBackend: class {},
  filesValue: {},
}));
vi.mock('./model.js', () => ({ resolvedModelId: () => 'test-model', buildChatModel: () => Promise.resolve({}) }));
vi.mock('./tools.js', () => ({ buildTransportTools: () => [] }));
vi.mock('./memory.js', () => ({
  memoryEnabled: () => false,
  loadHistory: () => Promise.resolve(null),
  retrieveLongTerm: () => Promise.resolve([]),
  saveTurn: () => Promise.resolve(),
}));
vi.mock('./tracing.js', () => ({ createRuntimeTrace: () => ({ handler: {}, traceId: 't', end: () => Promise.resolve() }) }));

const { isToolResultStream, runInvocation } = await import('./loop.js');

describe('the answer a turn streams', () => {
  it('is what the model said, without the tool results between', async () => {
    const events: AgentEvent[] = [];
    const request = {
      version: 1,
      agent: { slug: 'tool-results', name: 'Tool Results', systemPrompt: 'Be helpful.' },
      message: 'where is my order?',
      tools: { endpoint: 'https://tools.example.com', catalog: [], claim: 'claim' },
      trace: { orgId: 'org_tool_results', userId: 'user' },
    } as unknown as InvocationRequest;

    await runInvocation(request, event => events.push(event));

    const done = events.find(e => e.type === 'done') as Extract<AgentEvent, { type: 'done' }>;

    expect(done.response).toBe('Checking. It shipped.');

    const streamed = events.filter(e => e.type === 'response_delta').map(e => (e as { delta: string }).delta).join('');

    expect(streamed).not.toContain('internal_id');
  });

  it('tells a tool result stream from the model\'s', () => {
    expect(isToolResultStream({ node: 'tools' })).toBe(true);
    expect(isToolResultStream({ node: 'model_request' })).toBe(false);
    expect(isToolResultStream(null)).toBe(false);
  });
});
