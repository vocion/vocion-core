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
    | { toolCalledWith: ToolArgumentCondition }
    | { toolCallCount: ToolCallCountCondition }
    | { outputMatches: string }
    | { outputContains: string }
    | { outputNotContains: string }
    | { latencyUnderMs: number }
    | { turnsUnder: number };

/**
 * What one tool call's arguments have to look like.
 *
 * The tool name and the output text were the only things a check could read
 * until now, which left the arguments — where the envelope shape, the dedup
 * key and the suggested decision all live — unmeasurable by any grader we
 * have. A rule the agent breaks inside `action_input` looked exactly like a
 * rule it kept.
 *
 * `path` walks into the arguments with dots, so `action_input.dedupOn` reads
 * that array out of a `propose_action` call. Omit it to test the whole
 * argument object.
 *
 * Whichever predicates are given must all hold. `calls` says how many of the
 * tool's calls have to satisfy them: `every` — the default, and what a rule
 * like "every proposal carries a reason" means — or `some`, for "at least one
 * call did this". A case where the tool was never called fails either way,
 * because a rule about calls that never happened is not a rule anyone kept.
 */
export type ToolArgumentCondition = {
  /** Which tool's calls to read. */
  tool: string;
  /**
   * Narrows those calls to the ones this describes.
   *
   * One tool often files several different things: `propose_action` proposes
   * an event and a venue with the same name and different payloads, and a
   * rule about one is false of the other — an event's dedup key is
   * `[title, startDate, venueName]`, a venue's is `[name, city]`. Without a
   * way to say which calls a rule is about, the rule fails on every call it
   * was never meant to describe.
   */
  where?: { path: string; equals: unknown };
  /**
   * What it means when no call matched: `fail`, the default, because a rule
   * about calls that never happened is not a rule anything kept and an agent
   * that silently stopped doing the thing is the regression most worth
   * catching. `pass` is for a rule shaped "if it did this, it did it right" —
   * a venue proposal the run only makes when the venue is new.
   */
  noCalls?: 'fail' | 'pass';
  /** Dot path into the call's arguments. Omit for the whole argument object. */
  path?: string;
  /** The value at `path` must equal this, compared by value, not identity. */
  equals?: unknown;
  /** The value at `path`, rendered as text, must contain this. */
  contains?: string;
  /** Whether the value at `path` has to be there at all. */
  present?: boolean;
  /** Every element of the value at `path` must be one of these. */
  subsetOf?: string[];
  /** How many of the tool's calls must satisfy the predicates. Default `every`. */
  calls?: 'every' | 'some';
};

/**
 * How many times a tool was allowed to be called.
 *
 * Counting is its own question. "Refreshed the existing card instead of
 * opening a second one" is a rule about how many proposals went out, and
 * `toolCalled` answers only whether any did.
 *
 * At least one of `exactly`, `min` or `max` has to be given, or the check has
 * nothing to decide.
 */
export type ToolCallCountCondition = {
  tool: string;
  exactly?: number;
  min?: number;
  max?: number;
};

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
