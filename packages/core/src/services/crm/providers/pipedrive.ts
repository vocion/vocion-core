/**
 * PIPEDRIVE — a provider of the CRM family (`../provider.ts`).
 *
 * Accounts are organizations, contacts are persons, deals are deals; the
 * activity on a record is its activities (v2) and its notes (v1). A note
 * added here is a Pipedrive note on the record, so Undo deletes that note.
 *
 * Custom fields are keyed by a 40-character hash. The v2 write takes them
 * under `custom_fields`, and a single- or multiple-option field takes the
 * option's id — so an update looks the object's fields up once and turns an
 * option's label into its id, letting an agent write `"Enterprise"` rather
 * than guess a number.
 */

import type { CrmActivity, CrmField, CrmFieldValue, CrmObject, CrmProvider, CrmRecord } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { PdEnvelope, PdLookups, PdRow, PipedriveAuth } from '@/libs/pipedrive/client';
import { familySourceCredentials } from '@/libs/connectors/familyCredentials';
import { orThrow } from '@/libs/connectors/vendorFetch';
import { loadPipedriveLookups, PD_COLLECTION, PD_PARENT_KEY, pdRequest, PIPEDRIVE_API, pipedriveAuthFrom, pipedriveUrl, readPipedriveMe, toPipedriveActivity, toPipedriveNote, toPipedriveRecord } from '@/libs/pipedrive/client';

const FIELD_DEFS: Record<CrmObject, string> = { account: 'organizationFields', contact: 'personFields', deal: 'dealFields' };
const CUSTOM_FIELD_KEY = /^[0-9a-f]{40}$/;

type FieldDef = { key: string; name?: string; field_type?: string; bulk_edit_allowed?: boolean; options?: Array<{ id: number; label: string }> };

/**
 * The id, or a thrown sentence when it is not a Pipedrive id.
 * @param id - Candidate id.
 */
function pipedriveId(id: string): string {
  const trimmed = id.trim();
  if (!/^\d{1,15}$/.test(trimmed)) {
    throw new Error(`${id} is not a Pipedrive id (a number). Find the record with crm_search_records first.`);
  }
  return trimmed;
}

/**
 * Plain text as a note body Pipedrive renders: escaped, line breaks kept.
 * @param text - What the agent wrote.
 */
function noteHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/**
 * The CRM provider for one Pipedrive source.
 * @param orgId - The workspace.
 * @param source - The source row.
 */
