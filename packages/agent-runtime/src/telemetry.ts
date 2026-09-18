/**
 * OpenTelemetry spans, so AWS can grade what this agent actually did.
 *
 * AgentCore Evaluations scores spans, not transcripts: it reads the prompt,
 * the reply, and every tool call with its arguments and its result out of
 * CloudWatch, then runs its evaluators over them. Without spans there is
 * nothing in the customer's AWS account to grade, and an eval score exists
 * only inside Vocion — which is not something a client's security team can
 * audit. This module is what puts them there.
 *
 * Three decisions worth keeping in view, because each one is the difference
 * between spans that score and spans AWS refuses:
 *
 * - **The instrumentation is registered by hand.** The usual route is ADOT's
 *   auto-instrumentation, which patches LangChain as it is imported. This
 *   artifact is an esbuild single-file bundle, so LangChain is already inlined
 *   by the time any loader hook could run and there is nothing left to patch.
 *   `manuallyInstrument` is the documented answer to exactly that, not a
 *   workaround: `@langchain/core` has no conventional module structure, so
 *   even an unbundled app registers it this way.
 * - **The scope name has to be one AWS parses.** OpenInference's LangChain
 *   instrumentation emits `@arizeai/openinference-instrumentation-langchain`,
 *   which AWS documents as supported for TypeScript LangGraph agents. A scope
 *   it does not recognise is not ignored — the whole session is refused with
 *   "Provided input has no spans with supported scope".
 * - **`session.id` must be on the spans.** It is what groups spans into a
 *   session, and a session is the unit an evaluator scores. Miss it and the
 *   spans are delivered, look fine, and match nothing.
 *
 * Transport is deliberately not set up here. On AgentCore Runtime the ADOT
 * distro is loaded through `--require` (see the Dockerfile) and owns the
 * exporter, the CloudWatch endpoint and its SigV4 signing. We attach to
 * whatever tracer provider it registered. Off that runtime — a laptop, a test
 * — no provider is registered, the OpenTelemetry API falls back to a no-op,
 * and nothing is exported. That is the intended behaviour, not a degraded
 * one: telemetry must never be the reason an agent fails to answer.
 */

import type { InvocationRequest } from './contract.js';
import process from 'node:process';
import { getSession, setSession } from '@arizeai/openinference-core';
import { LangChainInstrumentation } from '@arizeai/openinference-instrumentation-langchain';
import * as CallbackManagerModule from '@langchain/core/callbacks/manager';
import { context as otelContext } from '@opentelemetry/api';

/**
 * Turned on by the same variable AWS uses for its own agents, so a runtime
 * that has observability enabled gets spans and one that does not is
 * untouched. Absent means off.
 */
const ENABLED_VAR = 'AGENT_OBSERVABILITY_ENABLED';

let started = false;

/** Whether this process should emit spans at all. */
export function telemetryEnabled(): boolean {
  return (process.env[ENABLED_VAR] ?? '').toLowerCase() === 'true';
}

/**
 * Register LangChain instrumentation against the ambient tracer provider.
 *
 * Safe to call twice — the second call does nothing — because the server can
 * be started more than once in a test process.
 *
 * Never throws. A failure here costs observability; letting it escape would
 * cost the agent, which is a far worse trade.
 */
export function startTelemetry(): void {
  if (started || !telemetryEnabled()) {
    return;
  }
  started = true;
  try {
    const instrumentation = new LangChainInstrumentation();
    instrumentation.manuallyInstrument(CallbackManagerModule);
    console.warn('[telemetry] LangChain instrumentation registered');
  } catch (error) {
    console.error('[telemetry] could not register instrumentation; continuing without spans', error);
  }
  if (!contextPropagates()) {
    console.error(
      `[telemetry] ${ENABLED_VAR} is set but no OpenTelemetry context manager is registered — `
      + 'spans will carry no session.id and AgentCore Evaluations will match nothing. '
      + 'The runtime is probably started without '
      + '`--require @aws/aws-distro-opentelemetry-node-autoinstrumentation/register`.',
    );
  }
}

/**
 * Whether anything is actually carrying context across an async boundary.
 *
 * The OpenTelemetry API ships a no-op context manager, so when nothing has
 * registered a real one `withSession` still runs the turn, still returns the
 * right answer, and quietly drops the session. Every span then arrives without
 * a `session.id`, AWS accepts them, and the evaluation reports that it scored
 * nothing rather than reporting that anything went wrong. Worth one probe at
 * startup to turn that into a line in the logs.
 */
function contextPropagates(): boolean {
  const probe = setSession(otelContext.active(), { sessionId: 'probe' });
  return otelContext.with(probe, () => getSession(otelContext.active())?.sessionId === 'probe');
}

/**
 * The session this invocation belongs to, as AWS expects to find it.
 *
 * AgentCore addresses a session by `session.id`, and its evaluation reference
 * inputs are matched against that attribute — so the id here has to be the
 * same one the caller used, not one invented per process.
 *
 * Falls back to the AgentCore Runtime session header's value when the caller
 * sent none, and finally to the agent slug, which at least keeps spans from
 * one agent together rather than scattering them across unmatched sessions.
 * @param request - The invocation being served.
 */
export function sessionIdFor(request: InvocationRequest): string {
  return request.sessionId
    ?? request.trace?.sessionId
    ?? request.agent.slug;
}

/**
 * Run one turn inside its session, so every span it produces carries the id.
 *
 * `session.id` is how AgentCore groups spans into a session and how the
 * expected answers in an evaluation find the run they belong to. Setting it
 * per span would mean threading it through LangChain; setting it on the
 * context means the instrumentation reads it wherever the turn goes,
 * including inside tools.
 *
 * With telemetry off this is a straight call through, so the non-AWS path
 * costs nothing and behaves identically.
 * @param sessionId - The session this turn belongs to.
 * @param run - The turn.
 */
export function withSession<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  if (!telemetryEnabled()) {
    return run();
  }
  return otelContext.with(setSession(otelContext.active(), { sessionId }), run);
}
