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
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@/libs/time/zone';

/**
 * What a date bound needs to know about the run, beyond the transcript.
 *
 * `now` is read once per scoring pass so every check on a case agrees on what
 * today is. `workspaceTimeZone` is what `timezone: workspace` means; a caller
 * that has an org resolves it with `workspaceTimeZone(orgId)`, and a caller
 * that does not gets UTC.
 */
export type CheckClock = {
  now: Date;
  workspaceTimeZone: string;
};

/** The real clock and UTC, for a caller with no workspace to ask. */
function defaultClock(): CheckClock {
  return { now: new Date(), workspaceTimeZone: DEFAULT_TIME_ZONE };
}

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

/** The path segment that stands for every item of a list. */
const EVERY_ITEM = '*';

/**
 * One value a path reached, the concrete path that reached it, and which
 * item each `*` stood for on the way — so `timezoneFrom: "*.timezone"` can
 * read the zone of the same record whose `*.startDate` is being judged.
 *
 * `listProblem` is set when a `*` found no items to stand for — an empty
 * list, or something that is not a list at all. It fails the rule whatever
 * the predicate, because `present: false` over no items would otherwise pass.
 */
type ReachedValue = { found: boolean; value: unknown; path: string; itemKeys: string[]; listProblem?: string };

/**
 * Every item a `*` stands for, or one miss saying why there were none.
 *
 * Only a list has items. An object's keys are not records, and an empty list
 * inside another list is a branch with nothing in it, which has to fail on
 * its own rather than vanish while a sibling branch decides the rule.
 * @param from - The value the `*` is applied to.
 */
function everyItemOf(from: ReachedValue): ReachedValue[] {
  const listPath = from.path;
  if (!from.found) {
    return [{ found: false, value: undefined, path: listPath, itemKeys: from.itemKeys, listProblem: 'was missing, so it has no items to check' }];
  }
  if (!Array.isArray(from.value)) {
    return [{ found: false, value: undefined, path: listPath, itemKeys: from.itemKeys, listProblem: 'was not a list' }];
  }
  if (from.value.length === 0) {
    return [{ found: false, value: undefined, path: listPath, itemKeys: from.itemKeys, listProblem: 'reached no items — the list was empty' }];
  }
  const items: ReachedValue[] = [];
  for (const [index, value] of from.value.entries()) {
    const key = String(index);
    items.push({ found: true, value, path: listPath ? `${listPath}.${key}` : key, itemKeys: [...from.itemKeys, key] });
  }
  return items;
}

/**
 * Take one path segment from one value: its child, every item for `*`, or
 * a miss that keeps the path so the failure sentence names it in full.
 * @param from - The value reached so far.
 * @param segment - The next segment of the path.
 */
function stepInto(from: ReachedValue, segment: string): ReachedValue[] {
  if (from.listProblem) {
    return [from];
  }
  if (segment === EVERY_ITEM) {
    return everyItemOf(from);
  }
  const path = from.path ? `${from.path}.${segment}` : segment;
  if (!from.found || from.value === null || typeof from.value !== 'object') {
    return [{ found: false, value: undefined, path, itemKeys: from.itemKeys }];
  }
  const container = from.value as Record<string, unknown>;
  if (!(segment in container)) {
    return [{ found: false, value: undefined, path, itemKeys: from.itemKeys }];
  }
  return [{ found: true, value: container[segment], path, itemKeys: from.itemKeys }];
}

/**
 * Every value a dot path reaches, one per item wherever the path says `*`.
 *
 * `*.id` over a lookup's three records reaches three ids, and a check on it
 * holds only when all three do — "each returned record carries its id" is a
 * rule about every record, not the first. A `*` with no items to stand for
 * reaches one value marked with its `listProblem`, which the caller reports
 * rather than passing.
 * @param root - The arguments, or the parsed return value.
 * @param path - Dot path; omit to reach the root itself.
 */
function reachEveryValue(root: unknown, path: string | undefined): ReachedValue[] {
  let reached: ReachedValue[] = [{ found: true, value: root, path: '', itemKeys: [] }];
  if (!path) {
    return reached;
  }
  for (const segment of path.split('.')) {
    reached = reached.flatMap(from => stepInto(from, segment));
  }
  return reached;
}

