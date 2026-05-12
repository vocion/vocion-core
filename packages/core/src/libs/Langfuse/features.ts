/**
 * Closed enum of "feature" dimensions stamped on every Langfuse trace.
 *
 * Adding a new feature MUST mean editing this file, not passing a free
 * string at the call site. That's what keeps the Langfuse UI's
 * `tags = feature:<name>` filter useful for slicing cost / volume by
 * surface (chat vs. operation vs. eval).
 */

export const FEATURES = {
  /** Chat-time agent runs via `runAgentDeep` (LangChain + deepagents). */
  AGENT_CHAT: 'agent.chat',
  /** Legacy OpenAI-loop agent runs via `runAgent`. */
  AGENT_DEV: 'agent.dev',
  /** Operation (= skill) runs via `executeSkill` / `executePluginSkill`. */
  OPERATION_RUN: 'operation.run',
  /** Eval-judge calls in `EvalService.runDataset`. */
  EVAL_JUDGE: 'eval.judge',
  /** Workflow step execution from Temporal Activities. */
  WORKFLOW_STEP: 'workflow.step',
  /** Live Onyx retrieval requests proxied via `/rpc/onyx`. */
  ONYX_SEARCH: 'onyx.search',
  /** Haiku-based feedback bucket classifier. */
  FEEDBACK_CLASSIFY: 'feedback.classify',
  /** OAuth token-refresh round-trips for Source plugins. */
  SOURCE_OAUTH: 'source.oauth',
} as const;

export type FeatureName = (typeof FEATURES)[keyof typeof FEATURES];
