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
 * Shape follows the OpenTelemetry GenAI semantic conventions closely enough
 * for AgentCore to recognise the parts it scores: one session root, one child
 * per tool call carrying the tool's name and arguments, and one for the final
 * response. This module is pure and does no I/O precisely because it is the
 * piece most likely to need adjusting once we see what real responses make of
 * it — a fixture test is the cheapest place to find that out.
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
};

const NANOS_PER_MS = 1_000_000;

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
 * Arguments as attributes, JSON-encoded, since attribute values are scalars.
 * @param toolName
 * @param input
 * @param output
 */
function toolAttributes(toolName: string, input: Record<string, unknown>, output: string): Record<string, unknown> {
  return {
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': toolName,
    'gen_ai.tool.call.arguments': JSON.stringify(input ?? {}),
    'gen_ai.tool.call.result': output.slice(0, 4000),
  };
}

/**
 * Build the spans for one case.
 *
 * Tool spans are laid end to end inside the session's window rather than given
 * real per-tool timings, because the transcript records one latency for the
 * whole case and inventing per-tool durations would be fabrication. The order
 * is real, and order is what the trajectory evaluators actually read.
 * @param transcript - What the case did.
 * @param traceId - Groups this case's spans. One case is one session.
 */
export function buildSessionSpans(transcript: CaseTranscript, traceId: string): SpanDocument[] {
  const startMs = 0;
  const endMs = Math.max(transcript.latencyMs, 1);
  const rootId = spanIdFor(transcript.itemIndex, 'session');

  const root: SpanDocument = {
    name: 'invoke_agent',
    spanId: rootId,
    traceId,
    startTimeUnixNano: startMs * NANOS_PER_MS,
    endTimeUnixNano: endMs * NANOS_PER_MS,
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.prompt': transcript.item.input,
      'gen_ai.completion': transcript.output,
    },
  };

  const spans: SpanDocument[] = [root];

  // Evenly spaced slots inside the session window. The count is real, the
  // order is real; the individual durations are not claimed to be.
  const slotMs = transcript.toolCalls.length > 0 ? endMs / (transcript.toolCalls.length + 1) : 0;

  transcript.toolCalls.forEach((call, index) => {
    spans.push({
      name: call.tool,
      spanId: spanIdFor(transcript.itemIndex, `tool-${index}`),
      parentSpanId: rootId,
      traceId,
      startTimeUnixNano: Math.round(slotMs * index) * NANOS_PER_MS,
      endTimeUnixNano: Math.round(slotMs * (index + 1)) * NANOS_PER_MS,
      attributes: toolAttributes(call.tool, call.input, call.output),
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
