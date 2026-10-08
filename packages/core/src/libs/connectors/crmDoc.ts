/**
 * A CRM record or activity as one retrievable document — the one shape every
 * CRM connector in the family syncs (Salesforce, Pipedrive, Attio).
 *
 * The embedded content is IDENTITY ONLY, the lesson the HubSpot mirror paid
 * for (`libs/sources/hubspot.ts`): the stable fields semantic search finds a
 * record BY — a contact's name, role and email; an account's name, domain,
 * industry and description; a deal's name and account. Everything volatile or
 * filterable (stage, amount, owner, dates) is metadata, so a stage change
 * refreshes metadata without re-embedding the record. An activity is the
 * opposite: what was logged IS its content.
 */

import type { CrmActivity, CrmObject, CrmRecord } from '@/services/crm/provider';
import type { IngestDoc } from '@/services/IngestionService';

/**
 * The externalId a record's document carries: `<connector>:<object>:<id>`.
 * @param connector - The connector kind, e.g. `salesforce`.
 * @param object - The record's object.
 * @param id - The vendor's id.
 */
export function crmExternalId(connector: string, object: CrmObject | 'activity', id: string): string {
  return `${connector}:${object}:${id}`;
}

function identityContent(r: CrmRecord): string {
  if (r.object === 'contact') {
    const role = [r.title, r.account?.name].filter(Boolean).join(' at ');
    return [r.name, role, r.email].filter(Boolean).join('\n');
  }
  if (r.object === 'deal') {
    return [r.name, r.account?.name].filter(Boolean).join('\n');
  }
  return [r.name, r.domain, r.industry, r.description].filter(Boolean).join('\n');
}

function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * One CRM record as a document.
 * @param connector - The connector kind, e.g. `salesforce`.
 * @param r - The record, as the family's provider maps it.
 */
export function crmRecordDoc(connector: string, r: CrmRecord): IngestDoc {
  const email = r.email ?? undefined;
  return {
    externalId: crmExternalId(connector, r.object, r.id),
    title: r.name || `${r.object} ${r.id}`,
    content: identityContent(r) || `${r.object} ${r.id}`,
    ...(r.url ? { uri: r.url } : {}),
    lastModifiedAt: dateOrNull(r.updated),
    metadata: {
      kind: 'crm-record',
      crm: connector,
      objectType: r.object,
      recordId: r.id,
      name: r.name,
      url: r.url ?? undefined,
      owner: r.owner ?? undefined,
      createdAt: r.created ?? undefined,
      updatedAt: r.updated ?? undefined,
      primaryEmail: email,
      emailDomain: email && email.includes('@') ? email.slice(email.lastIndexOf('@') + 1).toLowerCase() : undefined,
      domain: r.domain ?? undefined,
      jobTitle: r.title ?? undefined,
      industry: r.industry ?? undefined,
      accountId: r.account?.id ?? undefined,
      accountName: r.account?.name ?? undefined,
      stage: r.stage ?? undefined,
      // Numeric so it can be summed; a non-number is dropped rather than stored as junk.
      amount: typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : undefined,
      currency: r.currency ?? undefined,
      closeDate: r.closeDate ?? undefined,
      dealOpen: typeof r.open === 'boolean' ? r.open : undefined,
    },
  };
}

/**
 * One logged activity as a document: the words are the content.
 * @param connector - The connector kind.
 * @param a - The activity.
 */
export function crmActivityDoc(connector: string, a: CrmActivity): IngestDoc {
  const on = a.on?.name ? `On: ${a.on.name}${a.on.object ? ` (${a.on.object})` : ''}` : '';
  return {
    externalId: crmExternalId(connector, 'activity', a.id),
    title: `${a.subject || a.kind}${a.when ? ` — ${a.when}` : ''}`,
    content: [`${a.kind[0]?.toUpperCase() ?? ''}${a.kind.slice(1)}: ${a.subject || '(no subject)'}`, a.when ? `When: ${a.when}` : '', on, a.owner ? `Owner: ${a.owner}` : '', a.body ? `\n${a.body}` : ''].filter(Boolean).join('\n'),
    lastModifiedAt: dateOrNull(a.updated ?? a.when),
    metadata: {
      kind: 'crm-activity',
      crm: connector,
      activityKind: a.kind,
      activityId: a.id,
      when: a.when ?? undefined,
      done: typeof a.done === 'boolean' ? a.done : undefined,
      owner: a.owner ?? undefined,
      recordObject: a.on?.object ?? undefined,
      recordId: a.on?.id ?? undefined,
      recordName: a.on?.name ?? undefined,
    },
  };
}
