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
import type { EvalCheck, ProviderScore, ToolArgumentCondition, ToolCallCountCondition, ToolCallFilter } from './types';
import { calendarDayOf, resolveDayZone, resolveRelativeDay } from '@/libs/time/relativeDay';

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
 * What was found at a condition's path in one call, plus the name a failure
 * sentence uses for it. Each predicate below reads the same three facts.
 */
type ResolvedArgument = {
  found: boolean;
  value: unknown;
  /** `propose_action.action_input.dedupOn`, or `propose_action arguments`. */
  where: string;
};

/**
 * Whether a path holds something anyone could act on.
 *
 * A key that is present and holds nothing is not a value: an argument
 * serialised as `undefined`, an empty string or a null all mean the agent
 * left it out, whatever the shape of the object says. Shared by the
 * `present` predicate and by a `where` filter, so "has a recurrence" means
 * the same thing in both.
 * @param found - Whether the path existed.
 * @param value - What was at it.
 */
function holdsAValue(found: boolean, value: unknown): boolean {
  return found && value !== null && value !== undefined && value !== '';
}

/**
 * Why the value's presence broke the rule, or null when it held.
 *
 * A key that is present and holds nothing is not a value anyone can act on:
 * an argument serialised as `undefined`, an empty string or a null all mean
 * the agent left it out, whatever the shape of the object says.
 * @param argument - What was at the path.
 * @param present - Whether the case wanted it there.
 */
function presenceFailure(argument: ResolvedArgument, present: boolean): string | null {
  const { found, value, where } = argument;
  if (holdsAValue(found, value) === present) {
    return null;
  }
  return present ? `${where} was missing` : `${where} was set to ${renderArgumentValue(value)}`;
}

/**
 * Why the value did not equal the authored one, or null when it did.
 * @param argument - What was at the path.
 * @param expected - The value the case authored.
 */
function equalsFailure(argument: ResolvedArgument, expected: unknown): string | null {
  const { found, value, where } = argument;
  if (found && deepEquals(value, expected)) {
    return null;
  }
  return `${where} was ${renderArgumentValue(value)}, expected ${renderArgumentValue(expected)}`;
}

/**
 * Why the value's text did not contain the needle, or null when it did.
 * @param argument - What was at the path.
 * @param needle - The text the case said must appear.
 */
function containsFailure(argument: ResolvedArgument, needle: string): string | null {
  const { found, value, where } = argument;
  if (found && renderArgumentValue(value).includes(needle)) {
    return null;
  }
  return `${where} was ${renderArgumentValue(value)}, which does not contain "${needle}"`;
}

/**
 * Why the value held something outside the allowed list, or null when every
 * element was allowed.
 *
 * `subsetOf` asks whether every element is allowed, so a value that is not a
 * list has no elements to ask about. Stringifying it and comparing that would
 * answer a different question, and answer it wrong: a comma-joined string
 * would fail as one long value, and an object would be compared as
 * "[object Object]".
 * @param argument - What was at the path.
 * @param allowedValues - The values the case allows.
 */
function subsetFailure(argument: ResolvedArgument, allowedValues: string[]): string | null {
  const { found, value, where } = argument;
  if (!found) {
    return `${where} was missing, so nothing could be compared against the allowed values`;
  }
  if (!Array.isArray(value)) {
    return `${where} was ${renderArgumentValue(value)}, which is not a list, so its values cannot be checked against the allowed ones`;
  }
  const allowed = new Set(allowedValues);
  const strays = value.filter(item => !allowed.has(String(item)));
  if (strays.length === 0) {
    return null;
  }
  return `${where} held ${strays.map(renderArgumentValue).join(', ')}, which ${strays.length === 1 ? 'is' : 'are'} not in the allowed values`;
}

/**
 * Why the value's day fell outside a relative bound, or null when it held.
 *
 * The bound is resolved at `now`, so `today` is the day the run happens. A
 * value that holds no readable date fails rather than passing, because "the
 * agent sent `next Friday`" is a broken argument, not a date in range.
 * @param argument - What was at the path.
 * @param bound - `today`, `3 days ago`, `2026-09-01`, and so on.
 * @param side - Whether the value must be on or after the bound, or on or before it.
 * @param timezone - `utc`, `local`, or an IANA zone, as the manifest wrote it.
 * @param now - The clock the check runs against.
 */
function dayBoundFailure(
  argument: ResolvedArgument,
  bound: string,
  side: 'onOrAfter' | 'onOrBefore',
  timezone: string | undefined,
  now: Date,
): string | null {
  const zone = resolveDayZone(timezone);
  const boundDay = resolveRelativeDay(bound, zone, now);
  const valueDay = argument.found ? calendarDayOf(argument.value, zone) : null;
  if (valueDay === null) {
    return `${argument.where} was ${renderArgumentValue(argument.value)}, which is not a date, so it cannot be ${side === 'onOrAfter' ? 'on or after' : 'on or before'} ${bound}`;
  }
  // Both are `YYYY-MM-DD`, so comparing the text compares the days.
  const holds = side === 'onOrAfter' ? valueDay >= boundDay : valueDay <= boundDay;
  if (holds) {
    return null;
  }
  return `${argument.where} was ${valueDay}, which is ${side === 'onOrAfter' ? 'before' : 'after'} ${bound} (${boundDay} in ${zone})`;
}

