/**
 * Where the connect flow sends a person back to (#1028), and what it
 * pre-fills there. Only `/dashboard` paths are allowed, never `//host`, a
 * scheme or a backslash, so the OAuth callback cannot become an open
 * redirect. The value travels inside the signed state.
 */

const MAX_RETURN_PATH = 500;

/**
 * @param raw - A candidate path from a query string or a state payload.
 * @returns The path when it is a safe in-app dashboard path, else null.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_RETURN_PATH) {
    return null;
  }
  if (raw !== '/dashboard' && !raw.startsWith('/dashboard/') && !raw.startsWith('/dashboard?')) {
    return null;
  }
  if (raw.includes('\\') || raw.includes('//') || raw.includes('..') || /\p{Cc}/u.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * @param provider - Connect provider id (`slack`, `atlassian`, `github`).
 * @param sourceSlug - The source being connected.
 * @param returnTo - Where to land afterwards, already checked by `safeReturnPath`.
 * @returns The start route URL.
 */
export function connectStartHref(provider: string, sourceSlug: string, returnTo: string | null): string {
  const back = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
  return `/api/connect/${provider}/start?source=${encodeURIComponent(sourceSlug)}${back}`;
}

/**
 * The next message pre-filled in chat after a connect: true either way,
 * never "I connected it" when it failed.
 * @param params - The query params the callback added.
 * @param params.connect - `ok` or `error`.
 * @param params.reason - The short refusal code, on error.
 * @param params.source - The source that was being connected.
 * @returns The message, or null when this visit is not a connect return.
 */
export function connectReturnPrompt(params: { connect?: string; reason?: string; source?: string }): string | null {
  if (!params.source) {
    return null;
  }
  if (params.connect === 'ok') {
    return `I connected ${params.source}. What's next?`;
  }
  if (params.connect === 'error') {
    return `Connecting ${params.source} didn't work (${params.reason ?? 'no reason given'}). What should I try?`;
  }
  return null;
}
