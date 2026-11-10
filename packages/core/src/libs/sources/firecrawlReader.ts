/**
 * A second read of a page the site refused to serve us, through Firecrawl.
 *
 * The web connector calls this only for a source whose config asked for it
 * (`fallbackReader: 'firecrawl'`), only after the direct fetch was refused as a
 * bot (`blockSignal.ts`), and at most once per page. It returns the rendered
 * HTML, which the connector reads exactly as it reads a page it fetched itself.
 *
 * Every read costs the workspace a Firecrawl credit, so:
 * - the key is the workspace's stored Firecrawl key, else the server's
 *   `FIRECRAWL_API_KEY`, looked up on every read (never cached across orgs);
 * - one sync spends at most `FIRECRAWL_READS_PER_RUN` reads, counted on a
 *   `FirecrawlRun` the sync owns, so concurrent runs never share a count;
 * - a failure is returned as one plain line, never thrown, so the run records
 *   it beside the direct failure instead of losing either.
 *
 * Credits are not a model call: nothing here charges an `agent_budget` row.
 * What a read cost is returned for the run's log.
 */

import type { FallbackOutcome } from './fetchFailure';
import process from 'node:process';
import { z } from 'zod';
import { resolveToolProviderKey } from '@/libs/tools/orgKey';
import { oneLine } from './fetchFailure';

const SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';

/** How many Firecrawl reads one sync may spend. Past it, a blocked page stays a failure. */
export const FIRECRAWL_READS_PER_RUN = 60;

/** How long Firecrawl itself may spend rendering the page. */
const SCRAPE_TIMEOUT_MS = 30_000;
/** Our own leash on the request, a little longer so Firecrawl's timeout answers first. */
const REQUEST_TIMEOUT_MS = 35_000;
/** Long enough for a showtimes page that renders client-side to draw its listings. */
const WAIT_FOR_MS = 5_000;
const ERROR_MAX_CHARS = 200;

/** The Firecrawl reads one sync has spent. One per sync, created by the connector. */
export type FirecrawlRun = { reads: number };

export type FirecrawlRead
  = | { ok: true; html: string; creditsUsed?: number }
    | { ok: false; failure: FallbackOutcome };

/** The parts of a v2 scrape answer this reads; anything else is ignored. */
const scrapeAnswerSchema = z.object({
  success: z.boolean().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
  data: z.object({
    rawHtml: z.string().optional(),
    metadata: z.object({
      statusCode: z.number().optional(),
      creditsUsed: z.number().optional(),
    }).optional(),
  }).optional(),
});
type ScrapeAnswer = z.infer<typeof scrapeAnswerSchema>;

/**
 * A failed read, as the run records it.
 * @param outcome - one line saying what happened.
 * @param extra - the status and credits, when known.
 */
function failed(outcome: string, extra: Pick<FallbackOutcome, 'status' | 'creditsUsed'> = {}): FirecrawlRead {
  return { ok: false, failure: { reader: 'firecrawl', outcome, ...extra } };
}

/**
 * The key this read spends: the workspace's own, else the server's, else null.
 * @param orgId - the workspace the sync runs for.
 */
async function keyFor(orgId: string): Promise<string | null> {
  return (await resolveToolProviderKey('firecrawl', orgId)) ?? process.env.FIRECRAWL_API_KEY ?? null;
}

/**
 * The answer's body, or an empty object when it is not the JSON Firecrawl documents.
 * @param res - Firecrawl's response.
 */
async function answerOf(res: Response): Promise<ScrapeAnswer> {
  try {
    const parsed = scrapeAnswerSchema.safeParse(JSON.parse(await res.text()));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Firecrawl's own `code: error`, cut to one line; empty when it sent neither.
 * @param answer - the parsed answer.
 */
function errorText(answer: ScrapeAnswer): string {
  const error = answer.error ? oneLine(answer.error, ERROR_MAX_CHARS) : '';
  return [answer.code, error].filter(Boolean).join(': ');
}

/**
 * Read one page through Firecrawl, rendered. Never throws.
 * @param url - the page the direct fetch was refused.
 * @param orgId - the workspace whose key is spent.
 * @param run - this sync's read count; raised before every call that can cost a credit.
 */
export async function readThroughFirecrawl(url: string, orgId: string, run: FirecrawlRun): Promise<FirecrawlRead> {
  if (run.reads >= FIRECRAWL_READS_PER_RUN) {
    return failed(`run ceiling reached (${FIRECRAWL_READS_PER_RUN} per run)`);
  }
  let key: string | null;
  try {
    key = await keyFor(orgId);
  } catch {
    // `resolveToolProviderKey` has logged the cause; spending the server's key
    // instead would bill the wrong party, so the read stops here.
    return failed('the workspace\'s stored Firecrawl key could not be read');
  }
  if (!key) {
    return failed('not set up for this workspace');
  }

  run.reads += 1;
  let res: Response;
  try {
    res = await fetch(SCRAPE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      // `maxAge: 0`: v2 otherwise serves a copy up to two days old, and a listing that old is wrong.
      body: JSON.stringify({ url, formats: ['rawHtml'], waitFor: WAIT_FOR_MS, maxAge: 0, timeout: SCRAPE_TIMEOUT_MS }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return failed(timedOut ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : 'fetch failed');
  }

  const answer = await answerOf(res);
  const creditsUsed = answer.data?.metadata?.creditsUsed;
  const credits = creditsUsed === undefined ? {} : { creditsUsed };
  if (!res.ok) {
    const said = errorText(answer);
    return failed(`HTTP ${res.status}${said ? ` ${said}` : ''}`, { status: res.status, ...credits });
  }
  if (answer.success === false) {
    return failed(errorText(answer) || 'Firecrawl reported a failure', { status: res.status, ...credits });
  }
  // Firecrawl answered, but the page it rendered may itself be the block page.
  const statusCode = answer.data?.metadata?.statusCode;
  if (statusCode !== undefined && statusCode >= 400) {
    const outcome = statusCode === 403 || statusCode === 429 ? `still blocked (HTTP ${statusCode})` : `the rendered page answered HTTP ${statusCode}`;
    return failed(outcome, { status: statusCode, ...credits });
  }
  const html = answer.data?.rawHtml ?? '';
  if (!html.trim()) {
    return failed('empty page', { ...(statusCode === undefined ? {} : { status: statusCode }), ...credits });
  }
  return { ok: true, html, ...credits };
}
