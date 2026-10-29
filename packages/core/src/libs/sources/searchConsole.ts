/**
 * Google Search Console connector — the capability carrier for the
 * `search_console_queries` and `search_console_pages` tools, and nothing else.
 *
 * Read LIVE through the Search Console API (`libs/searchConsole/client.ts`),
 * never mirrored. One-click "Log in with Google", asking for
 * `webmasters.readonly` alone (its own connector, so a Search Console login
 * reads no mail and a Gmail login reads no rankings). Which property a
 * client's work reads is the Project's (`searchConsoleProperty` on the
 * project, picked by a person in chat); `siteUrl` here is only the
 * workspace's default when a project has none.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

export const searchConsoleConfigSchema = z.object({
  /** The default property: `sc-domain:example.com` or a URL prefix. */
  siteUrl: z.string().min(1).optional(),
});

export const searchConsoleConnector: SourceConnector<typeof searchConsoleConfigSchema> = {
  slug: 'search-console',
  name: 'Google Search Console',
  description: 'What a site already gets from Google search, read live: the queries it shows for, its pages, and their clicks, impressions, click-through rate and position. Free, and the client\'s own numbers.',
  icon: 'Search',
  category: 'data-analytics',
  brand: 'google',
  authKind: 'oauth',
  syncless: true,
  configSchema: searchConsoleConfigSchema,
  requiredScopes: ['https://www.googleapis.com/auth/webmasters.readonly'],

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the Search Console tools, never mirrored.
  },
};
