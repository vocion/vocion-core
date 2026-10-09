/**
 * What a person is allowed to be shown when a tool fails.
 *
 * A failed step's message is written by whatever threw — a service, a
 * database driver, our own guard clauses — and those write for an operator,
 * not for a reader. The CEO's preview, 2026-09-16, rendered this verbatim:
 *
 *   `Error  agent __search__ not found in org proj-2df61364-…`
 *
 * Two internals in one sentence: a tenant id and a sentinel slug. Neither
 * means anything to the reader, both look like a leak, and the id is the kind
 * of string that gets pasted into a screenshot in a Slack channel.
 *
 * So redaction happens at the RENDER boundary, once, for every tool — not in
 * each thrower, where it would be forgotten by the next one. The raw text is
 * kept and travels in *Copy details*, which is exactly what that control is
 * for: the operator gets the id, the reader does not.
 *
 * Pure: no React, no database, so the rail, the full-page chat and a test can
 * all read the same rule.
 */

/**
 * Tenant-ish identifiers: `proj-…`, `org-…`, `user_…`, `acct-…` and friends.
 * Deliberately narrow — an opaque id with one of these prefixes is never
 * something a person needs to read, while a bare hex string might be
 * (a commit, an order number), so bare ids are left alone.
 */
const TENANT_ID = /\b(?:proj|org|orgs|acct|account|tenant|usr|user|ws|workspace)[-_][A-Z0-9][\w-]{5,}/gi;

/**
 * A configuration identifier — `TAVILY_API_KEY`, `STRIPE_SECRET_KEY`,
 * `VOCION_MAIL_DOMAIN`.
 *
 * SCREAMING_SNAKE_CASE is how this codebase spells an environment variable and
 * essentially nothing else, so it is a reliable tell. Chris, 2026-09-16, on a
 * revenue review screen reading `TAVILY_API_KEY not configured`: *"That belongs
 * in admin observability, logs, or developer tooling. It should never leak into
 * a revenue review UX."* Requires at least one underscore, so a shouted word is
 * left alone.
 */
const CONFIG_KEY = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** A double-underscore sentinel slug — `__search__`, `__default__`. Internal by construction. */
const SENTINEL_SLUG = /__[a-z0-9]+(?:_[a-z0-9]+)*__/gi;

/** What the reader sees instead. */
export const REDACTED_ID = '[id]';
export const REDACTED_SLUG = '[internal]';
export const REDACTED_CONFIG = '[config]';

/**
 * The reader's version of an error message: the sentence, minus the
 * identifiers that are ours rather than theirs.
 * @param text - The raw message, as the tool threw it.
 * @returns The message with tenant ids and sentinel slugs replaced.
 */
