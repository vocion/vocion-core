/**
 * HubSpot connector — ingest CRM records (contacts / deals / companies) as
 * retrievable documents. Central to the Metacto RevOps reference deployment
 * (firsthq/docs/teams/revenue-operations.md) and the connector-pack kickoff on
 * the durable-ingestion pipeline.
 *
 * Auth: a HubSpot private-app token in `ctx.credentials.token` (Bearer).
 * Incremental: when `ctx.since` is set, fetch only records modified since via
 * the CRM Search API filtered on `hs_lastmodifieddate`; otherwise list all
 * (both paginate via the opaque `after` cursor). Idempotency + chunking are
 * handled downstream by IngestionService.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

const OBJECT_TYPES = ['contacts', 'deals', 'companies'] as const;

const DEFAULT_PROPERTIES: Record<(typeof OBJECT_TYPES)[number], string[]> = {
  contacts: ['firstname', 'lastname', 'email', 'company', 'jobtitle', 'lifecyclestage', 'hs_lastmodifieddate'],
  deals: ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'hs_lastmodifieddate'],
  companies: ['name', 'domain', 'industry', 'numberofemployees', 'hs_lastmodifieddate'],
};

const hubspotConfigSchema = z.object({
  objectType: z.enum(OBJECT_TYPES).default('contacts'),
  /** Override the properties fetched per record. */
  properties: z.array(z.string()).optional(),
  /** Override for testing / EU data residency. */
  baseUrl: z.string().url().default('https://api.hubapi.com'),
});

type HubSpotRecord = {
  id: string;
  properties: Record<string, string | null>;
  updatedAt?: string;
};
type HubSpotPage = { results: HubSpotRecord[]; paging?: { next?: { after?: string } } };

function titleFor(objectType: string, props: Record<string, string | null>, id: string): string {
  const fullName = [props.firstname, props.lastname].filter(Boolean).join(' ').trim();
  return props.dealname || props.name || fullName || props.email || `${objectType} ${id}`;
}

function toDoc(objectType: string, r: HubSpotRecord): IngestDoc {
  const props = r.properties ?? {};
  const content = Object.entries(props)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const modified = props.hs_lastmodifieddate ?? r.updatedAt;
  return {
    externalId: `${objectType}:${r.id}`,
    title: titleFor(objectType, props, r.id),
    content: content || `${objectType} ${r.id}`,
    lastModifiedAt: modified ? new Date(modified) : null,
    metadata: { objectType, hubspotId: r.id },
  };
}

export const hubspotConnector: SourceConnector<typeof hubspotConfigSchema> = {
  slug: 'hubspot',
  name: 'HubSpot',
  description: 'Ingest HubSpot CRM records (contacts, deals, companies) — incremental by last-modified.',
  icon: 'Contact',
  authKind: 'apikey',
  configSchema: hubspotConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = hubspotConfigSchema.parse(ctx.config);
    const token = (ctx.credentials?.token ?? ctx.credentials?.accessToken) as string | undefined;
    if (!token) {
      throw new Error('HubSpot connector requires a private-app token in credentials.token');
    }
    const properties = cfg.properties ?? DEFAULT_PROPERTIES[cfg.objectType];
    const headers = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' };

    async function fetchPage(after?: string): Promise<HubSpotPage> {
      let res: Response;
      if (ctx.since) {
        // Incremental: CRM Search filtered on hs_lastmodifieddate >= since.
        res = await fetch(`${cfg.baseUrl}/crm/v3/objects/${cfg.objectType}/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(ctx.since.getTime()) }] }],
            sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
            properties,
            limit: 100,
            ...(after ? { after } : {}),
          }),
        });
      } else {
        const params = new URLSearchParams({ limit: '100', properties: properties.join(',') });
        if (after) {
          params.set('after', after);
        }
        res = await fetch(`${cfg.baseUrl}/crm/v3/objects/${cfg.objectType}?${params.toString()}`, { headers });
      }
      if (!res.ok) {
        throw new Error(`HubSpot ${cfg.objectType} fetch failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      return (await res.json()) as HubSpotPage;
    }

    let after = ctx.cursor ?? undefined;
    do {
      const page = await fetchPage(after);
      for (const r of page.results ?? []) {
        ctx.onProgress?.({ kind: 'fetched', uri: r.id });
        yield toDoc(cfg.objectType, r);
      }
      after = page.paging?.next?.after;
    } while (after);
  },
};
