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

import type { CaseTranscript, ToolCallRecord } from './transcripts';
import type { EvalCheck, ProviderScore, ToolArgumentCondition, ToolCallCountCondition } from './types';

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
 * Read a dot path out of a tool call's arguments.
 *
 * Says whether the path was there separately from what was at it, because
 * "the key is missing" and "the key holds null" are different findings, and a
 * check that conflates them cannot express `present: false`.
 * @param input - The arguments the agent passed the tool.
 * @param path - Dot path, e.g. `action_input.dedupOn`. Omit to read the whole object.
 */
function resolveArgumentPath(input: Record<string, unknown>, path: string | undefined): { found: boolean; value: unknown } {
  if (!path) {
    return { found: true, value: input };
  }
  let current: unknown = input;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return { found: false, value: undefined };
    }
    const container = current as Record<string, unknown>;
    if (!(segment in container)) {
      return { found: false, value: undefined };
    }
    current = container[segment];
  }
  return { found: true, value: current };
}

/**
 * Compare two values the way someone reading the YAML would expect.
 *
 * Arrays compare in order, because `[title, startDate, venueName]` is a key
 * whose order is part of what is being asserted; objects compare by their own
 * keys, whatever order they arrived in.
 * @param left - The value found in the call.
 * @param right - The value the case authored.
 */
function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    // A list and an object are never the same value, however alike their
    // keys look: `Object.keys(['a'])` is `['0']`, so without this a case
    // authoring `equals: {0: title}` would quietly match the array
    // `[title]` and report a rule kept that nobody checked.
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    return left.length === right.length && left.every((item, index) => deepEquals(item, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left as Record<string, unknown>).sort();
    const rightKeys = Object.keys(right as Record<string, unknown>).sort();
    if (leftKeys.length !== rightKeys.length || !leftKeys.every((key, index) => key === rightKeys[index])) {
      return false;
    }
    return leftKeys.every(key => deepEquals((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  }
  return false;
}

/**
 * One value as a short piece of text, for a substring test and for the
 * sentence a failed check writes.
 * @param value - Whatever was at the path.
 */
function renderArgumentValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return 'nothing';
  }
  return JSON.stringify(value) ?? String(value);
}

/**
 * Decide whether one call's arguments satisfy the case's predicates.
 *
 * Hands back the reason it failed rather than a bare false, so the score row
 * can name which predicate went wrong on which call instead of leaving the
 * reader to guess between four of them.
 * @param call - One tool call the agent made.
 * @param condition - What the case said those arguments must look like.
 */
function argumentsSatisfy(call: ToolCallRecord, condition: ToolArgumentCondition): { ok: boolean; reason: string } {
  const { found, value } = resolveArgumentPath(call.input, condition.path);
  const where = condition.path ? `${condition.tool}.${condition.path}` : `${condition.tool} arguments`;

  if (condition.present !== undefined) {
    // A key that is present and holds nothing is not a value anyone can act
    // on: an argument serialised as `undefined`, an empty string or a null
    // all mean the agent left it out, whatever the shape of the object says.
    const isThere = found && value !== null && value !== undefined && value !== '';
    if (isThere !== condition.present) {
      return {
        ok: false,
        reason: condition.present
          ? `${where} was missing`
          : `${where} was set to ${renderArgumentValue(value)}`,
      };
    }
  }
  if (condition.equals !== undefined && (!found || !deepEquals(value, condition.equals))) {
    return { ok: false, reason: `${where} was ${renderArgumentValue(value)}, expected ${renderArgumentValue(condition.equals)}` };
  }
  if (condition.contains !== undefined && (!found || !renderArgumentValue(value).includes(condition.contains))) {
    return { ok: false, reason: `${where} was ${renderArgumentValue(value)}, which does not contain "${condition.contains}"` };
  }
  if (condition.subsetOf !== undefined) {
    if (!found) {
      return { ok: false, reason: `${where} was missing, so nothing could be compared against the allowed values` };
    }
    // `subsetOf` asks whether every element is allowed, so a value that is
    // not a list has no elements to ask about. Stringifying it and comparing
    // that would answer a different question, and answer it wrong: a
    // comma-joined string would fail as one long value, and an object would
    // be compared as "[object Object]".
    if (!Array.isArray(value)) {
      return { ok: false, reason: `${where} was ${renderArgumentValue(value)}, which is not a list, so its values cannot be checked against the allowed ones` };
    }
    const allowed = new Set(condition.subsetOf);
    const strays = value.filter(item => !allowed.has(String(item)));
    if (strays.length > 0) {
      return {
        ok: false,
        reason: `${where} held ${strays.map(renderArgumentValue).join(', ')}, which ${strays.length === 1 ? 'is' : 'are'} not in the allowed values`,
      };
    }
  }
  return { ok: true, reason: '' };
}

/**
 * A short, stable name for one argument check, used as its evaluator slug.
 *
 * Names what is asserted as well as where, because two checks on one path —
 * "the key is there" and "the key is this exact list" — are two evaluators,
 * and sharing a slug merged their rows on every per-evaluator view.
 * @param condition - The condition being described.
 */
