/**
 * fetch_url — read a single web page live and return its extracted text.
 * Provider-pluggable (builtin extractor default; Firecrawl optional) via
 * VOCION_BROWSE_PROVIDER.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { ProviderNotConfiguredError } from '@/libs/tools/types';

const MAX_CHARS = 12_000;

export function fetchUrlTool(_ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { url } = args;
      try {
        const provider = getBrowseProvider();
        const page = await provider.fetchPage(url);
        if (!page) {
          return `Fetched ${url} but found no readable text.`;
        }
        const body = page.content.length > MAX_CHARS
          ? `${page.content.slice(0, MAX_CHARS)}\n\n…[truncated ${page.content.length - MAX_CHARS} chars]`
          : page.content;
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
        'Fetch a single public web page and return its readable text (titles, paragraphs). Use after web_search to read a result, or when the user gives you a URL.',
      schema: z.object({
        url: z.string().url().describe('The absolute URL to fetch'),
      }),
    },
  );
}
