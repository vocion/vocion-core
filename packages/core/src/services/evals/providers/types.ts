/**
 * What a score provider is.
 *
 * A provider grades transcripts someone else produced. It never runs the
 * agent — that already happened, and handing the same transcript to two
 * providers is what makes their scores comparable. Running the agent twice
 * would mean a disagreement could be the agent changing rather than the
 * grader, which is the one thing a trend line must not be ambiguous about.
 *
 * `id` is an open string rather than a union of the two we ship, so adding
 * Azure AI Foundry or Vertex later is a new module and a `registerProvider`
 * call rather than an edit to every `switch` that mentions a provider.
 */

import type { CaseTranscript } from '../transcripts';
import type { ProviderScore } from '../types';

/**
 * Whether this provider can grade anything for this org right now, and if not,
 * why.
 *
 * A reason rather than a bare boolean because the two failures look completely
 * different to a person. "No AWS credential" means the feature is simply off
 * for them and nothing should appear. "Credential present, region has no
 * AgentCore Evaluations" means it looks available and then fails on every
 * single case — which reads as the agent being broken rather than the setup
 * being wrong. Saying so once, before any run, is the difference.
 */
export type ProviderAvailability = {
  available: boolean;
  /** Shown to an operator when `available` is false. Empty when it is true. */
  reason: string;
};

/** Everything a provider needs to grade one dataset run. */
export type ScoreRequest = {
  orgId: string;
  datasetSlug: string;
  agentSlug: string;
  transcripts: CaseTranscript[];
};

export type EvalScoreProvider = {
  /** Stored in `eval_run.provider` and `eval_score.provider`. */
  id: string;
  /** What a person sees on the filter and the score chips. */
  label: string;
  isAvailable: (orgId: string) => Promise<ProviderAvailability>;
  /**
   * Grade the transcripts. Returns every score it produced, each one saying
   * which case it belongs to, or saying nothing to mean the whole run.
   *
   * Throwing here fails only this provider's run. The other providers, and
   * the transcripts themselves, survive — a broken AWS account must not cost
   * someone their own judge's results.
   */
  score: (request: ScoreRequest) => Promise<ProviderScore[]>;
};
