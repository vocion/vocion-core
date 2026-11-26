/**
 * Anonymous reads of a Zendesk Help Center's public articles.
 *
 * Separate from `client.ts` on purpose. That client mints an OAuth token and
 * sends it; this one must never send any credential. Public articles answer
 * anonymous GETs (developer.zendesk.com/api-reference/help_center/help-center-api/articles/).
 * Zendesk does document an `hc:read` OAuth scope
 * (developer.zendesk.com/api-reference/ticketing/oauth/grant_type_tokens/), so
 * the reason for staying anonymous is not that a token could not read: the
 * Help Center tools are built as anonymous reads; a token here would be sent to whatever host
 * the source's `helpCenter.host` names (custom domains are allowed), which is
 * a credential going to a host the workspace configures; and a token would
 * make drafts and sign-in-only articles visible to the agent. The only
 * request header is `Accept`.
 *
 * Every request:
 *   - has a 10-second limit, covering the headers and the body;
 *   - is tried once more after a timeout, a 5xx or a 429 (a 429 whose
 *     `Retry-After` is over `MAX_RETRY_WAIT_MS` is not retried at all and fails
 *     at once, saying how long Zendesk asked to wait), and then fails with a
 *     typed error, never an empty or invented article;
 *   - refuses redirects, so a 3xx can never move the call to another host;
 *   - reads at most `MAX_RESPONSE_BYTES` of the answer, so a huge or endless
 *     body is abandoned instead of buffered;
 *   - goes only to public addresses, checked twice: up front per call
 *     (`resolvesPublicly`, for a clear error, limited to the same 10 seconds),
 *     and again on the connection itself (`publicOnlyFetch`), whose own DNS lookup refuses a private
 *     address, so a name that flips to one between the check and the connect
 *     is never dialed.
 *
 * Endpoints (path under the origin):
 *   GET /api/v2/help_center/{locale}/articles?per_page=100&page=N
 *   GET /api/v2/help_center/{locale}/articles/{id}
 */

import type { HelpCenterTarget } from './helpCenterSettings';
import { MAX_RETRY_AFTER_MS, retryAfterMs } from '@/libs/http/retryAfter';
import { PublicFetchError, readCapped } from '@/libs/net/publicFetch';
import { publicOnlyFetch } from '@/libs/net/publicOnlyFetch';
import { resolvesPublicly } from '@/libs/net/publicUrl';
import { adminFixNote } from './helpCenterSettings';

/** The most pages the list walk reads: 10 pages of 100 is 1,000 articles. */
export const MAX_LIST_PAGES = 10;
/** Articles asked for per page, Zendesk's maximum. */
const ARTICLES_PER_PAGE = 100;
/** One attempt's limit. */
const DEFAULT_TIMEOUT_MS = 10_000;
/**
 * The most bytes read from one answer: a list page of 100 articles fits when
 * the articles average roughly 35 KB of HTML each (JSON escaping of quotes and
 * newlines makes the page somewhat larger than the raw HTML, by an amount that
 * depends on the HTML), and the 10-page walk holds at most 40 MB.
 */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** The longest `Retry-After` waited out before the one retry. */
const MAX_RETRY_WAIT_MS = 5000;
/** The wait before the retry when a 429 names none. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 1000;
/** The wait before the retry after a timeout or a 5xx. */
const SERVER_RETRY_WAIT_MS = 500;
/**
 * The most digits of an article id. Ids are read back as JavaScript numbers,
 * which hold integers exactly only up to 2^53 (16 digits, not all of them), so
 * 15 digits is the longest id that is always exact.
 */
export const MAX_ARTICLE_ID_DIGITS = 15;
/** Article ids are positive integers; this also keeps a path piece out of the URL. */
const ARTICLE_ID_PATTERN = new RegExp(`^\\d{1,${MAX_ARTICLE_ID_DIGITS}}$`);

/** What went wrong, in words a tool can pass to a model. */
export type HelpCenterErrorCode
  = | 'help_center_timeout'
    | 'help_center_rate_limited'
    | 'help_center_server_error'
    | 'help_center_not_public'
    | 'help_center_redirected'
    | 'help_center_unreachable'
    | 'help_center_bad_response'
    | 'help_center_blocked_host'
    | 'help_center_http_error'
    | 'help_center_too_large'
    | 'help_center_bad_article_id';