function describeArgumentCondition(condition: ToolArgumentCondition): string {
  const subject = condition.where ? `${condition.tool}[${condition.where.path}=${renderArgumentValue(condition.where.equals)}]` : condition.tool;
  const location = condition.path ? `${subject}.${condition.path}` : subject;
  const predicates: string[] = [];
  if (condition.present !== undefined) {
    predicates.push(`present=${condition.present}`);
  }
  if (condition.equals !== undefined) {
    predicates.push(`equals=${renderArgumentValue(condition.equals)}`);
  }
  if (condition.contains !== undefined) {
    predicates.push(`contains=${condition.contains}`);
  }
  if (condition.subsetOf !== undefined) {
    predicates.push(`subsetOf=${JSON.stringify(condition.subsetOf)}`);
  }
  if (condition.calls === 'some') {
    predicates.push('calls=some');
  }
  return predicates.length > 0 ? `${location}:${predicates.join(',')}` : location;
}

/**
 * The calls this condition is about.
 *
 * `where` is what makes a rule addressable when one tool files more than one
 * kind of thing: `propose_action` proposes an event and a venue, and an
 * event's dedup key is not a venue's.
 * @param transcript - The case's tool calls.
 * @param condition - The condition naming the tool and, optionally, the subset.
 */
function callsUnderTest(transcript: CaseTranscript, condition: ToolArgumentCondition): ToolCallRecord[] {
  const byName = transcript.toolCalls.filter(call => call.tool === condition.tool);
  if (!condition.where) {
    return byName;
  }
  const { path, equals } = condition.where;
  return byName.filter((call) => {
    const { found, value } = resolveArgumentPath(call.input, path);
    return found && deepEquals(value, equals);
  });
}

function checkToolCalledWith(transcript: CaseTranscript, condition: ToolArgumentCondition): CheckOutcome {
  const slug = `check:toolCalledWith:${describeArgumentCondition(condition)}`;
  const calls = callsUnderTest(transcript, condition);

  // A rule about what the arguments looked like cannot be kept by a call that
  // never happened, so this fails by default: passing would turn "the agent
  // stopped proposing anything at all" into a green check, which is the
  // failure this check exists to notice. `noCalls: pass` is for the other
  // shape of rule — "if it did this, it did it right" — where the thing
  // legitimately does not happen on every run.
  if (calls.length === 0) {
    const passed = condition.noCalls === 'pass';
    const subject = condition.where ? `${condition.tool} matching ${condition.where.path} = ${renderArgumentValue(condition.where.equals)}` : condition.tool;
    return {
      slug,
      passed,
      explanation: passed
        ? `No call to ${subject}, which this case allows.`
        : `Never called ${subject}. Tools used: ${describeTrajectory(transcript)}.`,
    };
  }

  const results = calls.map(call => argumentsSatisfy(call, condition));
  const failures = results.filter(result => !result.ok);
  const wantsEvery = (condition.calls ?? 'every') === 'every';
  const passed = wantsEvery ? failures.length === 0 : failures.length < results.length;
  const plural = calls.length === 1 ? '' : 's';

  if (passed) {
    return {
      slug,
      passed,
      explanation: wantsEvery
        ? `All ${calls.length} ${condition.tool} call${plural} matched.`
        : `${results.length - failures.length} of ${calls.length} ${condition.tool} call${plural} matched.`,
    };
  }
  return {
    slug,
    passed,
    explanation: `${failures.length} of ${calls.length} ${condition.tool} call${plural} did not match: ${failures.map(failure => failure.reason).join('; ')}.`,
  };
}

function checkToolCallCount(transcript: CaseTranscript, condition: ToolCallCountCondition): CheckOutcome {
  // The bounds are part of the name for the same reason an argument check's
  // predicate is: "at most one" and "exactly one" on one tool are two checks.
  const bounds = [
    condition.exactly !== undefined ? `exactly=${condition.exactly}` : null,
    condition.min !== undefined ? `min=${condition.min}` : null,
    condition.max !== undefined ? `max=${condition.max}` : null,
  ].filter(Boolean).join(',');
  const slug = bounds ? `check:toolCallCount:${condition.tool}:${bounds}` : `check:toolCallCount:${condition.tool}`;
  const count = transcript.trajectory.filter(tool => tool === condition.tool).length;
  const wanted: string[] = [];
  let passed = true;

  if (condition.exactly !== undefined) {
    wanted.push(`exactly ${condition.exactly}`);
    passed = passed && count === condition.exactly;
  }
  if (condition.min !== undefined) {
    wanted.push(`at least ${condition.min}`);
    passed = passed && count >= condition.min;
  }
  if (condition.max !== undefined) {
    wanted.push(`at most ${condition.max}`);
    passed = passed && count <= condition.max;
  }

  // Nothing to compare against is an authoring mistake rather than agent
  // behaviour, and it reads as one instead of as a rule the agent broke.
  if (wanted.length === 0) {
    return {
      slug,
      passed: false,
      explanation: `The toolCallCount check for ${condition.tool} names no exactly, min or max, so there is nothing to compare against.`,
    };
  }

  return {
    slug,
    passed,
    explanation: `Called ${condition.tool} ${count} time${count === 1 ? '' : 's'}, expected ${wanted.join(' and ')}.`,
  };
}

/**
 * Readable tool list for a failure message.
 * @param transcript - The case whose tool calls to describe.
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
  if ('toolCalledWith' in check) {
    return checkToolCalledWith(transcript, check.toolCalledWith);
  }
  if ('toolCallCount' in check) {
    return checkToolCallCount(transcript, check.toolCallCount);
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