/**
 * A tool's return value, parsed when it is JSON.
 *
 * Every return reaches the transcript as text. A tool that hands back data —
 * `lookup_objects` returns a JSON array of records — is parsed so a path can
 * walk into it; one that returns a sentence stays a sentence, which `contains`
 * can still read. Not parsing is an expected answer, not an error, so nothing
 * is logged: the check that needed a field says so in its own explanation.
 * @param output - The text the tool returned.
 */
function parseToolReturn(output: string): { isJson: boolean; value: unknown } {
  try {
    return { isJson: true, value: JSON.parse(output) };
  } catch {
    return { isJson: false, value: output };
  }
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
 * The zone one call's date bounds are judged in.
 *
 * `timezoneFrom` wins when the call itself names a real zone at that path —
 * an event carrying its venue's `timezone` is judged by the venue's clock.
 * When the call names none, or names something that is not a zone, the
 * check's own `timezone` answers instead, so a missing field falls back to a
 * rule someone wrote rather than to a guess.
 * A `*` in `timezoneFrom` stands for the same item as the matching `*` in
 * `path`: with `path: "*.startDate"` and `timezoneFrom: "*.timezone"`, the
 * second record's date is judged by the second record's zone.
 * @param root - What the check reads: the call's arguments, or its parsed return.
 * @param condition - The check naming `timezone` and, optionally, `timezoneFrom`.
 * @param clock - The run's clock, carrying the workspace's zone for `workspace`.
 * @param itemKeys - Which item each `*` in `path` reached, in order.
 */
function zoneForCall(root: unknown, condition: ToolArgumentCondition, clock: CheckClock, itemKeys: string[]): string {
  if (condition.timezoneFrom && root !== null && typeof root === 'object') {
    const zonePath = sameItemPath(condition.timezoneFrom, itemKeys);
    const { found, value } = resolveArgumentPath(root as Record<string, unknown>, zonePath);
    if (found && isValidTimeZone(value)) {
      return value;
    }
  }
  return resolveDayZone(condition.timezone, clock.workspaceTimeZone);
}

/**
 * Why the value's day fell outside a relative bound, or null when it held.
 *
 * The bound is resolved at the run's `now`, so `today` is the day the run
 * happens. A value that holds no readable date fails rather than passing,
 * because "the agent sent `next Friday`" is a broken argument, not a date in
 * range.
 * @param argument - What was at the path.
 * @param bound - `today`, `3 days ago`, `2026-09-01`, and so on.
 * @param side - Whether the value must be on or after the bound, or on or before it.
 * @param zone - The IANA zone this call is judged in, already resolved.
 * @param now - The clock the check runs against.
 */
function dayBoundFailure(
  argument: ResolvedArgument,
  bound: string,
  side: 'onOrAfter' | 'onOrBefore',
  zone: string,
  now: Date,
): string | null {
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
 * A path with each `*` replaced by the item the check is on, in order.
 * @param path - A path that may hold `*` segments.
 * @param itemKeys - The item each `*` in the check's `path` reached.
 */
function sameItemPath(path: string, itemKeys: string[]): string {
  let next = 0;
  return path.split('.').map(segment => segment === EVERY_ITEM ? (itemKeys[next++] ?? segment) : segment).join('.');
}

/** The two checks that read inside a call, and so which side of it they read. */
type ToolConditionCheck = 'toolCalledWith' | 'toolReturned';

/**
 * How a failure sentence names a place in the call.
 * @param tool - The tool's name.
 * @param check - Which side of the call is being read.
 * @param path - The concrete path reached, or empty for the whole thing.
 */
function describeLocation(tool: string, check: ToolConditionCheck, path: string): string {
  if (check === 'toolReturned') {
    return path ? `${tool} returned ${path}` : `${tool}'s return value`;
  }
  return path ? `${tool}.${path}` : `${tool} arguments`;
}

/**
 * The first predicate one value breaks, or null when it keeps them all.
 *
 * Predicates are tried in a fixed order and the first failure is the one
 * reported, so the score row names which predicate went wrong instead of
 * leaving the reader to guess between six of them.
 * @param argument - One value the path reached.
 * @param condition - What the case said it must look like.
 * @param zone - The zone date bounds are judged in.
 * @param now - The run's clock.
 */
function firstFailure(argument: ResolvedArgument, condition: ToolArgumentCondition, zone: string, now: Date): string | null {
  return (condition.present !== undefined ? presenceFailure(argument, condition.present) : null)
    ?? (condition.equals !== undefined ? equalsFailure(argument, condition.equals) : null)
    ?? (condition.contains !== undefined ? containsFailure(argument, condition.contains) : null)
    ?? (condition.subsetOf !== undefined ? subsetFailure(argument, condition.subsetOf) : null)
    ?? (condition.onOrAfter !== undefined ? dayBoundFailure(argument, condition.onOrAfter, 'onOrAfter', zone, now) : null)
    ?? (condition.onOrBefore !== undefined ? dayBoundFailure(argument, condition.onOrBefore, 'onOrBefore', zone, now) : null);
}

/**
 * Decide whether one call satisfies the case's predicates — in its
 * arguments for `toolCalledWith`, in what it returned for `toolReturned`.
 *
 * Hands back the reason it failed rather than a bare false, so the score row
 * can name which predicate went wrong on which call. With a `*` in the path,
 * every item has to hold, and the first one that does not is named by its
 * index.
 * @param call - One tool call the agent made.
 * @param condition - What the case said the call must look like.
 * @param clock - The run's clock and the workspace's zone, for date bounds.
 * @param check - Which side of the call to read.
 */
function callSatisfies(call: ToolCallRecord, condition: ToolArgumentCondition, clock: CheckClock, check: ToolConditionCheck): { ok: boolean; reason: string } {
  let root: unknown = call.input;
  if (check === 'toolReturned') {
    const parsed = parseToolReturn(call.output);
    // A path needs something to walk into. A tool that answered in a
    // sentence — "No records found for this type." — has no fields, and
    // saying so beats reporting every field it lacks as merely missing.
    if (!parsed.isJson && condition.path) {
      const preview = call.output.length > 80 ? `${call.output.slice(0, 80)}…` : call.output;
      return { ok: false, reason: `${condition.tool} returned text rather than JSON, so ${condition.path} cannot be read from it ("${preview}")` };
    }
    root = parsed.value;
  }

  const reached = reachEveryValue(root, condition.path);
  const noItems = reached.find(item => item.listProblem !== undefined);
  if (noItems) {
    return { ok: false, reason: `${describeLocation(condition.tool, check, noItems.path)} ${noItems.listProblem}` };
  }
  for (const { found, value, path, itemKeys } of reached) {
    const zone = zoneForCall(root, condition, clock, itemKeys);
    const failure = firstFailure({ found, value, where: describeLocation(condition.tool, check, path) }, condition, zone, clock.now);
    if (failure !== null) {
      return { ok: false, reason: failure };
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
  // `timezone` and `timezoneFrom` stay out of the name on purpose. They say
  // how a date rule is judged, not what it asserts, and a slug is the key a
  // check's history hangs on: correcting a zone should not start the rule's
  // trend line over as if it were a new check.
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

/**
 * Run a `toolCalledWith` or `toolReturned` check over every call it is about.
 * @param transcript - What the case did.
 * @param condition - The tool, the calls, and what they must look like.
 * @param clock - The run's clock and the workspace's zone.
 * @param check - Which side of each call to read; also the slug's prefix.
 */
function checkToolCalls(transcript: CaseTranscript, condition: ToolArgumentCondition, clock: CheckClock, check: ToolConditionCheck): CheckOutcome {
  const slug = `check:${check}:${describeArgumentCondition(condition)}`;
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

  const results = calls.map(call => callSatisfies(call, condition, clock, check));
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
 * @param clock - When the check runs and the workspace's zone; the real
 *   clock and UTC unless the caller knows better or a test pins them.
 */
export function runCheck(transcript: CaseTranscript, check: EvalCheck, clock: CheckClock = defaultClock()): CheckOutcome | null {
  if ('toolCalled' in check) {
    return checkToolCalled(transcript, check.toolCalled);
  }
  if ('toolNotCalled' in check) {
    return checkToolNotCalled(transcript, check.toolNotCalled);
  }
  if ('toolCalledWith' in check) {
    return checkToolCalls(transcript, check.toolCalledWith, clock, 'toolCalledWith');
  }
  if ('toolReturned' in check) {
    return checkToolCalls(transcript, check.toolReturned, clock, 'toolReturned');
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
 * @param clock - When the check runs and the workspace's zone, read once so
 *   every check on the case agrees on what today is.
 */
export function scoreChecks(transcript: CaseTranscript, clock: CheckClock = defaultClock()): ProviderScore[] {
  if (transcript.errored) {
    return [];
  }
  const checks = transcript.item.checks ?? [];
  const scores: ProviderScore[] = [];
  for (const check of checks) {
    const outcome = runCheck(transcript, check, clock);
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
