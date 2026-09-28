/**
 * fetch_url — read a single web page live and return its extracted text.
 * Provider-pluggable (builtin extractor default; Firecrawl optional) via
 * VOCION_BROWSE_PROVIDER.
 *
 * Returns the page whole, with no character cap. There is no extra network
 * cost to doing that: the provider has already downloaded the page and
 * extracted its text into memory before this tool returns anything, so a
 * big listing page (tens of kilobytes) costs the same one HTTP request
 * whether we hand back all of it or a slice of it. The only real cost of
 * returning it whole is prompt tokens on the model that reads the result,
 * and we accept that cost deliberately — the thing worth watching for is a
 * single agent run that fetches many large pages back to back, not any one
 * page on its own.
 *
 * An earlier version of this tool capped the response at 12,000 characters
 * and silently dropped everything past that, with no way to read the rest.
 * That is LARK-258: a long listing page got cut off mid-list with no
 * signal anything was missing, and the fix is exactly this — stop cutting
 * it off.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';

export function fetchUrlTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { url } = args;
      try {
        // A pull request on a repository this workspace connected is read
        // with the workspace's token — the diff, not a 404 (2026-09-26).
        const { readConnectedPull } = await import('./githubPullRead');
        const pull = await readConnectedPull(ctx.orgId, url);
        if (pull) {
          return pull;
        }
        const provider = getBrowseProvider();
        const page = await provider.fetchPage(url, { orgId: ctx.orgId });
        if (!page) {
          return `Fetched ${url} but found no readable text.`;
        }
        return `# ${page.title}\n${page.url}\n\n${page.content}\n\n[Total length: ${page.content.length} characters.]`;
      } catch (err) {
        if (err instanceof ToolProviderKeyUnavailableError) {
          // Deliberately not falling through to the server's key: this org may
          // hold one we simply could not read, and spending the deployment's
          // account instead would bill the wrong party silently.
          return `${err.message}. A workspace admin can re-enter it under API credentials.`;
        }
        if (err instanceof ProviderNotConfiguredError) {
          return `Browse is not configured (${err.message}).`;
        }
        return `Could not fetch ${url}: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'fetch_url',
      description:
        'Fetch a single web page and return its full readable text — never truncated — plus the total character length. A GitHub pull request URL on a repository this workspace connected returns the PR and its diff, read with the workspace\'s token (private repos included). Use after web_search to read a result, or when the user gives you a URL.',
      schema: z.object({
        url: z.string().url().describe('The absolute URL to fetch'),
      }),
    },
  );
}
