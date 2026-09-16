/**
 * How each grader is described to a person.
 *
 * Which grader produced a score is the single most load-bearing fact on these
 * pages: the same run scored by our own judge and by AWS can disagree, and a
 * reader who does not know which one they are looking at will read the
 * disagreement as the agent getting worse.
 *
 * The wording says where the work happens and who pays, because that is what
 * people actually ask when they see the label for the first time.
 */

export type ProviderCopy = {
  /** What the badge reads. */
  label: string;
  /** The tooltip, one or two plain sentences. */
  explanation: string;
};

const COPY: Record<string, ProviderCopy> = {
  vocion: {
    label: 'Vocion',
    explanation:
      'Scored by Vocion\'s own judge: a model we run, following the rubric in your workspace file. Nothing leaves Vocion, and the cost sits on your Vocion usage.',
  },
  agentcore: {
    label: 'AgentCore',
    explanation:
      'Scored by AWS Bedrock AgentCore: the transcript is sent to AWS, its evaluators grade it, and the scores come back here. AWS bills your own account for the judging.',
  },
};

/**
 * Describe one grader.
 *
 * An id we have never heard of still gets a label rather than an empty badge —
 * a score from a provider this build predates is still a real score, and
 * hiding its name would leave the reader worse off than a rough one.
 * @param providerId - The id stored on the run.
 */
export function describeProvider(providerId: string): ProviderCopy {
  const known = COPY[providerId];
  if (known) {
    return known;
  }
  return {
    label: providerId,
    explanation: `Scored by "${providerId}", a grader this version of Vocion does not have a description for.`,
  };
}
