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
  /** Whether a record just filed repeats one on file (`services/objects/duplicateCheck.ts`). */
  RECORD_DUPLICATE: 'record.duplicate',
  /** Which record a person's words name, read when a record is filed (`services/objects/referenceRead.ts`). */
  RECORD_REFERENCE: 'record.reference',
  /** A release's short name, written once when it is linked (`services/factory/releaseName.ts`). */
  RELEASE_NAME: 'release.name',
  /** Emergent chip synthesis — mission × skills × tracker state → chips. */
  CHIP_SYNTHESIS: 'chat.chip-synthesis',
  /**
   * The card pass after a chat answer: one fast call lists the decisions the
   * answer names, then one call per card writes it (`services/agents/cardBackstop.ts`).
   */
  CHAT_CARDS: 'chat.cards',
  /** A thread's name, written by the classifier model after its first reply. */
  CHAT_TITLE: 'chat.title',
  /** Which agent answers a conversation's first turn, read by the classifier (`services/agents/routeRead.ts`). */
  CHAT_ROUTE: 'chat.route',
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
  /** The `draw_mockup` survey — a vision read of the real screen a mockup is drawn on. */
  TOOL_MOCKUP: 'tool.mockup',
  /** `ci.diagnose` — why a factory pull request's CI is red, read by the classifier (backlog 049). */
  CI_DIAGNOSE: 'factory.ci_diagnose',
  /** Whether an environment's health response says what its `healthCheck.expect` asks, read by the classifier when the text is not there verbatim (backlog 049). */
  HEALTH_READ: 'factory.health_read',
} as const;

export type FeatureName = (typeof FEATURES)[keyof typeof FEATURES];
