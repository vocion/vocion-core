/**
 * Live HubSpot contact reads for the personalization intake.
 *
 * The MQL intake used to read only the CRM mirror, so a frozen sync silently
 * hid every new lead (observed 2026-09-14: the contacts watermark filtered on
 * a property contacts do not carry, and four days of MQLs never arrived).
 * Intake now reads HubSpot LIVE and keeps the mirror as the fallback, so a
 * broken sync degrades to yesterday's answer instead of an invisible queue.
 *
 * Records come back in the mirror's `CrmRecord` shape (ref + flattened
 * fields), so `queueLeads` and `reconcileMqlWindow` consume either source
 * through one row mapping.
 */

import type { HubspotClient, HubspotResult } from './client';
import { hubspotNumeric } from './client';

/** Identity + intake fields the queue renders — the live twin of the mirror's contact metadata. */
export const LIVE_CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'company',
  'jobtitle',
  'lifecyclestage',
  'hubspot_owner_id',
  'createdate',
  'hs_analytics_source',
  'hs_analytics_source_data_1',
  'hs_email_delivered',
  'hs_email_open',
  'hs_v2_date_entered_marketingqualifiedlead',
  'hs_lifecyclestage_marketingqualifiedlead_date',
] as const;

/** CrmRecord-compatible: `ref` is the mirror spelling (`contacts:<id>`). */
export type LiveContact = {
  ref: string;
  hubspotId: string;
  name: string | null;
  primaryEmail: string | null;
  company: string | null;
  jobTitle: string | null;
  lifecycleStage: string | null;
  ownerId: string | null;
  createdAt: string | null;
  originalSource: string | null;
  originalSourceDetail: string | null;
  emailDelivered: number | undefined;
  emailOpened: number | undefined;
  mqlEnteredAt: string | null;
  [key: string]: unknown;
};

type RawContact = { id: string; properties?: Record<string, string | null> };
type BatchReadBody = { results?: RawContact[] };
type SearchBody = { total?: number; results?: RawContact[]; paging?: { next?: { after?: string } } };

const PAGE = 100;

function toLiveContact(r: RawContact): LiveContact {
  const p = r.properties ?? {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
  return {
    ref: `contacts:${r.id}`,
    hubspotId: r.id,
    name: name || p.email || null,
    primaryEmail: p.email ?? null,
    company: p.company ?? null,
    jobTitle: p.jobtitle ?? null,
    lifecycleStage: p.lifecyclestage ?? null,
    ownerId: p.hubspot_owner_id ?? null,
    createdAt: p.createdate ?? null,
    originalSource: p.hs_analytics_source ?? null,
    originalSourceDetail: p.hs_analytics_source_data_1 ?? null,
    emailDelivered: hubspotNumeric(p.hs_email_delivered),
    emailOpened: hubspotNumeric(p.hs_email_open),
    mqlEnteredAt: p.hs_v2_date_entered_marketingqualifiedlead
      ?? p.hs_lifecyclestage_marketingqualifiedlead_date
      ?? null,
  };
}

/**
 * Batch-read named contacts by HubSpot id. Ids the CRM does not hold are
 * simply absent from the result — the caller diffs, exactly as with the mirror.
 * @param client
 * @param hubspotIds
 */
export async function readContactsLive(
  client: HubspotClient,
  hubspotIds: string[],
): Promise<HubspotResult<LiveContact[]>> {
  const records: LiveContact[] = [];
  for (let i = 0; i < hubspotIds.length; i += PAGE) {
    const res = await client.post<BatchReadBody>('/crm/v3/objects/contacts/batch/read', {
      properties: LIVE_CONTACT_PROPERTIES,
      inputs: hubspotIds.slice(i, i + PAGE).map(id => ({ id })),
    });
    if (!res.ok) {
      return res;
    }
    records.push(...(res.data.results ?? []).map(toLiveContact));
  }
  return { ok: true, data: records };
}

/**
 * Contacts CREATED in the window that are at one of the named lifecycle
 * stages now — the live twin of the mirror's arrival query, same semantics.
 * @param client
 * @param opts
 * @param opts.lifecycleStages
 * @param opts.createdAfterMs
 * @param opts.createdBeforeMs
 * @param opts.max
 */
export async function searchContactArrivalsLive(
  client: HubspotClient,
  opts: { lifecycleStages: string[]; createdAfterMs: number; createdBeforeMs?: number; max?: number },
): Promise<HubspotResult<{ records: LiveContact[]; truncated: boolean }>> {
  const max = opts.max ?? 500;
  const records: LiveContact[] = [];
  let after: string | undefined;
  let truncated = false;
  do {
    const res = await client.post<SearchBody>('/crm/v3/objects/contacts/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'lifecyclestage', operator: 'IN', values: opts.lifecycleStages },
          { propertyName: 'createdate', operator: 'GTE', value: String(opts.createdAfterMs) },
          ...(opts.createdBeforeMs !== undefined
            ? [{ propertyName: 'createdate', operator: 'LTE', value: String(opts.createdBeforeMs) }]
            : []),
        ],
      }],
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      properties: LIVE_CONTACT_PROPERTIES,
      limit: PAGE,
      ...(after ? { after } : {}),
    });
    if (!res.ok) {
      return res;
    }
    records.push(...(res.data.results ?? []).map(toLiveContact));
    after = res.data.paging?.next?.after;
    if (records.length >= max) {
      truncated = after !== undefined;
      break;
    }
  } while (after);
  return { ok: true, data: { records: records.slice(0, max), truncated } };
}
