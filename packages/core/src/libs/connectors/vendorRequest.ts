/**
 * One request to a vendor's API, its failure shaped as a sentence — for the
 * support, engineering, docs and files connectors (`vendorHttp.ts` is the
 * finance and people families' throw-on-failure twin).
 *
 * The prebuilt connectors (help desks, Linear, GitLab, PagerDuty, Confluence,
 * Dropbox, Box) all needed the same four things from an outbound call: honour
 * a 429's Retry-After instead of hammering (`fetchRetryingRateLimits`), give
 * up after a timeout, read the vendor's own reason off an error body, and turn
 * a 401/403/404/429/5xx into something a person can act on. Writing that once
 * here keeps each vendor client down to its paths and shapes.
 *
 * Errors are DATA, never throws, as the Sentry and PostHog clients have it: a
 * Test connection puts the message on its checklist, a tool hands it to the
 * model, and a sync throws it (`orThrow`) so the run fails with that sentence.
 * Nothing here logs a header, so no credential reaches a log line.
 */

import { Buffer } from 'node:buffer';
import { fetchRetryingRateLimits } from '@/libs/http/retryAfter';

export type VendorFailureKind = 'unauthorized' | 'not_found' | 'rate_limited' | 'unreachable' | 'vendor_error';

export type VendorFailure = { ok: false; kind: VendorFailureKind; status: number | null; message: string };

export type VendorResult<T> = { ok: true; data: T; status: number; headers: Headers } | VendorFailure;

export type VendorRequest = {
  /** The vendor's name, as a person knows it: "Zendesk". */
  vendor: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** A JSON body (serialized here), or a body already in its wire form. */
  json?: unknown;
  body?: BodyInit;
  /** How to read a 2xx: parsed JSON (default), text, or the raw bytes. */
  read?: 'json' | 'text' | 'bytes';
  timeoutMs?: number;
  /** What to do about a 401/403, appended to the refusal: "Paste a fresh API token on the Connectors page." */
  authHint?: string;
  /** How many 429s to ride out before handing the last one back. */
  maxRetries?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const SAID_MAX = 200;

/**
 * The vendor's own reason, out of an error body: the common JSON fields
 * (`message`, `error`, `description`, `errors[0].message`), else the text cut
 * short. Never the request, which can carry a credential.
 * @param text - The error response body.
 */
export function vendorReason(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const body = JSON.parse(trimmed) as Record<string, unknown>;
    const errors = Array.isArray(body.errors) ? body.errors as Array<Record<string, unknown> | string> : [];
    const first = errors[0];
    const candidates = [
      body.message,
      body.error_description,
      typeof body.error === 'string' ? body.error : (body.error as Record<string, unknown> | undefined)?.message,
      body.description,
      body.detail,
      typeof first === 'string' ? first : first?.message ?? first?.detail,
    ];
    const said = candidates.find(c => typeof c === 'string' && c.trim());
    if (typeof said === 'string') {
      return said.replace(/\s+/g, ' ').slice(0, SAID_MAX);
    }
  } catch {
    // Not JSON: the text itself, cut short, is the reason.
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, SAID_MAX);
}

/**
 * Basic auth, for the vendors that take a pair (Zendesk's email/token,
 * Freshdesk's key and an X, Confluence's email and API token).
 * @param user - The user half.
 * @param password - The password half.
 */
export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/**
 * Send one request and shape what comes back.
 * @param req - The request.
 */
export async function vendorRequest<T = unknown>(req: VendorRequest): Promise<VendorResult<T>> {
  const headers: Record<string, string> = { 'accept': 'application/json', 'user-agent': 'vocion', ...req.headers };
  let body = req.body;
  if (req.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.json);
  }
  let res: Response;
  try {
    res = await fetchRetryingRateLimits(req.url, {
      method: req.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    }, { maxRetries: req.maxRetries ?? 4 });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const said = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: 'unreachable', status: null, message: name === 'TimeoutError' ? `${req.vendor} did not answer in time.` : `${req.vendor} did not answer: ${said.slice(0, 160)}` };
  }
  if (res.ok) {
    if (req.read === 'bytes') {
      return { ok: true, data: Buffer.from(await res.arrayBuffer()) as T, status: res.status, headers: res.headers };
    }
    const text = await res.text().catch(() => '');
    if (req.read === 'text') {
      return { ok: true, data: text as T, status: res.status, headers: res.headers };
    }
    try {
      return { ok: true, data: (text ? JSON.parse(text) : null) as T, status: res.status, headers: res.headers };
    } catch {
      return { ok: false, kind: 'vendor_error', status: res.status, message: `${req.vendor} answered with something that is not JSON.` };
    }
  }
  const said = vendorReason(await res.text().catch(() => ''));
  const detail = said ? `: ${said}` : '';
  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: 'unauthorized', status: res.status, message: `${req.vendor} refused the credential (HTTP ${res.status}${detail}).${req.authHint ? ` ${req.authHint}` : ''}` };
  }
  if (res.status === 404) {
    return { ok: false, kind: 'not_found', status: 404, message: `${req.vendor} has nothing there (HTTP 404${detail}).` };
  }
  if (res.status === 429) {
    return { ok: false, kind: 'rate_limited', status: 429, message: `${req.vendor} is rate limiting this credential; try again in a minute.` };
  }
  return { ok: false, kind: 'vendor_error', status: res.status, message: `${req.vendor} answered HTTP ${res.status}${detail}.` };
}

/**
 * The data, or the failure's sentence thrown — for a sync, whose contract is
 * throw-on-failure, and for a provider method an action calls.
 * @param result - What `vendorRequest` returned.
 */
export function orThrow<T>(result: VendorResult<T>): T {
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}

/**
 * HTML to plain text, for the vendors that store bodies as HTML (Intercom,
 * Freshdesk, Confluence's storage format): block tags become line breaks,
 * every other tag goes, and the common entities are decoded.
 * @param html - The HTML.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<\s*(?:script|style)[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6]|tr|blockquote|pre|table|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Plain text as the HTML a vendor's body field takes: escaped, a paragraph per
 * blank-line-separated block, a line break inside one.
 * @param text - What the agent wrote.
 */
export function textToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(block => block.trim()).filter(Boolean).map(block => `<p>${escape(block).replace(/\n/g, '<br>')}</p>`).join('');
}
