/**
 * fetch_url — read a single web page live and return its extracted text.
 * Provider-pluggable (builtin extractor default; Firecrawl optional) via
 * VOCION_BROWSE_PROVIDER.
 *
 * The tool never returns a whole page in one call: an LLM context is a
 * shared, metered resource, so every response is capped at MAX_CHARS
 * (12,000) characters of the page's extracted text. Most pages fit in one
 * call and never notice the cap. For a page longer than that, the caller
 * passes `offset` (a character count) to read the next window — every
 * response reports the page's total length, so the model always knows how
 * many more calls it needs and never has to guess whether it saw the whole
 * page. This is VEERIO-258: before paging existed, a long page was silently
 * cut off at 12,000 characters with no way to read the rest, which lost
 * real content (a listing page's later entries) with no signal that
 * anything was missing.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { ProviderNotConfiguredError } from '@/libs/tools/types';

/**
 * Size of one page window. Unchanged from before paging existed, so a
 * tenant whose pages already fit under the cap sees no difference.
 */
const MAX_CHARS = 12_000;

/**
 * Upper bound on the `offset` argument itself, independent of any one
 * page's actual length. Without this, a model that mis-computed an offset
 * (or asked for one enormous jump instead of walking forward a window at a
 * time) would get back the same ambiguous "you're past the end" response as
 * someone who correctly paged through to the real end of a real page. This
 * cap keeps those two situations distinguishable: past a sane maximum, the
 * tool refuses the argument outright with a message the model can act on,
 * rather than quietly returning an empty window.
 */
const MAX_OFFSET = 10_000_000;

/**
 * Slice out one MAX_CHARS-sized window of `content` starting at `offset`,
 * and describe what happened in a trailer the model can read. Every
 * response — including the very first, default call — states the page's
 * total length, so "did I read the whole page?" never requires a guess.
 * @param content - the page's full extracted text
 * @param offset - character index to start the window at (0 for the first call)
 */
function pageWindow(content: string, offset: number): string {
  const total = content.length;
  if (offset >= total) {
    return `[Already at or past the end of the page. Total length: ${total} characters.]`;
  }
  const end = Math.min(offset + MAX_CHARS, total);
  const window = content.slice(offset, end);
  const remaining = total - end;
  if (remaining === 0) {
    return `${window}\n\n[End of page — offset ${offset} to ${end} of ${total}. Total length: ${total} characters.]`;
  }
  return `${window}\n\n[Showing offset ${offset} to ${end} of ${total}. ${remaining} more characters remain — call fetch_url again with offset: ${end} to continue. Total length: ${total} characters.]`;
}

export function fetchUrlTool(_ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { url, offset } = args;
      try {
        const provider = getBrowseProvider();
        const page = await provider.fetchPage(url);
        if (!page) {
          return `Fetched ${url} but found no readable text.`;
        }
        const body = pageWindow(page.content, offset ?? 0);
        return `# ${page.title}\n${page.url}\n\n${body}`;
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) {
          return `Browse is not configured (${err.message}).`;
        }
        return `Could not fetch ${url}: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'fetch_url',
      description:
        'Fetch a single public web page and return its readable text (titles, paragraphs), one window of up to 12,000 characters at a time, always reporting the page\'s total length so you know whether more remains. Use after web_search to read a result, or when the user gives you a URL. For a page longer than one window, call again with offset set to the value the previous response suggested (e.g. offset: 12000) to read the next chunk, repeating until the response says you have reached the end.',
      schema: z.object({
        url: z.string().url().describe('The absolute URL to fetch'),
        offset: z.number().int().nonnegative().max(MAX_OFFSET).optional().describe(
          'Character offset into the page\'s text to resume reading from. Omit it on the first call; when that response reports more characters remain, call again with offset set to the number it suggested (e.g. offset: 12000) to get the next 12,000-character window, and repeat until the response reports the end of the page.',
        ),
      }),
    },
  );
}
