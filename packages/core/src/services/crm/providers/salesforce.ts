/**
 * SALESFORCE — a provider of the CRM family (`../provider.ts`).
 *
 * Accounts are `Account`, contacts `Contact`, deals `Opportunity`; activity
 * is the `Task` and `Event` rows logged on a record. A note is a completed
 * Task (Salesforce's own "logged activity"), so Undo deletes that one Task.
 *
 * Every read is SOQL with the person's words quoted (`soqlContains`) and ids
 * checked for shape first; the auth is the source's own, built per call the
 * way its sync builds it (`libs/salesforce/client.ts`), so a rotated login is
 * saved to the same row the sync reads.
 */

import type { CrmActivity, CrmField, CrmFieldValue, CrmObject, CrmProvider, CrmRecord } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { SalesforceAuth, SfRow } from '@/libs/salesforce/client';
import { familyGrantPersistence, familySourceCredentials } from '@/libs/connectors/familyCredentials';
import { orThrow } from '@/libs/connectors/vendorFetch';
import {
  EVENT_FIELDS,
  lightningUrl,
  resolveSalesforceAuth,
  salesforceFieldName,
  salesforceId,
  SELECT_FIELDS,
  sfRequest,
  SOBJECT,
  soqlAll,
  soqlContains,
  soqlLiteral,
  TASK_FIELDS,
  toCrmActivity,
  toCrmRecord,
} from '@/libs/salesforce/client';

type Describe = { fields?: Array<{ name: string; label?: string; type?: string; updateable?: boolean; picklistValues?: Array<{ value: string; active?: boolean }> }> };

/**
 * The CRM provider for one Salesforce source.
 * @param orgId - The workspace.
 * @param source - The source row.
 */
