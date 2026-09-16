/**
 * Deterministic checks we run ourselves.
 *
 * AgentCore's only genuinely deterministic scorer is trajectory matching.
 * Everything else it ships is a judge model reading text — including
 * `assertions`, which looks like an assertion library and is not one. Its only
 * non-model alternative is a Lambda the customer builds and deploys.
 *
 * So this is the cheap layer: string and number comparisons over a transcript,
 * no model call, no AWS account, no deploy. It covers what people actually
 * mean by "just check it did the thing".
 *
 * The vocabulary is closed. Arbitrary code in a workspace manifest would mean
 * sandboxing, timeouts and a way out of the app, and the escape hatch for
 * anything past this list is an AgentCore `codeBased` evaluator.
 *
 * Every operator is a plain function taking the transcript and its argument,
 * so each one is testable on its own and none of them can see anything the
 * others can.
 */

import type { CaseTranscript } from './transcripts';
import type { EvalCheck, ProviderScore } from './types';

/** What one operator decided, before it becomes a score row. */
type CheckOutcome = {
  /** Reads as an evaluator name in the UI, e.g. `check:toolCalled`. */
  slug: string;
  passed: boolean;
  /** One sentence saying what was expected and what happened. */
  explanation: string;
};

function checkToolCalled(transcript: CaseTranscript, tool: string): CheckOutcome {
  const passed = transcript.trajectory.includes(tool);
  return {
    slug: `check:toolCalled:${tool}`,
    passed,
    explanation: passed
      ? `Called ${tool}.`
      : `Never called ${tool}. Tools used: ${describeTrajectory(transcript)}.`,
  };
}

function checkToolNotCalled(transcript: CaseTranscript, tool: string): CheckOutcome {
  const passed = !transcript.trajectory.includes(tool);
  return {
    slug: `check:toolNotCalled:${tool}`,
    passed,
    explanation: passed
      ? `Did not call ${tool}.`
      : `Called ${tool}, which this case forbids.`,
  };
}

function checkOutputMatches(transcript: CaseTranscript, pattern: string): CheckOutcome {
  const slug = `check:outputMatches:${pattern}`;
  let expression: RegExp;
  try {
    expression = new RegExp(pattern);
  } catch (error) {
    // A broken pattern is an authoring mistake, and reporting it as a failed
    // check would read as "the agent got it wrong" when the agent is fine.
    console.error(`[evals] check outputMatches has an invalid pattern: ${pattern}`, error);
    return { slug, passed: false, explanation: `Invalid regular expression: ${pattern}` };
  }
  const passed = expression.test(transcript.output);
  return {
    slug,
    passed,
    explanation: passed ? `Output matched /${pattern}/.` : `Output did not match /${pattern}/.`,
  };
}

function checkOutputContains(transcript: CaseTranscript, needle: string): CheckOutcome {
  const passed = transcript.output.includes(needle);
  return {
    slug: `check:outputContains:${needle}`,
    passed,
    explanation: passed ? `Output contained "${needle}".` : `Output did not contain "${needle}".`,
  };
}

function checkOutputNotContains(transcript: CaseTranscript, needle: string): CheckOutcome {
  const passed = !transcript.output.includes(needle);
  return {
    slug: `check:outputNotContains:${needle}`,
    passed,
    explanation: passed ? `Output avoided "${needle}".` : `Output contained "${needle}", which this case forbids.`,
  };
}

function checkLatencyUnderMs(transcript: CaseTranscript, budgetMs: number): CheckOutcome {
  const passed = transcript.latencyMs < budgetMs;
  return {
    slug: `check:latencyUnderMs:${budgetMs}`,
    passed,
    explanation: `Took ${transcript.latencyMs}ms against a ${budgetMs}ms budget.`,
  };
}

function checkTurnsUnder(transcript: CaseTranscript, budget: number): CheckOutcome {
  const turns = transcript.usage?.turns ?? 0;
  const passed = turns < budget;
  return {
    slug: `check:turnsUnder:${budget}`,
    passed,
    explanation: `Used ${turns} model turns against a budget of ${budget}.`,
  };
}

/**
 * Readable tool list for a failure message.
 * @param transcript
 */
function describeTrajectory(transcript: CaseTranscript): string {
  return transcript.trajectory.length > 0 ? transcript.trajectory.join(' → ') : 'none';
}

/**
 * Apply one check and say what it decided.
 *
 * Returns null for a check whose operator is not recognised — a manifest from
 * a newer version of the product should not fail an entire run because of one
 * key this build has never heard of.
 * @param transcript - What the case actually did.
 * @param check - The single-key object the manifest authored.
 */
export function runCheck(transcript: CaseTranscript, check: EvalCheck): CheckOutcome | null {
  if ('toolCalled' in check) {
    return checkToolCalled(transcript, check.toolCalled);
  }
  if ('toolNotCalled' in check) {
    return checkToolNotCalled(transcript, check.toolNotCalled);
  }
  if ('outputMatches' in check) {
    return checkOutputMatches(transcript, check.outputMatches);
  }
  if ('outputContains' in check) {
    return checkOutputContains(transcript, check.outputContains);
  }
  if ('outputNotContains' in check) {
    return checkOutputNotContains(transcript, check.outputNotContains);
  }
  if ('latencyUnderMs' in check) {
    return checkLatencyUnderMs(transcript, check.latencyUnderMs);
  }
  if ('turnsUnder' in check) {
    return checkTurnsUnder(transcript, check.turnsUnder);
  }
  console.error('[evals] unrecognised check, skipping', check);
  return null;
}

/**
 * Score every check on one case.
 *
 * A case whose agent run threw is not checked at all: "did not call the refund
 * tool" is true of a crashed run and says nothing about the agent's behaviour,
 * so reporting it as a failed check would be noise dressed up as a finding.
 * @param transcript - What the case actually did.
 */
export function scoreChecks(transcript: CaseTranscript): ProviderScore[] {
  if (transcript.errored) {
    return [];
  }
  const checks = transcript.item.checks ?? [];
  const scores: ProviderScore[] = [];
  for (const check of checks) {
    const outcome = runCheck(transcript, check);
    if (!outcome) {
      continue;
    }
    scores.push({
      evaluatorSlug: outcome.slug,
      evaluatorName: outcome.slug,
      level: 'TOOL_CALL',
      value: outcome.passed ? 1 : 0,
      label: outcome.passed ? 'pass' : 'fail',
      explanation: outcome.explanation,
      itemIndex: transcript.itemIndex,
    });
  }
  return scores;
}