export type HelpCenterFailure = {
  ok: false;
  error: HelpCenterErrorCode;
  message: string;
  /** The HTTP status when Zendesk answered, else absent. */
  status?: number;
};

/** The network, the wait and the host check, injected in tests. */
export type HelpCenterDeps = {
  /** Defaults to `publicOnlyFetch`, which dials only vetted public addresses. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to `resolvesPublicly`. */
  checkHost?: (origin: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** One attempt's limit, and the limit on the host check. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Defaults to `MAX_RESPONSE_BYTES`. */
  maxResponseBytes?: number;
};

/** The fields of an article the tools use. Zendesk sends more; the rest is ignored. */
export type HelpCenterArticle = {
  id: number;
  title: string;
  /** HTML, or null for an article with no body. */
  body: string | null;
  html_url: string | null;
  updated_at: string | null;
};

export type HelpCenterListResult
  = | { ok: true; articles: HelpCenterArticle[]; truncated: boolean; totalCount: number | null }
    | HelpCenterFailure;

export type HelpCenterReadResult
  = | { id: string; status: 'found'; article: HelpCenterArticle }
    | { id: string; status: 'not_found' }
    | { id: string; status: 'error'; failure: HelpCenterFailure };

/** One try: the answer, a 404, or a failure that may be worth one more try. */
type Attempt
  = | { kind: 'ok'; body: Record<string, unknown> }
    | { kind: 'not_found' }
    | { kind: 'failure'; failure: HelpCenterFailure; retryable: boolean; waitMs: number };

/**
 * Wait, in real time.
 * @param ms - Milliseconds.
 */
function realSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** What `raceAgainstTimer` answers when the timer wins. */
const TIMED_OUT = Symbol('timed_out');

/**
 * Starts the timer behind `raceAgainstTimer` and stores its handle, so the
 * caller can clear it. A module-level function so the `Promise` executor is a
 * one-line arrow.
 * @param slot - Receives the timer handle.
 * @param slot.timer - The handle, set here.
 * @param timeoutMs - The delay.
 * @param resolve - Called with `TIMED_OUT` when the delay passes.
 */
function armExpiryTimer(slot: { timer?: ReturnType<typeof setTimeout> }, timeoutMs: number, resolve: (value: typeof TIMED_OUT) => void): void {
  slot.timer = setTimeout(resolve, timeoutMs, TIMED_OUT);
}

/**
 * Waits for `work`, but no longer than `timeoutMs`. Used for the up-front host
 * check, whose DNS lookup has no timeout of its own and sits outside the
 * request's abort controller. The timer is always cleared.
 * @param work - The promise to wait for.
 * @param timeoutMs - The longest wait.
 */
async function raceAgainstTimer<T>(work: Promise<T>, timeoutMs: number): Promise<T | typeof TIMED_OUT> {
  const slot: { timer?: ReturnType<typeof setTimeout> } = {};
  const expiry = new Promise<typeof TIMED_OUT>(resolve => armExpiryTimer(slot, timeoutMs, resolve));
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(slot.timer);
  }
}

/**
 * Build a retryable or final failure for one attempt.
 * @param error - The typed code.
 * @param message - What to tell the model.
 * @param retryable - Whether the one retry applies.
 * @param waitMs - How long to wait before the retry.
 * @param status - The HTTP status, when there was one.
 */
function failedAttempt(error: HelpCenterErrorCode, message: string, retryable: boolean, waitMs: number, status?: number): Attempt {
  return { kind: 'failure', failure: { ok: false, error, message, ...(status === undefined ? {} : { status }) }, retryable, waitMs };
}

/**
 * Turn an answered request into an attempt result.
 * @param response - The response (status and headers).
 * @param bodyText - The body, already read within the time limit.
 */
