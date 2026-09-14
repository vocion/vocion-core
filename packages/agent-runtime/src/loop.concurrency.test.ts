/**
 * Two callers, one cached graph, no crossover.
 *
 * The compiled graph is deliberately shared between requests with identical
 * definitions — two people in one org hit the same entry, which
 * `loop.cacheKey.test.ts` asserts on purpose. Everything caller-specific
 * therefore has to be read through async-local state rather than assigned onto
 * that shared entry, or the second request's assignment lands while the first
 * is still mid-turn.
 *
 * What that used to cost, concretely: one caller's streamed events delivered
 * through the other's callback, and one caller's tool calls sent out under the
 * other's signed claim — a different conversation and a different allowed
 * source scope. This test holds two invocations open at once and asserts each
 * one still sees its own.
 */

import type { AgentEvent, InvocationRequest } from './contract.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What one invocation observed from inside its own turn. */
type ObservedState = {
  toolEndpoint: string;
  toolClaim: string;
  awsSessionToken: string | undefined;
};

/** A promise plus the handles to settle it, for rendezvous between turns. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * The tool surface `createDeepAgent` was handed, and the credential reader
 * `buildChatModel` was handed — captured once, because both invocations share
 * one graph and therefore one set of these.
 */
let capturedToolSpec: { endpoint: string; claim: string } | undefined;
let capturedReadAwsSession: (() => InvocationRequest['aws']) | undefined;
let capturedToolEmit: ((event: AgentEvent) => void) | undefined;

/**
 * Set by each test: what a turn should do when it reaches its tool call. This
 * is the hook that lets a test observe async-local state from inside the run.
 */
let onToolCall: (() => Promise<string>) | undefined;

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
      streamEvents: () => Promise.resolve({
        messages: (async function* () {})(),
        subagents: (async function* () {})(),
        toolCalls: (async function* () {
          yield {
            name: 'search_knowledge',
            input: {},
            output: onToolCall ? onToolCall() : Promise.resolve('ok'),
          };
        })(),
      }),
    };
  },
}));

vi.mock('./model.js', () => ({
  buildChatModel: (options: { readAwsSession: () => InvocationRequest['aws'] }) => {
    capturedReadAwsSession = options.readAwsSession;
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
    capturedToolSpec = spec as unknown as { endpoint: string; claim: string };
    capturedToolEmit = emit;
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

function request(overrides: {
  claim: string;
  endpoint: string;
  awsSessionToken: string;
}): InvocationRequest {
  return {
    version: 1,
    agent: { slug: 'event-ingestion-lead', name: 'Event Ingestion Lead', systemPrompt: 'Be helpful.' },
    message: 'what came in today?',
    sessionId: `session-${overrides.claim}`,
    tools: { endpoint: overrides.endpoint, catalog: [], claim: overrides.claim },
    trace: { orgId: 'org_shared', userId: `user-${overrides.claim}` },
    aws: {
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: overrides.awsSessionToken,
    },
  } as unknown as InvocationRequest;
}

/** What the shared getters resolve to on the current async stack. */
function observeCurrentState(): ObservedState {
  return {
    toolEndpoint: capturedToolSpec!.endpoint,
    toolClaim: capturedToolSpec!.claim,
    awsSessionToken: (capturedReadAwsSession!() as { sessionToken?: string } | undefined)?.sessionToken,
  };
}

describe('runInvocation, two callers sharing one graph', () => {
  beforeEach(() => {
    // The captured getters are deliberately NOT reset. `graphCache` is
    // module-level and survives between tests, so every request here — same
    // org, same definition — hits the entry the first test built, and the
    // factories that hand over these references are never called again. That
    // reuse is the condition under test, not an accident of the fixture.
    onToolCall = undefined;
  });

  it('keeps each turn on its own claim, endpoint and AWS session while both are in flight', async () => {
    const bothStarted = deferred();
    const firstMayFinish = deferred();
    const observed: Record<string, ObservedState> = {};
    let startedCount = 0;

    onToolCall = async () => {
      // Both turns park here, so the second turn has definitely entered the
      // shared graph before the first one reads anything.
      startedCount += 1;
      const mine = observeCurrentState();
      if (startedCount === 2) {
        bothStarted.resolve();
      }
      await bothStarted.promise;
      // Read a second time, AFTER the other turn is known to be inside the
      // same graph. Under the old mutable refs this is where the values
      // flipped to the other caller's.
      const afterTheOtherStarted = observeCurrentState();
      observed[mine.toolClaim] = afterTheOtherStarted;
      firstMayFinish.resolve();
      return 'ok';
    };

    const first = runInvocation(
      request({ claim: 'claim-A', endpoint: 'https://a.example.com/tools', awsSessionToken: 'token-A' }),
      () => {},
    );
    const second = runInvocation(
      request({ claim: 'claim-B', endpoint: 'https://b.example.com/tools', awsSessionToken: 'token-B' }),
      () => {},
    );

    await Promise.all([first, second]);
    await firstMayFinish.promise;

    expect(observed['claim-A']).toEqual({
      toolEndpoint: 'https://a.example.com/tools',
      toolClaim: 'claim-A',
      awsSessionToken: 'token-A',
    });
    expect(observed['claim-B']).toEqual({
      toolEndpoint: 'https://b.example.com/tools',
      toolClaim: 'claim-B',
      awsSessionToken: 'token-B',
    });
  });

  it('delivers a tool side-channel event to the caller whose turn raised it', async () => {
    // The emit a tool closes over is the one that used to be reassigned on the
    // shared graph entry, so this is the path where one caller's documents
    // sidebar or hitl gate could arrive in another caller's stream.
    const firstEvents: AgentEvent[] = [];
    const secondEvents: AgentEvent[] = [];
    const bothStarted = deferred();
    let startedCount = 0;

    onToolCall = async () => {
      startedCount += 1;
      const claimAtEntry = capturedToolSpec!.claim;
      if (startedCount === 2) {
        bothStarted.resolve();
      }
      await bothStarted.promise;
      // Raise a side-channel event the way a real tool executor does, AFTER
      // the other turn is known to be inside the same graph.
      capturedToolEmit!({ type: 'thinking_delta', delta: claimAtEntry });
      return 'ok';
    };

    await Promise.all([
      runInvocation(
        request({ claim: 'claim-A', endpoint: 'https://a.example.com/tools', awsSessionToken: 'token-A' }),
        event => firstEvents.push(event),
      ),
      runInvocation(
        request({ claim: 'claim-B', endpoint: 'https://b.example.com/tools', awsSessionToken: 'token-B' }),
        event => secondEvents.push(event),
      ),
    ]);

    const deltasOf = (events: AgentEvent[]): string[] => events
      .filter((e): e is Extract<AgentEvent, { type: 'thinking_delta' }> => e.type === 'thinking_delta')
      .map(e => e.delta);

    // Each caller got exactly its own tool event, and none of the other's.
    expect(deltasOf(firstEvents)).toEqual(['claim-A']);
    expect(deltasOf(secondEvents)).toEqual(['claim-B']);
  });

  it('refuses to read invocation state outside a turn', async () => {
    // Build the graph by running one turn, so the getters exist at all, then
    // reach them from no turn. A stale claim handed back here would be the
    // whole bug in miniature, so it has to throw.
    await runInvocation(
      request({ claim: 'claim-A', endpoint: 'https://a.example.com/tools', awsSessionToken: 'token-A' }),
      () => {},
    );

    expect(() => observeCurrentState()).toThrow(/outside runInvocation/);
  });
});
