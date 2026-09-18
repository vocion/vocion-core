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

/** The one sentence an empty workspace is allowed to produce, everywhere. */
export const NO_AGENTS_MESSAGE
  = 'This workspace has no agents yet. Apply a workspace or add one under Manage → Teams & agents.';

/** Where that sentence sends the person. */
export const NO_AGENTS_HREF = '/dashboard/agents';

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