function judgeResponse(response: Response, bodyText: string): Attempt {
  const { status } = response;
  if (status === 404) {
    return { kind: 'not_found' };
  }
  if (status === 429) {
    const asked = retryAfterMs(response.headers) ?? DEFAULT_RATE_LIMIT_WAIT_MS;
    if (asked > MAX_RETRY_WAIT_MS) {
      // Waiting that long would park the tool, and retrying early only extends the penalty.
      const askedText = asked >= MAX_RETRY_AFTER_MS ? `at least ${asked / 1000} seconds` : `${Math.ceil(asked / 1000)} seconds`;
      return failedAttempt('help_center_rate_limited', `Zendesk answered 429 and asked to wait ${askedText}, longer than this tool waits (${MAX_RETRY_WAIT_MS / 1000} seconds), so it did not retry. Try again later.`, false, 0, status);
    }
    return failedAttempt('help_center_rate_limited', 'Zendesk answered 429: the Help Center is rate limiting this server. Try again later.', true, asked, status);
  }
  if (status >= 500) {
    return failedAttempt('help_center_server_error', `Zendesk answered ${status}: the Help Center is having trouble. Try again later.`, true, SERVER_RETRY_WAIT_MS, status);
  }
  if (status >= 300 && status < 400) {
    return failedAttempt('help_center_redirected', `The Help Center answered ${status}, a redirect, which is not followed. ${adminFixNote(['helpCenter.host'])}`, false, 0, status);
  }
  if (status === 401 || status === 403) {
    return failedAttempt('help_center_not_public', `The Help Center answered ${status}: its articles are not public, and these tools read anonymously. Say so rather than guessing.`, false, 0, status);
  }
  if (status < 200 || status >= 300) {
    return failedAttempt('help_center_http_error', `The Help Center answered ${status}. ${adminFixNote(['helpCenter.host'])}`, false, 0, status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return failedAttempt('help_center_bad_response', `The Help Center answered 200 with something that is not JSON. ${adminFixNote(['helpCenter.host'])}`, false, 0, status);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failedAttempt('help_center_bad_response', `The Help Center answered 200 with JSON that is not an object. ${adminFixNote(['helpCenter.host'])}`, false, 0, status);
  }
  return { kind: 'ok', body: parsed as Record<string, unknown> };
}

/**
 * The answer's body as text, read up to the byte cap. A response with no body
 * (a bare 404) reads as empty.
 * @param response - The response.
 * @param maxBytes - The cap.
 * @throws {PublicFetchError} With code `too_large` past the cap.
 */
async function readBodyText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    return '';
  }
  const bytes = await readCapped(response, maxBytes);
  return bytes.toString('utf8');
}

/** The model-facing refusal when the host is not a public address (a private address, a name that does not resolve, a shape the check refuses), on both the up-front and the connect-time check. It is fixed text: the resolved address would be relayed to a user. */
const BLOCKED_HOST_MESSAGE = 'The Help Center host is not called: it does not resolve to a public address.';

/** What the model is told to do when one answer is over the byte cap: a list page holds 100 articles, so it cannot be told to shorten one article. */
const LIST_TOO_LARGE_NEXT_STEP = 'The list of articles is too big to read in one page and will not shrink on a retry. Say the list could not be read, and ask the user for the number of the article they want (it is in the article\'s web address) so it can be read directly with zendesk_get_help_center_articles.';

/**
 * What the model is told to do when one article is over the byte cap.
 * @param articleId - The article that was too big.
 */
function articleTooLargeNextStep(articleId: string): string {
  return `Article ${articleId} is too big to read and will not shrink on a retry. Say it could not be read, and ask whoever runs the Help Center to shorten it.`;
}

/**
 * One anonymous GET with the time limit covering headers and body. The
 * request is aborted whenever the attempt ends before the body was fully read
 * (too large, a timeout, any error): `readCapped` refuses an oversized
 * `Content-Length` without touching the body, which would otherwise leave the
 * connection open while the server keeps sending.
 * @param url - The full URL.
 * @param deps - Injected network and limit.
 * @param tooLargeNextStep - What the model is told to do when the answer is over the byte cap.
 */
