/**
 * LEGWORK ROUTING — which model and how much thinking each model call of a
 * turn gets.
 *
 * On 2026-10-09 "What sales emails do I need to answer" took 35 steps and
 * 3m20s (trace c126f3ca), and 222 s of it was model time. Most of that was
 * extended thinking on calls whose only job was to pick the next search: the
 * lead runs `claude-sonnet-5`, which thinks unless told not to, and every step
 * spent 1–3k output tokens of thinking at ~90 tok/s before writing a 60-token
 * tool call. The consult (13 more steps) ran on the same model, thinking the
 * same way, to do lookups.
 *
 * Two routes, both structural — read off the turn's shape, never its words:
 *
 *   - **The lead thinks where thinking pays.** The turn's first call — the one
 *     that reads the person's message and plans — keeps the agent's own
 *     thinking. A call made after tool results (the lead reading what came back
 *     and choosing what next, or writing the answer from it) runs with
 *     thinking off. The plan is where judgement goes; what follows is reading.
 *     Thinking is switched once per turn, on→off, never back on mid-loop: a
 *     tool loop may not resume thinking after a call without it.
 *   - **Teammates do legwork on the fast model.** A consult (`task`) is
 *     lookups and a summary; it runs on the classifier model (Haiku 4.5) with
 *     the lead's tools in full — not behind tool search, which the fast model
 *     may not take.
 *
 * Both are the agent's to change (`harness.legworkThinking: agent` keeps
 * thinking on every call; `harness.legworkModel: main` keeps teammates on the
 * main model). A person who picked a thinking level for the thread gets it on
 * every call — this routing only applies when nobody chose.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LangChainProvider } from '@/libs/llm';
import { createMiddleware } from 'langchain';
import { anthropicAdaptiveOnly, anthropicOffIsBetweenTools, anthropicThinksUnlessDisabled, resolvedModelIdFor, resolveProvider } from '@/libs/llm/langchain';

/** Where a teammate's calls run. */
export type LegworkModel = 'fast' | 'main';
/** Whether calls after the plan think: `off` (the default) or as the agent always does. */
export type LegworkThinking = 'off' | 'agent';

/**
 * The agent's two knobs, defaulted.
 * @param harness
 */
export function legworkConfig(harness: { legworkModel?: unknown; legworkThinking?: unknown } | undefined): { model: LegworkModel; thinking: LegworkThinking } {
  return {
    model: harness?.legworkModel === 'main' ? 'main' : 'fast',
    thinking: harness?.legworkThinking === 'agent' ? 'agent' : 'off',
  };
}

/**
 * Whether "thinking off" builds a different model from the agent's own — so a
 * second model is worth holding. True for a model that thinks unless told not
 * to (Sonnet 5, Opus 5) and for any model when the deployment turns budgeted
 * thinking on (`VOCION_THINKING_BUDGET`). False for a model that cannot turn
 * thinking off at all, or already keeps it out of tool calls.
 * @param opts - The agent's model options.
 * @param opts.provider - Its vendor, when named.
 * @param opts.model - Its model id, when named.
 */
export function stepThinkingDiffers(opts: { provider?: LangChainProvider; model?: string }): boolean {
  const provider = opts.provider ?? resolveProvider('main');
  if (provider !== 'anthropic' && provider !== 'bedrock') {
    return false;
  }
  const id = opts.model ?? resolvedModelIdFor('main', provider);
  if (anthropicAdaptiveOnly(id) || anthropicOffIsBetweenTools(id)) {
    return false;
  }
  return anthropicThinksUnlessDisabled(id) || (provider === 'anthropic' && !!process.env.VOCION_THINKING_BUDGET);
}

/**
 * Whether a model call reads tool results: the last message in the request is
 * a tool result. The turn's opening call reads the person's message instead.
 * @param messages - The messages going to the model.
 */
export function readsToolResults(messages: ReadonlyArray<{ _getType?: () => string; type?: string; getType?: () => string }>): boolean {
  const last = messages[messages.length - 1];
  if (!last) {
    return false;
  }
  const type = typeof last.getType === 'function' ? last.getType() : typeof last._getType === 'function' ? last._getType() : last.type;
  return type === 'tool';
}

/**
 * Runs the calls that read tool results on `stepModel` — the agent's model with
 * thinking off — and leaves the opening call alone.
 * @param stepModel - The agent's model, built with thinking off.
 */
export function createLegworkThinkingMiddleware(stepModel: BaseChatModel) {
  return createMiddleware({
    name: 'VocionLegworkThinking',
    wrapModelCall: async (request, handler) => {
      if (!readsToolResults(request.messages as never)) {
        return handler(request);
      }
      return handler({ ...request, model: stepModel as never });
    },
  });
}