export async function pipedriveCrmProvider(orgId: string, source: FamilySource): Promise<CrmProvider> {
  const baseUrl = typeof source.config.baseUrl === 'string' ? source.config.baseUrl : PIPEDRIVE_API;
  const parsed = pipedriveAuthFrom(await familySourceCredentials(orgId, source), baseUrl);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const auth: PipedriveAuth = parsed.auth;
  let lookups: PdLookups | null = null;

  async function names(): Promise<PdLookups> {
    if (!lookups) {
      const me = await readPipedriveMe(auth);
      lookups = await loadPipedriveLookups(auth, me.ok ? me.data.company_domain ?? null : null);
    }
    return lookups;
  }

  /**
   * Organization names for the rows' `org_id`s not yet known, one read each.
   * @param rows - Persons or deals.
   */
  async function nameOrgs(rows: PdRow[]): Promise<void> {
    const known = await names();
    const missing = [...new Set(rows.map(r => r.org_id).filter((id): id is number => typeof id === 'number' && !known.orgs.has(id)))];
    for (const id of missing.slice(0, 25)) {
      const res = await pdRequest<PdEnvelope<PdRow>>(auth, `/api/v2/organizations/${id}`);
      if (res.ok && typeof res.data?.data?.name === 'string') {
        known.orgs.set(id, res.data.data.name);
      }
    }
  }

  async function list(object: CrmObject, query: Record<string, string | number | undefined>): Promise<CrmRecord[]> {
    const rows = orThrow(await pdRequest<PdEnvelope<PdRow[]>>(auth, `/api/v2/${PD_COLLECTION[object]}`, { query })).data ?? [];
    await nameOrgs(rows);
    const known = await names();
    return rows.filter(r => r.is_deleted !== true).map(r => toPipedriveRecord(object, r, known));
  }

  async function one(object: CrmObject, id: string): Promise<{ record: CrmRecord; row: PdRow }> {
    const row = orThrow(await pdRequest<PdEnvelope<PdRow>>(auth, `/api/v2/${PD_COLLECTION[object]}/${pipedriveId(id)}`)).data;
    if (!row) {
      throw new Error(`Pipedrive has no ${object} ${id}.`);
    }
    await nameOrgs([row]);
    return { record: toPipedriveRecord(object, row, await names()), row };
  }

  async function fieldDefs(object: CrmObject): Promise<FieldDef[]> {
    return orThrow(await pdRequest<PdEnvelope<FieldDef[]>>(auth, `/v1/${FIELD_DEFS[object]}`, { query: { limit: 500 } })).data ?? [];
  }

  return {
    kind: 'pipedrive',
    sourceSlug: source.slug,

    async search(object, query, limit) {
      const term = query.trim();
      if (term.length < 2) {
        throw new Error('Pipedrive searches need at least two characters.');
      }
      const found = orThrow(await pdRequest<PdEnvelope<{ items?: Array<{ item?: { id?: number; organization?: { id?: number; name?: string } | null } }> }>>(auth, `/api/v2/${PD_COLLECTION[object]}/search`, { query: { term, limit } })).data?.items ?? [];
      const known = await names();
      for (const hit of found) {
        const org = hit.item?.organization;
        if (org?.id && org.name) {
          known.orgs.set(org.id, org.name);
        }
      }
      const ids = found.map(hit => hit.item?.id).filter((id): id is number => typeof id === 'number');
      return ids.length > 0 ? list(object, { ids: ids.join(','), limit }) : [];
    },

    async getRecord(object, id) {
      const { record, row } = await one(object, id);
      const related = { contacts: [] as CrmRecord[], deals: [] as CrmRecord[] };
      if (object === 'account') {
        related.contacts = await list('contact', { org_id: record.id, limit: 25 });
        related.deals = await list('deal', { org_id: record.id, limit: 25 });
      } else if (object === 'contact') {
        related.deals = await list('deal', { person_id: record.id, limit: 25 });
      } else if (typeof row.person_id === 'number') {
        related.contacts = await list('contact', { ids: String(row.person_id) });
      }
      return { ...record, related };
    },

    async activity(object, id, limit) {
      const parent = { [PD_PARENT_KEY[object]]: pipedriveId(id) };
      const known = await names();
      const activities = orThrow(await pdRequest<PdEnvelope<PdRow[]>>(auth, '/api/v2/activities', { query: { ...parent, limit } })).data ?? [];
      const notes = orThrow(await pdRequest<PdEnvelope<PdRow[]>>(auth, '/v1/notes', { query: { ...parent, limit, sort: 'add_time DESC' } })).data ?? [];
      const all: CrmActivity[] = [
        ...activities.filter(r => r.is_deleted !== true).map(r => toPipedriveActivity(r, known)),
        ...notes.map(toPipedriveNote),
      ];
      return all.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? '')).slice(0, limit);
    },

    async listDeals({ status, limit }) {
      return list('deal', { ...(status === 'open' ? { status: 'open' } : {}), sort_by: 'update_time', sort_direction: 'asc', limit });
    },

    async fields(object): Promise<CrmField[]> {
      return (await fieldDefs(object)).map(f => ({
        name: f.key,
        label: f.name ?? f.key,
        type: f.field_type ?? 'varchar',
        writable: f.bulk_edit_allowed === true,
        ...(f.options && f.options.length > 0 ? { options: f.options.map(o => o.label) } : {}),
      }));
    },

    async updateRecord(object, id, values) {
      const recordId = pipedriveId(id);
      const keys = Object.keys(values);
      if (keys.length === 0) {
        throw new Error('Name at least one field to set.');
      }
      const defs = new Map((await fieldDefs(object)).map(f => [f.key, f]));
      const standard: Record<string, CrmFieldValue> = {};
      const custom: Record<string, CrmFieldValue> = {};
      for (const key of keys) {
        const def = defs.get(key);
        let value = values[key] ?? null;
        // An option is written by its id; accept its label too.
        const option = def?.options?.find(o => typeof value === 'string' && o.label.toLowerCase() === value.toLowerCase());
        if (option) {
          value = option.id;
        }
        (CUSTOM_FIELD_KEY.test(key) ? custom : standard)[key] = value;
      }
      const { row } = await one(object, recordId);
      const before = (row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields : {}) as Record<string, unknown>;
      const previous: Record<string, CrmFieldValue> = Object.fromEntries(keys.map((key) => {
        const was = CUSTOM_FIELD_KEY.test(key) ? before[key] : row[key];
        return [key, (was === undefined || (was !== null && typeof was === 'object') ? null : was) as CrmFieldValue];
      }));
      const body = { ...standard, ...(Object.keys(custom).length > 0 ? { custom_fields: custom } : {}) };
      orThrow(await pdRequest(auth, `/api/v2/${PD_COLLECTION[object]}/${recordId}`, { method: 'PATCH', json: body }));
      return { previous, url: pipedriveUrl((await names()).companyDomain, object, recordId) };
    },

    async addNote(object, id, note) {
      const recordId = pipedriveId(id);
      const content = noteHtml(note.title ? `${note.title}\n\n${note.text}` : note.text);
      const created = orThrow(await pdRequest<PdEnvelope<{ id?: number }>>(auth, '/v1/notes', { method: 'POST', json: { content, [PD_PARENT_KEY[object]]: Number(recordId) } })).data;
      if (typeof created?.id !== 'number') {
        throw new TypeError('Pipedrive did not say which note it created.');
      }
      return { id: String(created.id), url: pipedriveUrl((await names()).companyDomain, object, recordId) };
    },

    async deleteNote(id) {
      orThrow(await pdRequest(auth, `/v1/notes/${pipedriveId(id)}`, { method: 'DELETE' }));
    },
  };
}
