/**
 * How a connect attempt reads to a person, with its date (#1080).
 *
 * Kept apart from `attempts.ts` on purpose: the chat card and the Connectors
 * form render this wording in the browser, and they cannot import a module
 * that reaches the database. Nothing here is server-only.
 */

const TOKEN_STEP_PREFIX = 'token_step_failed:';

/**
 * The reason part of a failed attempt in plain words, e.g. "GitHub denied
 * access". Reason codes are the ones the OAuth callback emits; an unknown code
 * is shown in brackets so a new refusal is never hidden behind a vague line.
 * @param providerLabel - The provider's display name, e.g. "GitHub".
 * @param reason - The stored reason code, or null when none was recorded.
 */
export function connectFailureSummary(providerLabel: string, reason: string | null): string {
  if (!reason) {
    return `${providerLabel} refused the login`;
  }
  if (reason.startsWith(TOKEN_STEP_PREFIX)) {
    return `${providerLabel} logged in, but ${reason.slice(TOKEN_STEP_PREFIX.length)} is still missing`;
  }
  switch (reason) {
    case 'access_denied':
      return `${providerLabel} denied access`;
    case 'cancelled':
      return `The ${providerLabel} login was cancelled`;
    case 'state_expired':
      return 'The login took longer than 10 minutes';
    case 'not_admin':
      return `Only a workspace admin can connect ${providerLabel}`;
    case 'wrong_person':
    case 'wrong_workspace':
      return 'The login was started by someone else or in another workspace';
    case 'provider_unreachable':
      return `${providerLabel} could not be reached, so nothing was connected`;
    case 'store_failed':
      return `${providerLabel} logged in, but the credential couldn't be saved`;
    default:
      return `${providerLabel} refused the login (${reason})`;
  }
}

/**
 * A failed attempt with its date: "Last attempt Oct 1, 4:12 PM: GitHub denied
 * access". The date is always stated; a bare time of day is how a stale
 * failure gets read as today's. Formatted in the given IANA zone (default
 * UTC) so the server and the browser agree.
 * @param attempt - When it happened (a Date, or the ISO string a card run stores) and its worded summary.
 * @param attempt.at
 * @param attempt.summary
 * @param timeZone - IANA zone to format in.
 */
export function describeLastAttempt(attempt: { at: Date | string; summary: string }, timeZone = 'UTC'): string {
  const when = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(attempt.at));
  return `Last attempt ${when}: ${attempt.summary}`;
}