export function redactInternalIds(text: string): string {
  return text
    .replace(TENANT_ID, REDACTED_ID)
    .replace(SENTINEL_SLUG, REDACTED_SLUG)
    .replace(CONFIG_KEY, REDACTED_CONFIG)
    // A redaction can leave "in [id]" dangling at the end of a clause; tidy
    // the double spaces it makes rather than shipping ragged copy.
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Whether a message carries anything the reader should not have seen — used
 * to decide whether *Copy details* is worth pointing at.
 * @param text - The raw message.
 */
export function hasInternalIds(text: string): boolean {
  return redactInternalIds(text) !== text.replace(/ {2,}/g, ' ').trim();
}

/**
 * The one sentence an empty workspace is allowed to produce, everywhere —
 * written for the person in it, not for whoever deploys the product. Every
 * workspace is seeded with its first agent — a shared one its lead
 * (`workspaceLead.ts`), a Personal one its person's assistant
 * (`personalAssistant.ts`) — and the chat page seeds it again on every load,
 * so this is the rare case where that failed just now. Calm, and never a
 * link to go hire someone (founder, 2026-10-09).
 */
export const NO_AGENTS_MESSAGE
  = 'Your agent isn\'t ready yet. Try again in a moment.';

/**
 * Is this failure really "the workspace is empty"?
 *
 * The server says `agent __search__ not found in org …` because the everything
 * conversation fell back to the search-only sentinel when the workspace named
 * no lead. That is a STATE, not an error, and it has its own sentence.
 * @param text - The raw failure message.
 */
export function isEmptyWorkspaceFailure(text: string): boolean {
  return /agent\s+__search__\s+not found/i.test(text) || /no agents? (?:are )?(?:configured|available)/i.test(text);
}

/** Everything an operator needs to act on one failed step. */
export type FailureReport = {
  /** The assistant turn's persisted message id, when the row exists yet. */
  turnId?: number | null;
  conversationId?: number | null;
  /** When the turn happened (epoch ms); the copy stamps ISO. */
  at?: number | null;
  /** The tool that failed, raw. */
  tool?: string | null;
  /** What it threw, RAW — ids included. This block is why they are redacted on screen. */
  message?: string | null;
  /** The specialist the failure happened inside, when it was a delegation. */
  delegate?: string | null;
};

/**
 * The plain-text block *Copy details* puts on the clipboard.
 *
 * Six lines, always all six — a missing field says "unknown", because a block
 * that silently omits the conversation id is one the reader cannot tell from
 * a block that had none. Unredacted on purpose: this is the operator's copy.
 * @param report - What we know about the failed step.
 * @returns A pasteable block.
 */
export function failureReport(report: FailureReport): string {
  const unknown = 'unknown';
  const when = typeof report.at === 'number' ? new Date(report.at).toISOString() : unknown;
  return [
    'Vocion tool failure',
    `turn:         ${report.turnId ?? unknown}`,
    `conversation: ${report.conversationId ?? unknown}`,
    `when:         ${when}`,
    `tool:         ${report.tool || unknown}`,
    `delegate:     ${report.delegate || 'none'}`,
    `error:        ${report.message || unknown}`,
  ].join('\n');
}

/**
 * Is this failure really "a provider this deployment never configured"?
 *
 * `ProviderNotConfiguredError` writes for an operator — it names the capability,
 * the provider and the environment variables to set. All three are ours. To the
 * person reviewing a lead it is one fact: that source did not run. Like the
 * empty workspace above, this is a STATE rather than an error, and it gets its
 * own sentence.
 * @param text - The raw failure message.
 */
export function isProviderNotConfiguredFailure(text: string): boolean {
  return /provider\s+"[^"]*"\s+is not configured/i.test(text);
}

/**
 * The reader's sentence for an unconfigured provider. Names the CAPABILITY,
 * because that is the part they can reason about ("web research did not run"),
 * and never the provider or the variable, because those are operations.
 *
 * Deliberately says "for this run": the evidence is thin *today*, which is a
 * retryable condition, not a property of the lead.
 * @param text - The raw failure message, to read the capability out of.
 */