export async function salesforceCrmProvider(orgId: string, source: FamilySource): Promise<CrmProvider> {
  const apiVersion = typeof source.config.apiVersion === 'string' ? source.config.apiVersion : undefined;
  const credentials = await familySourceCredentials(orgId, source);
  const resolved = await resolveSalesforceAuth(credentials, familyGrantPersistence(orgId, source), apiVersion);
  if (!resolved) {
    throw new Error(`The ${source.slug} source has no Salesforce credential. An admin connects it on the Connectors page.`);
  }
  const auth: SalesforceAuth = resolved;

  async function select(object: CrmObject, clause: string, limit: number): Promise<CrmRecord[]> {
    const rows = orThrow(await soqlAll<SfRow>(auth, `SELECT ${SELECT_FIELDS[object].join(', ')} FROM ${SOBJECT[object]} ${clause} LIMIT ${limit}`, limit));
    return rows.map(row => toCrmRecord(object, row, auth.instanceUrl));
  }

  async function one(object: CrmObject, id: string): Promise<CrmRecord> {
    const [record] = await select(object, `WHERE Id = ${soqlLiteral(salesforceId(id))}`, 1);
    if (!record) {
      throw new Error(`Salesforce has no ${object} ${id} that this user can see.`);
    }
    return record;
  }

  /**
   * The contacts on a deal, or the deals of a contact, through the
   * opportunity's contact roles.
   * @param by - Which side the id is on.
   * @param id - The deal or contact id.
   */
  async function contactRoles(by: 'OpportunityId' | 'ContactId', id: string): Promise<string[]> {
    const rows = orThrow(await soqlAll<{ ContactId?: string; OpportunityId?: string }>(auth, `SELECT ContactId, OpportunityId FROM OpportunityContactRole WHERE ${by} = ${soqlLiteral(id)} LIMIT 25`, 25));
    return rows.map(r => (by === 'OpportunityId' ? r.ContactId : r.OpportunityId)).filter((v): v is string => typeof v === 'string');
  }

  function inList(ids: string[]): string {
    return `(${ids.map(soqlLiteral).join(', ')})`;
  }

  return {
    kind: 'salesforce',
    sourceSlug: source.slug,

    async search(object, query, limit) {
      const words = soqlContains(query);
      const match = object === 'contact'
        ? `(Name LIKE ${words} OR Email LIKE ${words})`
        : object === 'account'
          ? `(Name LIKE ${words} OR Website LIKE ${words})`
          : `Name LIKE ${words}`;
      return select(object, `WHERE ${match} ORDER BY LastModifiedDate DESC`, limit);
    },

    async getRecord(object, id) {
      const record = await one(object, id);
      const related = { contacts: [] as CrmRecord[], deals: [] as CrmRecord[] };
      if (object === 'account') {
        related.contacts = await select('contact', `WHERE AccountId = ${soqlLiteral(record.id)} ORDER BY LastModifiedDate DESC`, 25);
        related.deals = await select('deal', `WHERE AccountId = ${soqlLiteral(record.id)} ORDER BY CloseDate DESC NULLS LAST`, 25);
      } else if (object === 'deal') {
        const ids = await contactRoles('OpportunityId', record.id);
        related.contacts = ids.length > 0 ? await select('contact', `WHERE Id IN ${inList(ids)}`, 25) : [];
      } else {
        const ids = await contactRoles('ContactId', record.id);
        related.deals = ids.length > 0 ? await select('deal', `WHERE Id IN ${inList(ids)} ORDER BY CloseDate DESC NULLS LAST`, 25) : [];
      }
      return { ...record, related };
    },

    async activity(object, id, limit) {
      const target = soqlLiteral(salesforceId(id));
      const on = object === 'account' ? `AccountId = ${target}` : object === 'contact' ? `WhoId = ${target}` : `WhatId = ${target}`;
      const tasks = orThrow(await soqlAll<SfRow>(auth, `SELECT ${TASK_FIELDS.join(', ')} FROM Task WHERE ${on} ORDER BY LastModifiedDate DESC LIMIT ${limit}`, limit));
      const events = orThrow(await soqlAll<SfRow>(auth, `SELECT ${EVENT_FIELDS.join(', ')} FROM Event WHERE ${on} ORDER BY StartDateTime DESC LIMIT ${limit}`, limit));
      const all: CrmActivity[] = [...tasks.map(r => toCrmActivity('Task', r)), ...events.map(r => toCrmActivity('Event', r))];
      return all.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? '')).slice(0, limit);
    },

    async listDeals({ status, limit }) {
      return select('deal', `${status === 'open' ? 'WHERE IsClosed = false ' : ''}ORDER BY LastModifiedDate ASC`, limit);
    },

    async fields(object): Promise<CrmField[]> {
      const describe = orThrow(await sfRequest<Describe>(auth, `/sobjects/${SOBJECT[object]}/describe`));
      return (describe.fields ?? []).map(f => ({
        name: f.name,
        label: f.label ?? f.name,
        type: f.type ?? 'string',
        writable: f.updateable === true,
        ...(f.picklistValues && f.picklistValues.length > 0 ? { options: f.picklistValues.filter(p => p.active !== false).map(p => p.value) } : {}),
      }));
    },

    async updateRecord(object, id, values) {
      const recordId = salesforceId(id);
      const names = Object.keys(values).map(salesforceFieldName);
      if (names.length === 0) {
        throw new Error('Name at least one field to set.');
      }
      // What the record said BEFORE, so Undo can put it back.
      const [before] = orThrow(await soqlAll<SfRow>(auth, `SELECT Id, ${names.join(', ')} FROM ${SOBJECT[object]} WHERE Id = ${soqlLiteral(recordId)} LIMIT 1`, 1));
      if (!before) {
        throw new Error(`Salesforce has no ${object} ${id} that this user can see.`);
      }
      const previous: Record<string, CrmFieldValue> = Object.fromEntries(names.map(n => [n, (before[n] ?? null) as CrmFieldValue]));
      orThrow(await sfRequest(auth, `/sobjects/${SOBJECT[object]}/${recordId}`, { method: 'PATCH', json: values }));
      return { previous, url: lightningUrl(auth.instanceUrl, SOBJECT[object], recordId) };
    },

    async addNote(object, id, note) {
      const recordId = salesforceId(id);
      const link = object === 'contact' ? { WhoId: recordId } : { WhatId: recordId };
      const created = orThrow(await sfRequest<{ id?: string }>(auth, '/sobjects/Task', {
        method: 'POST',
        json: { Subject: (note.title ?? 'Note').slice(0, 255), Description: note.text, Status: 'Completed', ActivityDate: new Date().toISOString().slice(0, 10), ...link },
      }));
      if (!created?.id) {
        throw new Error('Salesforce did not say which Task it created.');
      }
      return { id: created.id, url: lightningUrl(auth.instanceUrl, 'Task', created.id) };
    },

    async deleteNote(id) {
      orThrow(await sfRequest(auth, `/sobjects/Task/${salesforceId(id)}`, { method: 'DELETE' }));
    },
  };
}