async function attemptOnce(url: string, deps: HelpCenterDeps, tooLargeNextStep: string): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = deps.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  let bodyFullyRead = false;
  try {
    const sendRequest = deps.fetch ?? publicOnlyFetch;
    // No Authorization, no cookies: `Accept` is the only header.
    const response = await sendRequest(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal: controller.signal });
    const bodyText = await readBodyText(response, maxBytes);
    bodyFullyRead = true;
    return judgeResponse(response, bodyText);
  } catch (err) {
    if (err instanceof PublicFetchError && err.code === 'too_large') {
      return failedAttempt('help_center_too_large', `The Help Center's answer is over the ${Math.round(maxBytes / 1024)} KB limit. ${tooLargeNextStep} Do not guess at what it held.`, false, 0);
    }
    if (err instanceof PublicFetchError && err.code === 'blocked') {
      // The connect-time DNS check refused the host (a public name now pointing at a private address). The resolved address stays out of the model-facing text, and retrying cannot help.
      return failedAttempt('help_center_blocked_host', `${BLOCKED_HOST_MESSAGE} ${adminFixNote(['helpCenter.host'])}`, false, 0);
    }
    if (controller.signal.aborted) {
      return failedAttempt('help_center_timeout', 'The Help Center did not answer within 10 seconds, even after one retry. Try again later; say it could not be read rather than guessing.', true, SERVER_RETRY_WAIT_MS);
    }
    const rawReason = err instanceof Error ? err.message : String(err);
    const reason = rawReason.endsWith('.') ? rawReason : `${rawReason}.`;
    return failedAttempt('help_center_unreachable', `The Help Center could not be reached: ${reason} Try again later; say it could not be read rather than guessing.`, false, 0);
  } finally {
    clearTimeout(timer);
    if (!bodyFullyRead) {
      // Closes the connection, so the server stops sending a body nobody reads.
      controller.abort();
    }
  }
}

/**
 * A GET that is tried once more after a timeout, a 5xx or a 429.
 * @param url - The full URL.
 * @param deps - Injected network, wait and limit.
 * @param tooLargeNextStep - What the model is told to do when the answer is over the byte cap.
 */
async function getWithOneRetry(url: string, deps: HelpCenterDeps, tooLargeNextStep: string): Promise<Attempt> {
  const first = await attemptOnce(url, deps, tooLargeNextStep);
  if (first.kind !== 'failure' || !first.retryable) {
    return first;
  }
  await (deps.sleep ?? realSleep)(first.waitMs);
  return attemptOnce(url, deps, tooLargeNextStep);
}

/**
 * Whether the origin may be called: it must resolve to public addresses only.
 * @param origin - `https://host`.
 * @param deps - Injected host check.
 */
async function hostFailure(origin: string, deps: HelpCenterDeps): Promise<HelpCenterFailure | null> {
  const check = deps.checkHost ?? resolvesPublicly;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const verdict = await raceAgainstTimer(check(origin), timeoutMs);
  if (verdict === TIMED_OUT) {
    // The lookup itself cannot be cancelled, so it finishes unseen in the background.
    return { ok: false, error: 'help_center_timeout', message: `The Help Center host did not resolve within ${Math.round(timeoutMs / 1000)} seconds, so nothing was requested. Try again later; say it could not be read rather than guessing.` };
  }
  return verdict.ok ? null : { ok: false, error: 'help_center_blocked_host', message: `${BLOCKED_HOST_MESSAGE} ${adminFixNote(['helpCenter.host'])}` };
}

/**
 * One article from Zendesk's JSON, or null when the fields the tools depend
 * on (a numeric id and a string title) are not there.
 * @param raw - One entry from Zendesk.
 */
function articleFrom(raw: unknown): HelpCenterArticle | null {
  const entry = raw as Record<string, unknown> | null;
  if (typeof entry !== 'object' || entry === null || typeof entry.id !== 'number' || typeof entry.title !== 'string') {
    return null;
  }
  return {
    id: entry.id,
    title: entry.title,
    body: typeof entry.body === 'string' ? entry.body : null,
    html_url: typeof entry.html_url === 'string' ? entry.html_url : null,
    updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : null,
  };
}

/**
 * Every public article of one locale: pages of 100, walked in order up to
 * `MAX_LIST_PAGES`. The list endpoint returns each article's body, so a
 * snippet costs no extra call. A page that fails after its retry fails the
 * whole walk, because a list missing some articles would read as complete.
 * `truncated` is true when the last page read still had a next page.
 * @param target - Origin and locale.
 * @param deps - Injected network, wait, host check and limit.
 */
