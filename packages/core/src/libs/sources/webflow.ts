/**
 * Webflow connector — a client's Webflow sites, written to by publishing a
 * page as a draft blog post (`site.publish_page`) and taking it live
 * (`site.publish_live`), through Webflow's Data API (v2).
 *
 * Connected by "Log in with Webflow" (`libs/connect/providers/webflow.ts`):
 * the person picks the sites on Webflow's consent screen, and that is all it
 * takes, so the login makes the source itself. A site API token (Site
 * settings → Apps & integrations → API access, with CMS read and write) is
 * the advanced path, for a site whose owner will not authorize an app.
 *
 * It ingests nothing: what is on a site is read through its sitemap
 * (`site_inventory`), and publishing calls the API live. Test connection
 * names the sites the credential reaches and each one's blog collection.
 */

import type { SourceConnector } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { blogCollectionOf } from '@/libs/publish/webflowMapping';
import { WebflowApiError, webflowClient } from '@/libs/webflow/api';
import { InspectInputError } from './inspect';

const webflowConfigSchema = z.object({});

/**
 * The token in a credential bag: a login's or a pasted site token's.
 * @param credentials - The bag.
 */
export function webflowTokenOf(credentials: Record<string, unknown> | undefined): string | null {
  const token = credentials?.token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

export const webflowConnector: SourceConnector<typeof webflowConfigSchema> = {
  slug: 'webflow',
  name: 'Webflow',
  brand: 'webflow',
  description: 'A client\'s Webflow site: approved pages saved as draft posts in its blog collection, and taken live on a second approval.',
  icon: 'Globe',
  category: 'sales-marketing',
  authKind: 'apikey',
  syncless: true,
  configSchema: webflowConfigSchema,
  inspectNote: 'Lists the sites this login or token reaches and finds each one\'s blog collection. Nothing is written.',

  async inspect({ credentials }) {
    const token = webflowTokenOf(credentials);
    if (!token) {
      throw new InspectInputError('Log in with Webflow, or paste a site API token under Advanced.');
    }
    const api = webflowClient(token);
    let sites;
    try {
      sites = await api.listSites();
    } catch (error) {
      const refused = error instanceof WebflowApiError && (error.status === 401 || error.status === 403);
      return { reachable: !(error instanceof WebflowApiError && error.status === null), authorized: !refused, checks: [{ key: 'sites', label: 'The sites it reaches', ok: false, detail: (error as Error).message }], note: null, error: (error as Error).message };
    }
    const checks: Array<{ key: string; label: string; ok: boolean; detail: string | null }> = [{ key: 'sites', label: 'The sites it reaches', ok: sites.length > 0, detail: sites.length > 0 ? sites.map(s => s.displayName).join(', ') : 'none: log in again and pick the client\'s site' }];
    for (const site of sites.slice(0, 10)) {
      const blog = await api.listCollections(site.id).then(blogCollectionOf, (error: Error) => error);
      checks.push({
        key: `blog:${site.id}`,
        label: `${site.displayName}: a blog collection`,
        ok: !(blog instanceof Error) && blog !== null,
        detail: blog instanceof Error ? blog.message : blog ? `${blog.displayName} (/${blog.slug})` : 'no collection named like a blog; name it on the project\'s publish target',
      });
    }
    const failed = checks.filter(c => !c.ok);
    return {
      reachable: true,
      authorized: true,
      checks,
      note: 'Publishing saves each page as a draft item in the blog collection; it goes live only on a second approval.',
      error: failed.length > 0 ? `${failed.map(c => c.label).join('; ')}: not yet.` : null,
    };
  },

  async* sync(): AsyncIterable<IngestDoc> {
    // Nothing to ingest: the site is read through its sitemap, and publishing calls the API live.
  },
};
