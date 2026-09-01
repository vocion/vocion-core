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
import type { StageInfo } from '@/libs/hubspot/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { createHubspotClient, hubspotNumeric, tokenFromCredentials } from '@/libs/hubspot/client';

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
    // The MQL stage-entry date, both spellings: the v2 pipeline property and
    // the legacy per-stage date. Whichever the portal carries wins in toDoc.
    'hs_v2_date_entered_marketingqualifiedlead',
    'hs_lifecyclestage_marketingqualifiedlead_date',
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
      amount: hubspotNumeric(props.amount),
      pipeline: props.pipeline ?? undefined,
      closeDate: props.closedate ?? undefined,
      industry: props.industry ?? undefined,
      employees: hubspotNumeric(props.numberofemployees),
      createdAt: props.createdate ?? undefined,
      // How the contact arrived, and prior email engagement. Keys are
      // alphanumeric because `CrmRecordsService.meta()` inlines them.
      originalSource: props.hs_analytics_source ?? undefined,
      originalSourceDetail: props.hs_analytics_source_data_1 ?? undefined,
      latestSource: props.hs_latest_source ?? undefined,
      emailDelivered: hubspotNumeric(props.hs_email_delivered),
      emailOpened: hubspotNumeric(props.hs_email_open),
      emailClicked: hubspotNumeric(props.hs_email_click),
      // When the contact ENTERED the MQL stage — the date the arrival window
      // cannot see (it filters on createdate). Whichever spelling the portal
      // carries; absent on rows synced before the widening until a full sync.
      mqlEnteredAt: props.hs_v2_date_entered_marketingqualifiedlead
        ?? props.hs_lifecyclestage_marketingqualifiedlead_date
        ?? undefined,
      // Resolved from the pipeline definitions, so "open pipeline" is a real
      // predicate rather than a guess at which stage names look open.
      dealStageLabel: stage?.label,
      dealClosed: stage ? stage.isClosed : undefined,
      pipelineLabel: stage?.pipelineLabel || undefined,
    },
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
    const token = tokenFromCredentials(ctx.credentials as Record<string, unknown> | undefined);
    if (!token) {
      throw new Error('HubSpot connector requires a private-app token in credentials.token');
    }
    const properties = cfg.properties ?? DEFAULT_PROPERTIES[cfg.objectType];
    const client = createHubspotClient({ token, baseUrl: cfg.baseUrl });

    async function fetchPage(after?: string): Promise<HubSpotPage> {
      const res = ctx.since
        // Incremental: CRM Search filtered on hs_lastmodifieddate >= since.
        ? await client.post<HubSpotPage>(`/crm/v3/objects/${cfg.objectType}/search`, {
            filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(ctx.since.getTime()) }] }],
            sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
            properties,
            limit: 100,
            ...(after ? { after } : {}),
          })
        : await client.get<HubSpotPage>(`/crm/v3/objects/${cfg.objectType}`, {
            limit: '100',
            properties: properties.join(','),
            ...(after ? { after } : {}),
          });
      if (!res.ok) {
        // The sync contract is throw-on-failure (the run is marked failed).
        throw new Error(`HubSpot ${cfg.objectType} fetch failed: ${res.message}`);
      }
      return res.data;
    }

    // Deal stages resolve through the pipeline definitions; one fetch up front.
    // Non-fatal on failure: deals still sync and simply carry no `dealClosed`
    // flag, which the read tools report as unavailable rather than guessing.
    let stages: Map<string, StageInfo> | undefined;
    if (cfg.objectType === 'deals') {
      const stagesRes = await client.fetchDealStages();
      stages = stagesRes.ok ? stagesRes.data : undefined;
    }

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
