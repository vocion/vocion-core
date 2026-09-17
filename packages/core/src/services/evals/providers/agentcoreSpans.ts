/**
 * Turning a transcript into spans AgentCore will read.
 *
 * AgentCore scores traces, not agents. The usual way to get a trace in front
 * of it is to instrument the agent with OpenTelemetry and ship spans into
 * AgentCore Observability — which our runtime does not do, since its tracing
 * is Langfuse-only.
 *
 * The synchronous `Evaluate` call takes a different route: its input is
 * `EvaluationInput.SessionSpansMember { sessionSpans }`, typed as free-form
 * documents. So we build the spans ourselves from a transcript we already
 * have, and skip the entire observability pipeline.
 *
 * Shape is the Strands unified-telemetry layout, which is one of the few
 * AgentCore knows how to parse: one `invoke_agent` root, one `execute_tool`
 * child per tool call, every span naming its scope and its session id, and the
 * conversation carried in log events rather than in attributes.
 *
 * None of that is a matter of taste. Every part of it was learned from a live
 * `Evaluate` call refusing the request outright — wrong scope, missing session
 * id, missing events, and tool arguments and results in the wrong events each
 * cost a whole run's scores — so the tests below quote the error each rule
 * prevents. Mocks cannot catch any of them, which is why they survived a green
 * suite. This module stays pure and does no I/O so those rules can be pinned
 * cheaply.
 */

import type { CaseTranscript } from '../transcripts';

/** A span as AgentCore receives it. Free-form JSON on the wire. */
export type SpanDocument = {
  name: string;
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  attributes: Record<string, unknown>;
  /** Which instrumentation's conventions these attributes follow. */
  scope: { name: string };
  /**
   * The messages this span carried.
   *
   * AgentCore refuses a span with none — `Session span data is incomplete …
   * missing a corresponding log event` — because it reads the conversation
   * out of these rather than out of the attributes.
   */
  events: SpanEvent[];
};

/** One log event hanging off a span: a message, in AgentCore's reading. */
export type SpanEvent = {
  name: string;
  timeUnixNano: number;
  attributes: Record<string, unknown>;
};

/**
 * The instrumentation scope AgentCore parses these spans as.
 *
 * Not decoration: AWS refuses a session whose spans carry no scope it knows,
 * with `Provided input has no spans with supported scope`, and every case goes
 * unscored. The value names the *shape* of the attributes, which is how AWS
 * picks a parser — ours are the OpenTelemetry GenAI conventions
 * (`gen_ai.operation.name`, `gen_ai.tool.name`, and so on), which is what the
 * Strands tracer emits.
 */
const SPAN_SCOPE = { name: 'strands.telemetry.tracer' };

const NANOS_PER_MS = 1_000_000;

/**
 * What the agent is called on its span.
 *
 * AWS reads `invoke_agent <name>`; the agent under test varies per dataset and
 * the name is not one of the fields any evaluator scores, so it is fixed
 * rather than smuggled in from the caller.
 */
const AGENT_SPAN_NAME = 'vocion-agent';

/** Longest tool text sent. Whole sessions have a request-size ceiling. */
const TOOL_TEXT_LIMIT = 4000;

/**
 * Stable, readable span ids.
 *
 * Derived from the case index rather than random, so the same transcript
 * always produces the same document. A fixture test can assert on ids, and a
 * retried evaluation sends something identical rather than merely equivalent.
 * @param caseIndex - Which case in the dataset.
 * @param suffix - What this span is within the case.
 */
function spanIdFor(caseIndex: number, suffix: string): string {
  return `case-${caseIndex}-${suffix}`;
}

/**
 * Build the spans for one case.
 *
 * Tool spans are laid end to end inside the session's window rather than given
 * real per-tool timings, because the transcript records one latency for the
 * whole case and inventing per-tool durations would be fabrication. The order
 * is real, and order is what the trajectory evaluators actually read.
 * @param transcript - What the case did.
 * @param sessionId - Groups this case's spans. One case is one session, and
 *   the expected answers are addressed to this same id.
 */