/**
 * Decide whether one call's arguments satisfy the case's predicates.
 *
 * Hands back the reason it failed rather than a bare false, so the score row
 * can name which predicate went wrong on which call instead of leaving the
 * reader to guess between four of them. Predicates are tried in a fixed order
 * and the first failure is the one reported.
 * @param call - One tool call the agent made.
 * @param condition - What the case said those arguments must look like.
 * @param now - The clock relative days resolve against.
 */
function argumentsSatisfy(call: ToolCallRecord, condition: ToolArgumentCondition, now: Date): { ok: boolean; reason: string } {
  const { found, value } = resolveArgumentPath(call.input, condition.path);
  const argument: ResolvedArgument = {
    found,
    value,
    where: condition.path ? `${condition.tool}.${condition.path}` : `${condition.tool} arguments`,
  };

  const failure
    = (condition.present !== undefined ? presenceFailure(argument, condition.present) : null)
      ?? (condition.equals !== undefined ? equalsFailure(argument, condition.equals) : null)
      ?? (condition.contains !== undefined ? containsFailure(argument, condition.contains) : null)
      ?? (condition.subsetOf !== undefined ? subsetFailure(argument, condition.subsetOf) : null)
      ?? (condition.onOrAfter !== undefined ? dayBoundFailure(argument, condition.onOrAfter, 'onOrAfter', condition.timezone, now) : null)
      ?? (condition.onOrBefore !== undefined ? dayBoundFailure(argument, condition.onOrBefore, 'onOrBefore', condition.timezone, now) : null);

  return failure === null ? { ok: true, reason: '' } : { ok: false, reason: failure };
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
  const filters = callFilters(condition);
  const subject = filters.length > 0 ? `${condition.tool}[${filters.map(describeCallFilter).join(',')}]` : condition.tool;
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
  if (condition.onOrAfter !== undefined) {
    predicates.push(`onOrAfter=${condition.onOrAfter}`);
  }
  if (condition.onOrBefore !== undefined) {
    predicates.push(`onOrBefore=${condition.onOrBefore}`);
  }
  if (condition.timezone !== undefined) {
    predicates.push(`timezone=${condition.timezone}`);
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
  const filters = callFilters(condition);
  return transcript.toolCalls.filter(call => call.tool === condition.tool && filters.every(filter => callMatchesFilter(call, filter)));
}

/**
 * A condition's `where`, always as a list. One filter or several are both
 * allowed in YAML; every one has to hold for a call to be under test.
 * @param condition - The condition naming the filters, if any.
 */
function callFilters(condition: ToolArgumentCondition): ToolCallFilter[] {
  if (!condition.where) {
    return [];
  }
  return Array.isArray(condition.where) ? condition.where : [condition.where];
}

/**
 * Whether one call passes one `where` filter.
 *
 * `present: false` is what lets a rule step around a legitimate exception:
 * a series refresh keeps its first, possibly past, `startDate` on purpose,
 * and it is the one kind of event proposal that carries a `recurrence`.
 * @param call - One call to the tool.
 * @param filter - A path and either the value it must equal or whether it must hold one.
 */
function callMatchesFilter(call: ToolCallRecord, filter: ToolCallFilter): boolean {
  const { found, value } = resolveArgumentPath(call.input, filter.path);
  if (filter.equals !== undefined && !(found && deepEquals(value, filter.equals))) {
    return false;
  }
  if (filter.present !== undefined && holdsAValue(found, value) !== filter.present) {
    return false;
  }
  return true;
}

/**
 * One filter as text, for a slug and for the sentence a check writes. A
 * lone `equals` filter keeps the `path=value` shape slugs have always had.
 * @param filter - The filter being described.
 */
function describeCallFilter(filter: ToolCallFilter): string {
  const parts: string[] = [];
  if (filter.equals !== undefined) {
    parts.push(`${filter.path}=${renderArgumentValue(filter.equals)}`);
  }
  if (filter.present !== undefined) {
    parts.push(`${filter.path} present=${filter.present}`);
  }
  return parts.join(',');
}

function checkToolCalledWith(transcript: CaseTranscript, condition: ToolArgumentCondition, now: Date): CheckOutcome {
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
    const filters = callFilters(condition);
    const subject = filters.length > 0 ? `${condition.tool} matching ${filters.map(describeCallFilter).join(' and ')}` : condition.tool;
    return {
      slug,
      passed,
      explanation: passed
        ? `No call to ${subject}, which this case allows.`
        : `Never called ${subject}. Tools used: ${describeTrajectory(transcript)}.`,
    };
  }

  const results = calls.map(call => argumentsSatisfy(call, condition, now));
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
 * @param now - The clock relative days like `today` resolve against; the
 *   real one unless a test pins it.
 */
export function runCheck(transcript: CaseTranscript, check: EvalCheck, now: Date = new Date()): CheckOutcome | null {
  if ('toolCalled' in check) {
    return checkToolCalled(transcript, check.toolCalled);
  }
  if ('toolNotCalled' in check) {
    return checkToolNotCalled(transcript, check.toolNotCalled);
  }
  if ('toolCalledWith' in check) {
    return checkToolCalledWith(transcript, check.toolCalledWith, now);
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
 * @param now - The clock relative days resolve against, read once so every
 *   check on the case agrees on what today is.
 */
export function scoreChecks(transcript: CaseTranscript, now: Date = new Date()): ProviderScore[] {
  if (transcript.errored) {
    return [];
  }
  const checks = transcript.item.checks ?? [];
  const scores: ProviderScore[] = [];
  for (const check of checks) {
    const outcome = runCheck(transcript, check, now);
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
