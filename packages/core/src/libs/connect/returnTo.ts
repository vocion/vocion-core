/**
 * Where the connect flow sends a person back to (#1080), and what it
 * pre-fills there. Only `/dashboard` paths are allowed, never `//host`, a
 * scheme or a backslash, so the OAuth callback cannot become an open
 * redirect. The value travels inside the signed state.
 */

import { isInAppPath } from './inAppPath';

const MAX_RETURN_PATH = 500;

/**
 * @param raw - A candidate path from a query string or a state payload.
 * @returns The path when it is a safe in-app dashboard path, else null.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_RETURN_PATH) {
    return null;
  }
  if (!isInAppPath(raw)) {
    return null;
  }
  if (raw !== '/dashboard' && !raw.startsWith('/dashboard/') && !raw.startsWith('/dashboard?')) {
    return null;
  }
  if (raw.includes('\\') || raw.includes('//') || raw.includes('..') || /%2e/i.test(raw) || /\p{Cc}/u.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * The return path without its `add` param, so landing on the Connectors page
 * does not reopen the add dialog for a connector that was added by the login
 * itself (a second click there would make a duplicate source).
 * @param returnTo - A path already checked by `safeReturnPath`, or absent.
 * @returns The path without `add`, or the input unchanged when it has none.
 */
export function withoutAddParam(returnTo: string | null | undefined): string | null | undefined {
  const safe = safeReturnPath(returnTo);
  if (!safe) {
    return returnTo;
  }
  const url = new URL(safe, 'http://relative.invalid');
  url.searchParams.delete('add');
  return `${url.pathname}${url.search}`;
}

/**
 * @param value - A code that came from a query string or a vendor.
 * @returns At most 64 characters of word characters, dots and dashes.
 */
function cleanCode(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 64);
}

/**
 * @param input - What the start route needs to know.
 * @param input.provider - Connect provider id (`slack`, `atlassian`, `github`).
 * @param input.connector - Start from a connector: no source row is needed.
 * @param input.source - Start from a source, when the person is connecting one that exists.
 * @param input.returnTo - Where to land afterwards, already checked by `safeReturnPath`.
 * @param input.conversationId - The chat the login came from, so its card can be marked.
 * @param input.cardId - The chat card the login came from.
 * @returns The start route URL.
 */
export function connectStartHref(input: {
  provider: string;
  connector?: string;
  source?: string;
  returnTo: string | null;
  conversationId?: number;
  cardId?: string;
}): string {
  const parts: string[] = [];
  if (input.connector) {
    parts.push(`connector=${encodeURIComponent(input.connector)}`);
  } else if (input.source) {
    parts.push(`source=${encodeURIComponent(input.source)}`);
  }
  if (input.returnTo) {
    parts.push(`returnTo=${encodeURIComponent(input.returnTo)}`);
  }
  if (input.conversationId !== undefined) {
    parts.push(`conversation=${input.conversationId}`);
  }
  if (input.cardId) {
    parts.push(`card=${encodeURIComponent(input.cardId)}`);
  }
  return `/api/connect/${input.provider}/start?${parts.join('&')}`;
}

const START_HREF = /^\/api\/connect\/([a-z][a-z0-9-]*)\/start(?:\?|$)/;

/**
 * The provider a start URL from `connectStartHref` logs in with. A chat card
 * stores only that URL, so this is how it knows whose login button to draw.
 * Anything that is not a start route, an absolute URL included, names none.
 * @param href - The URL, if there is one.
 * @returns The provider id, or null.
 */
export function providerOfStartHref(href: string | null | undefined): string | null {
  const match = href ? START_HREF.exec(href) : null;
  return match?.[1] ?? null;
}

/** How a connect came back to the conversation that started it. */
export type ConnectReturn = {
  /** True when the login or token landed. */
  ok: boolean;
  /** The connector or source it was for, as a short code. */
  connector: string;
  /** The short refusal code, when it did not. */
  reason?: string;
};

/**
 * How a connect came back, read off the query the callback added — or null
 * when this visit is not a connect return. The conversation reads it to answer
 * the setup Decision that started it (typed: never "I connected github" put in
 * the person's mouth) or to say on that card why it failed. Only short codes
 * get through, the same character rule as `returnUrl`.
 * @param params - The query params the callback added.
 * @param params.connect - `ok` or `error`.
 * @param params.reason - The short refusal code, on error.
 * @param params.source - The source that was being connected, when there was one.
 * @param params.connector - The connector that was being connected, when the login started from it.
 * @returns The outcome, or null.
 */
export function connectReturnOutcome(params: { connect?: string; reason?: string; source?: string; connector?: string }): ConnectReturn | null {
  const name = params.connector ?? params.source;
  if (!name || (params.connect !== 'ok' && params.connect !== 'error')) {
    return null;
  }
  return params.connect === 'ok'
    ? { ok: true, connector: cleanCode(name) }
    : { ok: false, connector: cleanCode(name), reason: params.reason === undefined ? 'no reason given' : cleanCode(params.reason) };
}

/**
 * Where the person lands when the connect is over. Carries only a short code,
 * never anything the vendor sent verbatim.
 * @param origin - The configured public origin; `''` gives a relative URL.
 * @param outcome - `ok`, or the short refusal code.
 * @param where - Where it was about.
 * @param where.source - The source the person was connecting, when there was one.
 * @param where.connector - The connector, when the login started from it.
 * @param where.returnTo - Where the person started, when it passes `safeReturnPath`; else Sources.
 */
export function returnUrl(
  origin: string,
  outcome: { ok: true } | { ok: false; reason: string },
  where: { source?: string; connector?: string; returnTo?: string | null } = {},
): string {
  const base = safeReturnPath(where.returnTo) ?? '/dashboard/sources';
  const url = new URL(`${origin || 'http://relative.invalid'}${base}`);
  url.searchParams.set('connect', outcome.ok ? 'ok' : 'error');
  if (!outcome.ok) {
    url.searchParams.set('reason', cleanCode(outcome.reason));
  }
  if (where.connector) {
    url.searchParams.set('connector', cleanCode(where.connector));
  }
  if (where.source) {
    url.searchParams.set('source', where.source);
  }
  return origin ? url.toString() : `${url.pathname}${url.search}`;
}