export function providerUnavailableMessage(text: string): string {
  // An index scan rather than a regex: `/^(.+?)\s+provider\s+"/` lets the lazy
  // quantifier exchange characters with the whitespace class, which is
  // super-linear backtracking on a string an outside error message can shape.
  const marker = ' provider "';
  const cut = text.indexOf(marker);
  const capability = cut > 0 ? text.slice(0, cut).trim() : '';
  const what = capability ? capability.toLowerCase() : 'that source';
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} was unavailable for this run.`;
}

/**
 * THE render-boundary function: what a person is shown for any pipeline
 * failure.
 *
 * A known state gets its own sentence; everything else gets the raw message
 * with our identifiers taken out. One call site per surface, so a new thrower
 * cannot leak by being forgotten — which is the whole argument of this module,
 * applied to the surfaces outside chat as well.
 *
 * The raw text is never destroyed; it stays on the row for *Copy details* and
 * for the logs.
 * @param text - The raw failure message.
 * @returns The reader's version.
 */
export function readerFailure(text: string): string {
  if (isProviderNotConfiguredFailure(text)) {
    return providerUnavailableMessage(text);
  }
  if (isEmptyWorkspaceFailure(text)) {
    return NO_AGENTS_MESSAGE;
  }
  return redactInternalIds(text);
}

/**
 * A line of a stack trace, or a bare bundle location: `at u (/app/…/_1x._.js:1:44704)`.
 * Never something a reader should see — it travels in *Copy details* only.
 */
const STACK_FRAME = /^at\s|^\(?[\w.@[\]/-]+\.(?:js|ts|tsx|mjs|cjs):\d+(?::\d+)?\)?$/;

/** A path-and-position fragment inside a sentence: ` (/app/x/chunk.js:1:44704)`. */
const CODE_LOCATION = /\s*(?:\bat\s+)?\(?(?:\/|\.{1,2}\/)[\w.@[\]/-]+\.(?:js|ts|tsx|mjs|cjs):\d+(?::\d+)?\)?/g;

/**
 * A fault in our own code — the runtime's wording for a bug, not a reason a
 * reader can act on. "t is not a function" is a sentence about a minified
 * variable; showing it says nothing and looks like a crash, because it is one.
 */
const CODE_FAULT = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b|\bis not a function\b|\bis not defined\b|\bis not a constructor\b|Cannot read propert(?:y|ies) of (?:undefined|null)/;

/** What a reader sees when the failure is a fault in our code. */
export const CODE_FAULT_SENTENCE = 'Something broke on our side while running this step. Copy details has what to send us.';

/** What a reader sees when the failure came with no message at all. */
export const NO_REASON_SENTENCE = 'This step failed without giving a reason.';

const ONE_LINE_MAX = 160;

/**
 * The one line a person reads about a failed step.
 *
 * A failure message is written for whoever debugs it: a stack trace, a bundle
 * path, a minified name. On 2026-10-08 a calendar read failed and the chat
 * showed `TypeError: t is not a function at u (/app/packages/core/.next/…)`
 * verbatim, twice. The reader's line is `readerFailure` of the first line,
 * without frames or code locations; a fault in our own code becomes one
 * plain sentence. The raw text is untouched and goes in *Copy details*.
 * @param raw - The message as the step reported it.
 * @returns One short, readable line.
 */
export function failureOneLiner(raw: string | null | undefined): string {
  const lines = String(raw ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !STACK_FRAME.test(l) && !/^please fix your mistakes\.?$/i.test(l));
  const first = (lines[0] ?? '').replace(/^(?:Error|Uncaught)\s*:\s*/i, '').trim();
  if (!first) {
    return NO_REASON_SENTENCE;
  }
  if (CODE_FAULT.test(first)) {
    return CODE_FAULT_SENTENCE;
  }
  // The states `readerFailure` already has a sentence for keep that sentence.
  const clean = readerFailure(first.replace(CODE_LOCATION, '')).trim();
  if (!clean) {
    return NO_REASON_SENTENCE;
  }
  return clean.length > ONE_LINE_MAX ? `${clean.slice(0, ONE_LINE_MAX - 1).trimEnd()}…` : clean;
}

/**
 * The headline of a failure: the step's name with "failed" said once.
 *
 * A failed step's label already says it failed ("Checked the calendar —
 * failed"), and the badge used to add its own, which read "— failed failed".
 * A generic name ("Error", "A tool") is no name at all.
 * @param name - The failed step's label, or the tool's name.
 * @returns E.g. `Checked the calendar — failed`, `web_search failed`, `This turn failed`.
 */
export function failureHeadline(name: string | null | undefined): string {
  const n = String(name ?? '').trim();
  if (!n || ['a tool', 'error', 'failed', 'tool'].includes(n.toLowerCase())) {
    return 'This turn failed';
  }
  if (/\b(?:failed|could not \w+|couldn't \w+|did not finish)\.?$/i.test(n)) {
    return n;
  }
  return `${n} failed`;
}