export async function listHelpCenterArticles(target: HelpCenterTarget, deps: HelpCenterDeps = {}): Promise<HelpCenterListResult> {
  const blocked = await hostFailure(target.origin, deps);
  if (blocked) {
    return blocked;
  }
  const articles: HelpCenterArticle[] = [];
  let totalCount: number | null = null;
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const url = `${target.origin}/api/v2/help_center/${target.locale}/articles?per_page=${ARTICLES_PER_PAGE}&page=${page}`;
    const attempt = await getWithOneRetry(url, deps, LIST_TOO_LARGE_NEXT_STEP);
    if (attempt.kind === 'not_found') {
      return { ok: false, error: 'help_center_http_error', message: `The Help Center has no articles endpoint for locale ${target.locale} (404). ${adminFixNote(['helpCenter.locale'])}`, status: 404 };
    }
    if (attempt.kind === 'failure') {
      return attempt.failure;
    }
    const entries = attempt.body.articles;
    if (!Array.isArray(entries)) {
      return { ok: false, error: 'help_center_bad_response', message: `The Help Center answered without an articles list. ${adminFixNote(['helpCenter.host'])}` };
    }
    for (const entry of entries) {
      const article = articleFrom(entry);
      if (article === null) {
        return { ok: false, error: 'help_center_bad_response', message: `The Help Center sent an article without a numeric id and a title. ${adminFixNote(['helpCenter.host'])}` };
      }
      articles.push(article);
    }
    if (typeof attempt.body.count === 'number') {
      totalCount = attempt.body.count;
    }
    const hasNextPage = typeof attempt.body.next_page === 'string' && attempt.body.next_page !== '' && entries.length > 0;
    if (!hasNextPage) {
      return { ok: true, articles, truncated: false, totalCount };
    }
  }
  return { ok: true, articles, truncated: true, totalCount };
}

/**
 * One article by id. A 404 is `not_found`, not an error, so a bad id does not
 * hide the other articles read with it.
 * @param target - Origin and locale.
 * @param articleId - Digits only.
 * @param deps - Injected network, wait and limit (the host is checked by the caller).
 */
async function readOneArticle(target: HelpCenterTarget, articleId: string, deps: HelpCenterDeps): Promise<HelpCenterReadResult> {
  if (!ARTICLE_ID_PATTERN.test(articleId)) {
    return { id: articleId, status: 'error', failure: { ok: false, error: 'help_center_bad_article_id', message: `An article id is a number of up to ${MAX_ARTICLE_ID_DIGITS} digits. Take the id from zendesk_list_help_center_articles and pass only the digits.` } };
  }
  const attempt = await getWithOneRetry(`${target.origin}/api/v2/help_center/${target.locale}/articles/${articleId}`, deps, articleTooLargeNextStep(articleId));
  if (attempt.kind === 'not_found') {
    return { id: articleId, status: 'not_found' };
  }
  if (attempt.kind === 'failure') {
    return { id: articleId, status: 'error', failure: attempt.failure };
  }
  const article = articleFrom(attempt.body.article);
  if (article === null) {
    return { id: articleId, status: 'error', failure: { ok: false, error: 'help_center_bad_response', message: `The Help Center answered without an article. ${adminFixNote(['helpCenter.host'])}` } };
  }
  return { id: articleId, status: 'found', article };
}

/**
 * Several articles, fetched in parallel. A failure of the host check is
 * returned whole; after that each id has its own outcome.
 * @param target - Origin and locale.
 * @param articleIds - Digit strings, at most a handful.
 * @param deps - Injected network, wait, host check and limit.
 */
export async function readHelpCenterArticles(target: HelpCenterTarget, articleIds: readonly string[], deps: HelpCenterDeps = {}): Promise<HelpCenterReadResult[] | HelpCenterFailure> {
  const blocked = await hostFailure(target.origin, deps);
  if (blocked) {
    return blocked;
  }
  return Promise.all(articleIds.map(articleId => readOneArticle(target, articleId, deps)));
}
