/**
 * One more try, but only when trying again could plausibly work (#114).
 *
 * A chat turn dies for two very different reasons. Either the connection to
 * the model broke — a reset socket, a rate limit, a provider that was down
 * for four seconds — and the same request sent again a moment later succeeds.
 * Or the request itself was refused: a prompt over the context window, a bad
 * key, a malformed tool schema, this agent's own budget cap. The second kind
 * fails identically every time, so a retry buys nothing and costs the person
 * another wait and the workspace another bill.
 *
 * The rules below are an ALLOWLIST. A failure nobody here recognises is NOT
 * retried, which is the safe direction to be wrong in: an unrecognised
 * permanent error retried forever is a doubled bill on every broken turn,
 * while an unrecognised transient one just surfaces the way it does today —
 * as a turn marked incomplete, with a Retry button under it.
 *
 * Retrying is only safe on top of this when nothing has happened yet that
 * running again would repeat — the caller owns that half of the decision
 * (see the SSE route: a turn that has already started a tool is never
 * retried, because no tool here declares whether it writes anything).
 */

/** How many times one chat turn may run, first attempt included. */
export const MAX_TURN_ATTEMPTS = 2;

/** How long to wait before the second attempt. Long enough for a blip to pass, short enough that the person doesn't think we hung. */
export const RETRY_DELAY_MS = 750;

/**
 * HTTP statuses that mean "this was fine, come back in a second".
 *
 * 529 is Anthropic's `overloaded_error`, which is not a standard status but
 * is exactly what it says: their capacity, not our request.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Phrases that name a broken connection or a busy provider.
 *
 * Matched against the lower-cased message because most of these arrive as an
 * `Error` with no status at all: a socket that died mid-stream is a Node
 * system error, and LangChain wraps provider errors into messages of their
 * own. Every entry names a fault of the transport or the provider's capacity
 * — never anything about what was asked.
 */
const RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /econnreset|econnaborted|econnrefused|etimedout|epipe|eai_again/,
  /socket hang up|premature close|connection (?:reset|closed|error)/,
  /fetch failed|network error|terminated|stream (?:ended|closed) unexpectedly/,
  /timed out|timeout/,
  /rate[ _-]?limit|too many requests/,
  /overloaded|capacity|service unavailable|bad gateway|gateway timeout|internal server error/,
];

/**
 * Pull an HTTP status off whatever shape the provider threw.
 *
 * The SDKs disagree: the OpenAI and Anthropic clients put `status` on the
 * error, Bedrock hides it under `$metadata.httpStatusCode`, and a plain
 * `fetch` wrapper tends to carry `response.status`. Read all of them rather
 * than guess which provider is live.
 * @param error - Whatever was thrown.
 * @returns The status, or null when the error carries none.
 */
export function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const e = error as Record<string, unknown> & {
    response?: { status?: unknown };
    $metadata?: { httpStatusCode?: unknown };
  };
  const candidates = [e.status, e.statusCode, e.response?.status, e.$metadata?.httpStatusCode];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Would running this turn again plausibly get a different answer?
 * @param error - Whatever the run threw.
 * @returns True when the failure is the connection's or the provider's fault, false for everything else.
 */
export function isTransientRunFailure(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null) {
    // A status is the provider speaking plainly; believe it, and don't go
    // pattern-matching the message of a 400 that happens to say "timeout".
    return RETRYABLE_STATUSES.has(status);
  }
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (message.length === 0) {
    return false;
  }
  return RETRYABLE_MESSAGE_PATTERNS.some(pattern => pattern.test(message));
}
