/**
 * The step limit for one runtime turn — a hand copy of the deepagents half of
 * core's `services/agents/stepLimit.ts`.
 *
 * Copied rather than imported because the runtime artifact is bundled and
 * deployed on its own and cannot import core, the same reason
 * `./promptCache.ts` is a copy. Core sends `agent.maxSteps` only when the
 * agent's `harness:` block set it; absent, deepagents' own `recursionLimit`
 * (10,000 graph steps) stands. See vocion-core#271.
 */

/** deepagents' own `recursionLimit` (1.10.1), used only to name it in the stop message. */
export const DEEPAGENTS_DEFAULT_STEPS = 10_000;

/**
 * The `streamEvents` config that applies an agent's step limit.
 * @param maxSteps - `req.agent.maxSteps`, if core sent one.
 * @returns `{ recursionLimit }` to spread into the stream config, or `{}`.
 */
export function stepLimitStreamConfig(maxSteps: number | undefined): { recursionLimit?: number } {
  return maxSteps ? { recursionLimit: maxSteps } : {};
}

/**
 * The message to send for a failed turn: the step-limit wording when the
 * limit is what stopped it, the error's own message otherwise.
 *
 * Matched by name, not `instanceof`, because the error class belongs to
 * whichever copy of `@langchain/langgraph` deepagents resolved.
 * @param error - Anything caught from `streamEvents`.
 * @param maxSteps - `req.agent.maxSteps`, if core sent one.
 */
export function turnFailureMessage(error: unknown, maxSteps: number | undefined): string {
  if (error instanceof Error && error.name === 'GraphRecursionError') {
    const limit = maxSteps ?? DEEPAGENTS_DEFAULT_STEPS;
    return `This agent stopped after ${limit} steps without finishing its answer. `
      + 'Raise `maxSteps` in the agent\'s harness block if its work needs more.';
  }
  return (error as Error | undefined)?.message ?? 'agent run failed';
}
