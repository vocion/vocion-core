import type { CaseTranscript } from '../transcripts';
import { describe, expect, it } from 'vitest';
import { buildRunSpans, buildSessionSpans } from './agentcoreSpans';

function transcript(overrides: Partial<CaseTranscript> = {}): CaseTranscript {
  return {
    itemIndex: 0,
    item: { input: 'refund my order 4471' },
    output: 'Refunded $42.10.',
    toolCalls: [
      { tool: 'lookup_order', input: { id: '4471' }, output: '{"total":4210}' },
      { tool: 'issue_refund', input: { id: '4471', cents: 4210 }, output: 'ok' },
    ],
    trajectory: ['lookup_order', 'issue_refund'],
    traceId: null,
    latencyMs: 1200,
    errored: false,
    errorMessage: '',
    usage: null,
    caseResultId: null,
    ...overrides,
  };
}

describe('buildSessionSpans', () => {
  it('puts one span per tool call under a single session root', () => {
    const spans = buildSessionSpans(transcript(), 'session-1');

    expect(spans).toHaveLength(3);
    expect(spans[0]?.name).toBe('invoke_agent vocion-agent');
    expect(spans[0]?.parentSpanId).toBeUndefined();
    expect(spans.slice(1).every(span => span.parentSpanId === spans[0]?.spanId)).toBe(true);
  });

  it('keeps the tool calls in the order they happened', () => {
    // The whole reason AgentCore can score a trajectory is that the order
    // survives. Emitting these as a set would make every trajectory evaluator
    // silently meaningless.
    const spans = buildSessionSpans(transcript(), 'session-1');

    expect(spans.slice(1).map(span => span.name)).toEqual(['execute_tool lookup_order', 'execute_tool issue_refund']);
  });

  it('names an instrumentation AgentCore knows how to parse', () => {
    // Live AWS refuses the whole session otherwise: "Provided input has no
    // spans with supported scope", and every case comes back unscored.
    const spans = buildSessionSpans(transcript(), 'session-1');

    expect(spans.every(span => span.scope.name === 'strands.telemetry.tracer')).toBe(true);
  });

  it('stamps the session id on every span, which is how the expected answers find their case', () => {
    // The reference inputs address a case by session id. Without this
    // attribute AWS answers "contexts that do not match any session" and
    // scores nothing, even though the spans themselves are fine.
    const spans = buildSessionSpans(transcript(), 'session-1');

    expect(spans.every(span => span.attributes['session.id'] === 'session-1')).toBe(true);
  });

  it('puts the tool arguments in the tool message and the result in the choice', () => {
    // Swapping these two is not cosmetic: AWS parses the result out of the
    // choice event and answers "Failed to parse tool_output from tool-span"
    // when the tool message holds it instead.
    const spans = buildSessionSpans(transcript(), 'session-1');
    const toolSpan = spans[1]!;

    expect(toolSpan.attributes['gen_ai.tool.name']).toBe('lookup_order');
    expect(toolSpan.events.find(event => event.name === 'gen_ai.tool.message')?.attributes.content).toBe('{"id":"4471"}');
    expect(toolSpan.events.find(event => event.name === 'gen_ai.choice')?.attributes.message).toBe('[{"text":"{\\"total\\":4210}"}]');
  });

  it('carries the prompt and the answer as events, not as attributes', () => {
    // A span with no events is rejected outright: "Session span data is
    // incomplete ... missing a corresponding log event".
    const spans = buildSessionSpans(transcript(), 'session-1');

    expect(spans[0]?.events.map(event => event.name)).toEqual(['gen_ai.user.message', 'gen_ai.choice']);
    expect(spans[0]?.events[0]?.attributes.content).toBe('[{"text":"refund my order 4471"}]');
    expect(spans[0]?.events[1]?.attributes.message).toBe('Refunded $42.10.');
  });

  it('gives every tool call its own id, shared by its arguments and its result', () => {
    // Two calls to the same tool in one session are told apart by this id;
    // reusing one would let AWS pair the second call's arguments with the
    // first call's result.
    const spans = buildSessionSpans(transcript(), 'session-1');
    const ids = spans.slice(1).map(span => span.attributes['gen_ai.tool.call.id']);

    expect(new Set(ids).size).toBe(2);
    expect(spans[1]?.events.every(event => event.attributes.id === ids[0])).toBe(true);
  });

  it('produces a valid single-span session when the agent called no tools', () => {
    // A conversational agent that answers without tools still has to be
    // scoreable; an empty span list would be rejected outright.
    const spans = buildSessionSpans(transcript({ toolCalls: [], trajectory: [] }), 'session-1');

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('invoke_agent vocion-agent');
    expect(spans[0]?.endTimeUnixNano).toBeGreaterThan(spans[0]!.startTimeUnixNano);
  });

  it('gives a zero-latency case a non-zero window', () => {
    // A span that starts and ends at the same instant is rejected by some
    // consumers, and a sub-millisecond case is plausible with a cached answer.
    const spans = buildSessionSpans(transcript({ latencyMs: 0, toolCalls: [], trajectory: [] }), 's');

    expect(spans[0]?.endTimeUnixNano).toBeGreaterThan(spans[0]!.startTimeUnixNano);
  });

  it('builds the same document twice for the same transcript', () => {
    // Ids are derived, not random, so a retried evaluation sends something
    // identical rather than merely equivalent.
    const first = buildSessionSpans(transcript(), 'session-1');
    const second = buildSessionSpans(transcript(), 'session-1');

    expect(first).toEqual(second);
  });
});

describe('buildRunSpans', () => {
  it('skips cases whose agent run threw', () => {
    // An errored case has no answer and no trajectory. Sending it invites a
    // score of zero, which reads as "answered badly" rather than "never
    // answered" and would show an outage as a quality drop.
    const sessions = buildRunSpans([
      transcript({ itemIndex: 0 }),
      transcript({ itemIndex: 1, errored: true, output: '', toolCalls: [], trajectory: [] }),
    ], 'run-9');

    expect(sessions).toHaveLength(1);
  });

  it('gives each case its own trace id', () => {
    const sessions = buildRunSpans([
      transcript({ itemIndex: 0 }),
      transcript({ itemIndex: 1 }),
    ], 'run-9');

    expect(sessions[0]?.[0]?.traceId).toBe('run-9-0');
    expect(sessions[1]?.[0]?.traceId).toBe('run-9-1');
  });
});
