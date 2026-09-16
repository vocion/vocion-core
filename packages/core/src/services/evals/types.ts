/**
 * Shared shapes for the eval layer.
 *
 * Kept apart from the services so a provider module can describe what it needs
 * without importing the runner, and so the runner does not import a provider
 * in order to know what a score looks like.
 */

/**
 * One authored test case.
 *
 * Three different things can say what "good" means here, and they are
 * deliberately not merged:
 *
 * - `rubric` is prose for our own judge, written per case.
 * - `expectedOutput`, `assertions` and `expectedTrajectory` are ground truth
 *   handed to AgentCore. `assertions` reads like a deterministic check but is
 *   not — it is natural language a judge model reads, and it makes the judge's
 *   task well defined rather than replacing it. `expectedTrajectory` is the
 *   genuinely deterministic one: comparing tool names in order needs no model.
 * - `checks` are ours, run in this process, no model call and no AWS account.
 */
export type EvalDatasetItem = {
  input: string;
  expectedOutput?: string;
  rubric?: string;
  tags?: string[];
  /** Tool names the agent should call, in order. Ground truth for trajectory scoring. */
  expectedTrajectory?: string[];
  /** Natural-language facts the answer must contain. Read by a judge, not matched. */
  assertions?: string[];
  /** Deterministic checks we run ourselves. See `checks.ts` for the operators. */
  checks?: EvalCheck[];
};

/**
 * One deterministic check.
 *
 * A closed set on purpose. Arbitrary code in a manifest means sandboxing,
 * timeouts and an escape hatch out of the app; a fixed vocabulary covers what
 * people actually ask for, and anything past it belongs in an AgentCore
 * `codeBased` evaluator, which is a Lambda the customer owns.
 */
export type EvalCheck
  = | { toolCalled: string }
    | { toolNotCalled: string }
    | { outputMatches: string }
    | { outputContains: string }
    | { outputNotContains: string }
    | { latencyUnderMs: number }
    | { turnsUnder: number };

/** The grain an evaluator judges at. Mirrors AgentCore's `EvaluatorLevel`. */
export type EvalScoreLevel = 'TOOL_CALL' | 'TRACE' | 'SESSION';

/**
 * One evaluator's opinion, in the shape the `eval_score` table stores.
 *
 * `value` and `label` are both optional because providers differ: a trajectory
 * matcher returns a pass/fail label with a 1 or 0 beside it, an LLM judge on a
 * five-point scale returns a label that only means something next to the
 * evaluator's name. Neither is coerced into the other.
 */
export type ProviderScore = {
  /** Our evaluator name, or the provider's id such as `Builtin.ToolSelectionAccuracy`. */
  evaluatorSlug: string;
  evaluatorName?: string | null;
  evaluatorArn?: string | null;
  level: EvalScoreLevel;
  value?: number | null;
  label?: string | null;
  explanation?: string | null;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  /** Set when this evaluator failed. A failure is recorded, never scored zero. */
  errorCode?: string | null;
  errorMessage?: string | null;
  /**
   * Which case this is about. Omitted for a score about the whole run, which
   * is what TRACE- and SESSION-level evaluators produce.
   */
  itemIndex?: number;
};
