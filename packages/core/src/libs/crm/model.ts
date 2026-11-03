import type { HubspotRecord } from '@/libs/hubspot/client';
import { createHash } from 'node:crypto';

export const CRM_KINDS = ['companies', 'contacts', 'deals', 'followups'] as const;
export type CrmKind = typeof CRM_KINDS[number];
export type Values = Record<string, string | number | boolean | null>;
export type Pipeline = { id: string; label: string; displayOrder?: number; stages: { id: string; label: string; displayOrder: number; metadata?: { isClosed?: string | boolean; probability?: string } }[] };
export type CrmState = { phase: number; after?: string; seen: string[]; pipelines: Pipeline[]; owners: Record<string, string>; currency: string | null; portalId: string; cycle: string; counts: Record<string, number> };
export const HUBSPOT_OBJECT: Record<CrmKind, string> = { companies: 'companies', contacts: 'contacts', deals: 'deals', followups: 'tasks' };
export const PROPERTIES: Record<CrmKind, string[]> = {
  companies: ['name', 'domain', 'description', 'hubspot_owner_id'],
  contacts: ['firstname', 'lastname', 'email', 'jobtitle', 'lifecyclestage', 'hs_analytics_source', 'hubspot_owner_id'],
  deals: ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'hubspot_owner_id', 'deal_currency_code', 'hs_next_step'],
  followups: ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_timestamp', 'hubspot_owner_id'],
};

export function stableCrmId(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export const crmListId = (orgId: string, kind: CrmKind) => stableCrmId(`crm-v1:${orgId}:${kind}`);
export const crmRecordId = (orgId: string, portal: string, kind: CrmKind, id: string) => stableCrmId(`hubspot:${orgId}:${portal}:${kind}:${id}`);

export function mapHubspotRecord(kind: CrmKind, row: HubspotRecord, state: CrmState): Values {
  const p = row.properties;
  const owner = state.owners[p.hubspot_owner_id ?? ''] ?? p.hubspot_owner_id ?? '';
  const association = (type: string) => String(row.associations?.[type]?.results?.[0]?.id ?? '');
  const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : null;
  const common: Values = { hubspot_id: row.id, hubspot_updated: row.updatedAt ?? '', archived: false, owner, hubspot_url: `https://app.hubspot.com/contacts/${state.portalId}/record/${{ companies: '0-2', contacts: '0-1', deals: '0-3', followups: '0-27' }[kind]}/${row.id}` };
  if (kind === 'companies') {
    return { ...common, name: p.name || p.domain || row.id, website: p.domain ?? '', notes: p.description ?? '' };
  }
  if (kind === 'contacts') {
    return { ...common, name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || row.id, email: p.email ?? '', source: p.hs_analytics_source ?? '', lifecycle: p.lifecyclestage ?? '', jobtitle: p.jobtitle ?? '', company_hubspot_id: association('companies') };
  }
  if (kind === 'deals') {
    const pipeline = state.pipelines.find(pipe => pipe.id === p.pipeline);
    const stage = pipeline?.stages.find(s => s.id === p.dealstage);
    const closed = stage?.metadata?.isClosed === true || stage?.metadata?.isClosed === 'true';
    const amount = p.amount == null || p.amount === '' ? null : Number(p.amount);
    return { ...common, name: p.dealname || row.id, pipeline: pipeline?.label ?? p.pipeline ?? '', pipeline_id: p.pipeline ?? '', stage: stage?.label ?? p.dealstage ?? '', stage_id: p.dealstage ?? '', outcome: !stage || stage.metadata?.isClosed === undefined ? 'unknown' : closed ? stage.metadata?.probability === '1' ? 'won' : stage.metadata?.probability === '0' ? 'lost' : 'unknown' : 'open', amount: amount !== null && Number.isFinite(amount) ? amount : null, currency: p.deal_currency_code || state.currency, close_date: date(p.closedate), next_step: p.hs_next_step ?? '', company_hubspot_id: association('companies'), contact_hubspot_id: association('contacts') };
  }
  return { ...common, task: p.hs_task_subject || row.id, notes: p.hs_task_body ?? '', due: date(p.hs_timestamp), status: p.hs_task_status === 'COMPLETED' ? 'Done' : 'Open', source: 'HubSpot', contact_hubspot_id: association('contacts'), deal_hubspot_id: association('deals') };
}
