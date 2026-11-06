/**
 * What a non-2xx answer said about itself, kept small enough to store.
 *
 * `HTTP 403` alone cannot tell a bot wall from a removed page: the server that
 * answered, the CDN's request id and the block page's title can. So a failed
 * fetch keeps a few allowlisted headers and the page's title (or the start of
 * its text when it has none), on the run's `failures` entry and in its message.
 *
 * The allowlist is the privacy boundary: nothing else in the response, cookies
 * included, is ever kept. Every read is bounded, the body by bytes and every
 * value by characters, and none of it can throw: a failure description that
 * fails would hide the failure it describes.
 */

import { load } from 'cheerio';

/** The response headers a failure keeps: who answered, and whether it was a block. */
const KEPT_HEADERS = [
  'server',
  'via',
  'x-cache',
  'cf-ray',
  'cf-mitigated',
  'x-azure-ref',
  'x-amzn-waf-action',
  'retry-after',
] as const;

const HEADER_VALUE_MAX_CHARS = 200;
const TEXT_MAX_CHARS = 300;
/** Enough for any block page's `<title>`; a 10 MB error page costs no more than this. */
const BODY_READ_MAX_BYTES = 64 * 1024;

/**
 * The structured half of a failed fetch, stored beside its one-line message.
 * `headers` holds only the allowlisted names the response carried.
 */
export type FetchFailureDetail = {
  status: number;
  headers: Record<string, string>;
  /** The HTML page's `<title>`, when it had one. */
  title?: string;
  /** The start of the body's text, when there was no title to read. */
  snippet?: string;
};

/**
 * Collapse whitespace and control characters, drop undecodable bytes, cut to `max`.
 * @param value - raw text.
 * @param max - the most characters kept.
 */
function oneLine(value: string, max: number): string {
  const visible = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7F || code === 0xFFFD ? ' ' : char;
  }).join('');
  const flat = visible.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The allowlisted headers the response carried, values cut.
 * @param headers - the response headers.
 */
function keptHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);
    const cut = value === null ? '' : oneLine(value, HEADER_VALUE_MAX_CHARS);
    if (cut) {
      kept[name] = cut;
    }
  }
  return kept;
}

/**
 * Whether a body of this type has text worth reading. A missing type is read,
 * since error pages often go out without one.
 * @param contentType - the response's content-type, or empty.
 */
function isTextual(contentType: string): boolean {
  return !contentType
    || contentType.startsWith('text/')
    || /json|xml|html/.test(contentType);
}

/**
 * The first `BODY_READ_MAX_BYTES` of the body as text, then the stream is let
 * go. Empty when the body cannot be read: the status alone still stands.
 * @param res - the failed response.
 */
async function bodyPrefix(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    return '';
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  let read = 0;
  try {
    while (read < BODY_READ_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const take = value.subarray(0, BODY_READ_MAX_BYTES - read);
      read += take.byteLength;
      text += decoder.decode(take, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return text;
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * The page's title, else the start of its text.
 * @param body - the body prefix.
 * @param isHtml - whether to read it as markup.
 */
function titleOrSnippet(body: string, isHtml: boolean): Pick<FetchFailureDetail, 'title' | 'snippet'> {
  if (!isHtml) {
    const snippet = oneLine(body, TEXT_MAX_CHARS);
    return snippet ? { snippet } : {};
  }
  const $ = load(body);
  const title = oneLine($('title').first().text(), TEXT_MAX_CHARS);
  if (title) {
    return { title };
  }
  $('script, style, noscript, template').remove();
  const snippet = oneLine($.root().text(), TEXT_MAX_CHARS);
  return snippet ? { snippet } : {};
}

/**
 * One line, `HTTP <status>` first, then ` · name: value` for what was found.
 * Exactly `HTTP <status>` when nothing was.
 * @param detail - the structured failure.
 */
function messageOf(detail: FetchFailureDetail): string {
  const parts = [`HTTP ${detail.status}`];
  for (const [name, value] of Object.entries(detail.headers)) {
    parts.push(`${name}: ${value}`);
  }
  if (detail.title) {
    parts.push(`title: ${detail.title}`);
  } else if (detail.snippet) {
    parts.push(`body: ${detail.snippet}`);
  }
  return parts.join(' · ');
}

/**
 * Describe a non-2xx response: its one-line message and the structured detail
 * behind it. Never throws; a body that cannot be read leaves headers and status.
 * @param res - the failed response; its body is consumed (at most 64 KiB).
 */
export async function describeHttpFailure(res: Response): Promise<{ message: string; detail: FetchFailureDetail }> {
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  let text: Pick<FetchFailureDetail, 'title' | 'snippet'> = {};
  if (isTextual(contentType)) {
    text = titleOrSnippet(await bodyPrefix(res), contentType.includes('html'));
  } else {
    res.body?.cancel().catch(() => {});
  }
  const detail: FetchFailureDetail = { status: res.status, headers: keptHeaders(res.headers), ...text };
  return { message: messageOf(detail), detail };
}
