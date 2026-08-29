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
  // Contacts carry how the person arrived and how warm they are; without those
  // a lead row can only say who someone is, never why they are worth working.
  contacts: [
    'firstname',
    'lastname',
    'email',
    'company',
    'jobtitle',
    'lifecyclestage',
    'hubspot_owner_id',
    'hs_lastmodifieddate',
    'createdate',
    'hs_analytics_source',
    'hs_analytics_source_data_1',
    'hs_latest_source',
    'hs_email_delivered',
    'hs_email_open',
    'hs_email_click',
  ],
  deals: ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'hubspot_owner_id', 'hs_lastmodifieddate', 'createdate'],
  companies: ['name', 'domain', 'industry', 'description', 'numberofemployees', 'hubspot_owner_id', 'hs_lastmodifieddate', 'createdate'],
};

const hubspotConfigSchema = z.object({
  objectType: z.enum(OBJECT_TYPES).default('contacts'),
  /** Override the properties fetched per record. */
  properties: z.array(z.string()).optional(),
  /** Override for testing / EU data residency. */
  baseUrl: z.string().url().default('https://api.hubapi.com'),
  /** HubSpot portal (account) id — enables record deep links on review cards. */
  portalId: z.union([z.string(), z.number()]).optional(),
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

/**
 * Deal-stage metadata, keyed by stage id.
 *
 * Needed because a deal stage is only self-describing in the DEFAULT pipeline,
 * where the ids read as `closedwon` / `appointmentscheduled`. Custom pipelines
 * use opaque numeric ids, so "is this deal open?" is unanswerable from the
 * stage alone — and a hardcoded list of open-looking stage names silently
 * omits every custom pipeline, understating open pipeline value.
 */
type StageInfo = { label: string; isClosed: boolean; pipelineLabel: string };

/**
 * Fetch stage labels and closed-ness for every deal pipeline. One request per
 * sync, not per record.
 * @param baseUrl
 * @param headers
 */
async function fetchDealStages(baseUrl: string, headers: Record<string, string>): Promise<Map<string, StageInfo>> {
  const map = new Map<string, StageInfo>();
  const res = await fetch(`${baseUrl}/crm/v3/pipelines/deals`, { headers });
  if (!res.ok) {
    // Non-fatal: without it, deals still sync and simply carry no
    // `dealClosed` flag, which the read tools report as unavailable rather
    // than guessing.
    return map;
  }
  const body = (await res.json()) as {
    results?: Array<{
      label?: string;
      stages?: Array<{ id?: string; label?: string; metadata?: { isClosed?: string | boolean } }>;
    }>;
  };
  for (const pipeline of body.results ?? []) {
    for (const stage of pipeline.stages ?? []) {
      if (!stage.id) {
        continue;
      }
      const raw = stage.metadata?.isClosed;
      map.set(stage.id, {
        label: stage.label ?? stage.id,
        isClosed: raw === true || raw === 'true',
        pipelineLabel: pipeline.label ?? '',
      });
    }
  }
  return map;
}

/**
 * The embedded content is IDENTITY ONLY — the stable fields semantic search
 * matches a record BY (who or what it is). Everything filterable or volatile
 * (owner, lifecycle, dates, amounts, analytics sources, email counters) is
 * metadata-only: `IngestionService` refreshes metadata without re-embedding
 * when the content hash is unchanged, so a record touch or an email open no
 * longer re-embeds the record, and a new fetched property lands metadata-only
 * by default. CRM records stay single-chunk.
 * @param objectType
 * @param props
 * @param stage
 */
function identityContent(
  objectType: string,
  props: Record<string, string | null>,
  stage?: StageInfo,
): string {
  if (objectType === 'contacts') {
    const fullName = [props.firstname, props.lastname].filter(Boolean).join(' ').trim();
    const role = [props.jobtitle, props.company].filter(Boolean).join(' at ');
    return [fullName, role, props.email].filter(Boolean).join('\n');
  }
  if (objectType === 'deals') {
    return [props.dealname, stage?.pipelineLabel].filter(Boolean).join('\n');
  }
  if (objectType === 'companies') {
    return [props.name, props.domain, props.industry, props.description].filter(Boolean).join('\n');
  }
  return '';
}

function toDoc(objectType: string, r: HubSpotRecord, stages?: Map<string, StageInfo>): IngestDoc {
  const props = r.properties ?? {};
  const stage = props.dealstage ? stages?.get(props.dealstage) : undefined;
  const content = identityContent(objectType, props, stage);
  const modified = props.hs_lastmodifieddate ?? r.updatedAt;
  const email = props.email ?? undefined;
  const emailDomain = email && email.includes('@') ? email.slice(email.lastIndexOf('@') + 1).toLowerCase() : undefined;
  // Stamp the fields the discovery-detection matcher (ticket 011) needs into
  // metadata, so eligibility can be queried without parsing the content blob.
  //
  // Widened for the structured CRM read path: amount / closeDate / pipeline /
  // industry / employees / jobTitle / createdAt were all being FETCHED and then
  // dropped, which made "what is the pipeline worth" and "added this week"
  // unanswerable no matter how good the tools were. Existing rows carry the
  // narrow shape, so these need a full re-sync to backfill.
  return {
    externalId: `${objectType}:${r.id}`,
    title: titleFor(objectType, props, r.id),
    content: content || `${objectType} ${r.id}`,
    lastModifiedAt: modified ? new Date(modified) : null,
    metadata: {
      objectType,
      hubspotId: r.id,
      ownerId: props.hubspot_owner_id ?? undefined,
      lifecycleStage: props.lifecyclestage ?? undefined,
      dealStage: props.dealstage ?? undefined,
      primaryEmail: email,
      emailDomain,
      domain: props.domain ?? undefined,
      name: props.name ?? undefined,
      company: props.company ?? undefined,
      jobTitle: props.jobtitle ?? undefined,
      // Numeric so it can be summed in SQL; a non-numeric amount is dropped
      // rather than stored as junk that would poison a total.
      amount: numeric(props.amount),
      pipeline: props.pipeline ?? undefined,
      closeDate: props.closedate ?? undefined,
      industry: props.industry ?? undefined,
      employees: numeric(props.numberofemployees),
      createdAt: props.createdate ?? undefined,
      // How the contact arrived, and prior email engagement. Keys are
      // alphanumeric because `CrmRecordsService.meta()` inlines them.
      originalSource: props.hs_analytics_source ?? undefined,
      originalSourceDetail: props.hs_analytics_source_data_1 ?? undefined,
      latestSource: props.hs_latest_source ?? undefined,
      emailDelivered: numeric(props.hs_email_delivered),
      emailOpened: numeric(props.hs_email_open),
      emailClicked: numeric(props.hs_email_click),
      // Resolved from the pipeline definitions, so "open pipeline" is a real
      // predicate rather than a guess at which stage names look open.
      dealStageLabel: stage?.label,
      dealClosed: stage ? stage.isClosed : undefined,
      pipelineLabel: stage?.pipelineLabel || undefined,
    },
  };
}

/**
 * Parse a HubSpot numeric property, dropping anything that is not a number.
 * @param v
 */
function numeric(v: string | null | undefined): number | undefined {
  if (v == null || v === '') {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
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

    // Deal stages resolve through the pipeline definitions; one fetch up front.
    const stages = cfg.objectType === 'deals' ? await fetchDealStages(cfg.baseUrl, headers) : undefined;

    let after = ctx.cursor ?? undefined;
    do {
      const page = await fetchPage(after);
      for (const r of page.results ?? []) {
        ctx.onProgress?.({ kind: 'fetched', uri: r.id });
        yield toDoc(cfg.objectType, r, stages);
      }
      after = page.paging?.next?.after;
    } while (after);
  },
};
