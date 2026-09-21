/**
 * Closed enum of "feature" dimensions stamped on every Langfuse trace, and the
 * same dimension `BudgetService` charges non-agent model spend against.
 *
 * Adding a new feature MUST mean editing this file, not passing a free
 * string at the call site. That's what keeps the Langfuse UI's
 * `tags = feature:<name>` filter useful for slicing cost / volume by
 * surface (chat vs. operation vs. eval) — and, since #279, what gives a paid
 * call that belongs to no agent a budget row to land on
 * (`platform:<feature>`).
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
  /** Haiku-based feedback bucket classifier. */
  FEEDBACK_CLASSIFY: 'feedback.classify',
  /** Haiku-based duplicate check between a proposed rule and existing ones. */
  FEEDBACK_DEDUPE: 'feedback.dedupe',
  /** Emergent chip synthesis — mission × skills × tracker state → chips. */
  CHIP_SYNTHESIS: 'chat.chip-synthesis',
  /** OAuth token-refresh round-trips for Source plugins. */
  SOURCE_OAUTH: 'source.oauth',
  /** Native pgvector + Postgres FTS hybrid retrieval. */
  RETRIEVAL_SEARCH: 'retrieval.search',
  /** OpenAI embedding batches — ingest + query + rerank paths. */
  RETRIEVAL_EMBED: 'retrieval.embed',
  /** Source-plugin → knowledge_* ingest runs. */
  RETRIEVAL_INGEST: 'retrieval.ingest',
  /** Optional rerank pass over top-K hybrid candidates. */
  RETRIEVAL_RERANK: 'retrieval.rerank',
  /** Scoped skill-turn executor — one skill, read-only tools, structured output. */
  SKILL_TURN: 'skill.turn',
  /** Per-document candidate extraction inside a source sync's processor stage. */
  PROCESSOR_EXTRACT: 'processor.extract',
  /** Rewrite-with-AI on a pending action's draft, from the review queue. */
  REVIEW_REWRITE: 'review.rewrite',
  /** Sales-call transcript classification in the discovery detector. */
  DISCOVERY_CLASSIFY: 'discovery.classify',
  /** The `generate_image` agent tool — the priciest single call an agent makes. */
  TOOL_IMAGE: 'tool.image',
} as const;

export type FeatureName = (typeof FEATURES)[keyof typeof FEATURES];
