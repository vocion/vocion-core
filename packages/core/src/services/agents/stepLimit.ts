/**
 * How many steps one agent turn may take before it is stopped.
 *
 * An author sets this per agent as `harness.maxSteps` in workspace YAML. It is
 * optional on purpose: an agent that says nothing keeps each provider's own
 * backstop — deepagents' 10,000 graph steps on the in-process and runtime
 * loops, 12 tool rounds on the AWS-managed harness. A runaway loop (a tool
 * that keeps returning a retryable error, a queue that keeps refilling) is an
 * edge case, and the person who wrote the agent is the one who knows how long
 * its real work runs. See vocion-core#271.
 *
 * The unit is a LangGraph graph step, because that is what deepagents counts.
 * One model call followed by the tool calls it asked for is about two steps,
 * and tool calls made in parallel share one. The AWS-managed harness counts
 * tool rounds instead — one model call plus its tools — so it gets half.
 */

/**
 * The `recursionLimit` `createDeepAgent` binds onto its graph (deepagents
 * 1.10.1). Used only to name the limit in the stop message when the agent set
 * none; never passed to the graph, so a deepagents upgrade that changes it is
 * still obeyed.
 */
export const DEEPAGENTS_DEFAULT_STEPS = 10_000;

/** Tool rounds the AWS-managed harness allows when the agent sets no `maxSteps`. */
export const DEFAULT_AGENTCORE_TOOL_ROUNDS = 12;

/**
 * The `streamEvents` config that applies an agent's step limit.
 *
 * Empty when the agent set none, so deepagents' own `recursionLimit` stands
 * rather than a number of ours that would look like a decision somebody made.
 * @param maxSteps - The agent's `harness.maxSteps`, if it set one.
 * @returns `{ recursionLimit }` to spread into the stream config, or `{}`.
 */
export function stepLimitStreamConfig(maxSteps: number | undefined): { recursionLimit?: number } {
  return maxSteps ? { recursionLimit: maxSteps } : {};
}

/**
 * How many tool rounds the AWS-managed harness may run for this agent.
 *
 * Half of `maxSteps`, rounded down, because one round is a model call plus its
 * tools — about two graph steps on the other loops. Never below one round, so
 * `maxSteps: 1` still lets the model answer once.
 * @param maxSteps - The agent's `harness.maxSteps`, if it set one.
 * @returns The round limit for `runAgentOnAgentCoreHarness`.
 */
export function agentCoreToolRounds(maxSteps: number | undefined): number {
  if (!maxSteps) {
    return DEFAULT_AGENTCORE_TOOL_ROUNDS;
  }
  return Math.max(1, Math.floor(maxSteps / 2));
}

/**
 * Whether an error thrown out of a deepagents stream is the step limit tripping.
 *
 * Matched by name rather than `instanceof`, because the error class comes from
 * whichever copy of `@langchain/langgraph` deepagents resolved, which need not
 * be the one this module would import.
 * @param error - Anything caught from `streamEvents`.
 */
export function isStepLimitError(error: unknown): boolean {
  return error instanceof Error && error.name === 'GraphRecursionError';
}

/**
 * The words the person sees when a turn is stopped at its step limit.
 *
 * Replaces LangGraph's "Recursion limit of N reached without hitting a stop
 * condition", which names a library setting the author never wrote. This one
 * names the setting they can change.
 * @param limit - The limit that tripped, in the unit its provider counts.
 * @param unit - `steps` for the deepagents loops, `tool rounds` for AgentCore.
 */
export function stepLimitMessage(limit: number, unit: 'steps' | 'tool rounds'): string {
  return `This agent stopped after ${limit} ${unit} without finishing its answer. `
    + 'Raise `maxSteps` in the agent\'s harness block if its work needs more.';
}