export function buildSessionSpans(transcript: CaseTranscript, sessionId: string): SpanDocument[] {
  const startMs = 0;
  const endMs = Math.max(transcript.latencyMs, 1);
  const rootId = spanIdFor(transcript.itemIndex, 'session');

  const root: SpanDocument = {
    name: `invoke_agent ${AGENT_SPAN_NAME}`,
    spanId: rootId,
    traceId: sessionId,
    startTimeUnixNano: startMs * NANOS_PER_MS,
    endTimeUnixNano: endMs * NANOS_PER_MS,
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': AGENT_SPAN_NAME,
      'gen_ai.system': 'strands-agents',
      // The reference inputs address this case by session id, and AWS matches
      // them against this attribute. Without it every case comes back as
      // "contexts that do not match any session".
      'session.id': sessionId,
    },
    scope: SPAN_SCOPE,
    // The prompt and the answer live in events, not attributes: AWS reads the
    // user turn from `gen_ai.user.message` and the agent's turn from
    // `gen_ai.choice`, and a span carrying neither is refused as incomplete.
    events: [
      {
        name: 'gen_ai.user.message',
        timeUnixNano: startMs * NANOS_PER_MS,
        attributes: { content: JSON.stringify([{ text: transcript.item.input }]) },
      },
      {
        name: 'gen_ai.choice',
        timeUnixNano: endMs * NANOS_PER_MS,
        attributes: { message: transcript.output, finish_reason: 'end_turn' },
      },
    ],
  };

  const spans: SpanDocument[] = [root];

  // Evenly spaced slots inside the session window. The count is real, the
  // order is real; the individual durations are not claimed to be.
  const slotMs = transcript.toolCalls.length > 0 ? endMs / (transcript.toolCalls.length + 1) : 0;

  transcript.toolCalls.forEach((call, index) => {
    const spanId = spanIdFor(transcript.itemIndex, `tool-${index}`);
    const callId = `toolcall-${transcript.itemIndex}-${index}`;
    const result = (call.output ?? '').slice(0, TOOL_TEXT_LIMIT);
    spans.push({
      name: `execute_tool ${call.tool}`,
      spanId,
      parentSpanId: rootId,
      traceId: sessionId,
      startTimeUnixNano: Math.round(slotMs * index) * NANOS_PER_MS,
      endTimeUnixNano: Math.round(slotMs * (index + 1)) * NANOS_PER_MS,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': call.tool,
        'gen_ai.tool.call.id': callId,
        'gen_ai.tool.status': 'success',
        'session.id': sessionId,
      },
      scope: SPAN_SCOPE,
      // Arguments in `gen_ai.tool.message`, result in `gen_ai.choice`. Putting
      // the result in the tool message instead is what AWS answers with
      // `Failed to parse tool_output from tool-span`.
      events: [
        {
          name: 'gen_ai.tool.message',
          timeUnixNano: Math.round(slotMs * index) * NANOS_PER_MS,
          attributes: {
            content: JSON.stringify(call.input ?? {}).slice(0, TOOL_TEXT_LIMIT),
            role: 'tool',
            id: callId,
          },
        },
        {
          name: 'gen_ai.choice',
          timeUnixNano: Math.round(slotMs * (index + 1)) * NANOS_PER_MS,
          attributes: { message: JSON.stringify([{ text: result }]), id: callId },
        },
      ],
    });
  });

  return spans;
}

/**
 * Spans for a whole dataset run, one session per case.
 *
 * Errored cases are skipped: there is no trajectory to score and no answer to
 * judge, and sending an empty session invites the evaluator to score it zero,
 * which would read as the agent answering badly rather than never answering.
 * @param transcripts - Every case in the run.
 * @param runTraceId - Prefix tying the run's sessions together.
 */
export function buildRunSpans(transcripts: CaseTranscript[], runTraceId: string): SpanDocument[][] {
  return transcripts
    .filter(transcript => !transcript.errored)
    .map(transcript => buildSessionSpans(transcript, `${runTraceId}-${transcript.itemIndex}`));
}
