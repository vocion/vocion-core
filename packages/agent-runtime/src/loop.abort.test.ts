/**
 * A turn's abort signal reaches the model loop (#272).
 *
 * The server aborts a turn when its caller hangs up; that only stops model
 * calls if the signal is handed to the graph run.
 */
import type { AgentEvent, InvocationRequest } from './contract.js';
import { describe, expect, it, vi } from 'vitest';

const streamSignals: Array<AbortSignal | undefined> = [];

vi.mock('deepagents', () => ({
  StateBackend: class {},
  createDeepAgent: (config: { tools: Array<{ name: string }> }) => {
    // The tools array is built inside the loop's graph factory, and its
    // endpoint/claim are getters over async-local state. Reading them through
    // this captured reference from inside a turn is exactly what a real tool
    // executor does.
    const toolSpec = config as unknown as { tools: Array<{ name: string }> };
    void toolSpec;
    return {
      streamEvents: (_input: unknown, config: { signal?: AbortSignal }) => {
        streamSignals.push(config.signal);
        return Promise.resolve({
          messages: (async function* () {})(),
          subagents: (async function* () {})(),
          toolCalls: (async function* () {
            yield {
              name: 'search_knowledge',
              input: {},
              output: Promise.resolve('ok'),
            };
          })(),
        });
      },
    };
  },
  StoreBackend: class {},
  CompositeBackend: class {},
  filesValue: {},
}));

vi.mock('./model.js', () => ({
  buildChatModel: (options: { readAwsSession: () => InvocationRequest['aws'] }) => {
    void options;
    return Promise.resolve({});
  },
}));

vi.mock('./tools.js', () => ({
  buildTransportTools: (
    spec: InvocationRequest['tools'],
    emit: (event: AgentEvent) => void,
  ) => {
    // Keep the live getters and the live emit rather than snapshots: the point
    // of the test is that they resolve per invocation, not per graph build.
    // This emit is the one a real tool executor uses to re-emit side-channel
    // events, and it is the callback that used to be swapped in place.
    void spec;
    void emit;
    return [{ name: 'search_knowledge' }];
  },
}));

vi.mock('./memory.js', () => ({
  memoryEnabled: () => false,
  loadHistory: () => Promise.resolve(null),
  retrieveLongTerm: () => Promise.resolve([]),
  saveTurn: () => Promise.resolve(),
}));

vi.mock('./tracing.js', () => ({
  createRuntimeTrace: () => ({
    handler: {},
    traceId: 'trace-test',
    end: () => Promise.resolve(),
  }),
}));

const { runInvocation } = await import('./loop.js');

describe('a turn run with an abort signal', () => {
  it('hands the signal to the graph run, so aborting stops its model calls', async () => {
    const callerLeft = new AbortController();
    const request = {
      version: 1,
      agent: { slug: 'abort-probe', name: 'Abort Probe', systemPrompt: 'Be helpful.' },
      message: 'hello',
      sessionId: 'session-abort',
      tools: { endpoint: 'https://tools.example.com', catalog: [], claim: 'claim-abort' },
      trace: { orgId: 'org_abort', userId: 'user_abort' },
      aws: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret', sessionToken: 'token' },
    } as unknown as InvocationRequest;

    await runInvocation(request, (_event: AgentEvent) => {}, callerLeft.signal);

    expect(streamSignals.at(-1)).toBe(callerLeft.signal);
  });
});
