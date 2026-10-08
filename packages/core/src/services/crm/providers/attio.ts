/**
 * ATTIO — a provider of the CRM family (`../provider.ts`).
 *
 * Accounts are companies, contacts are people, deals are deals; the activity
 * on a record is its notes and its tasks. A note added here is an Attio note
 * on the record, so Undo deletes that note.
 *
 * What hangs off a record is read from the record's own reference
 * attributes — a company's `team` and `associated_deals`, a person's
 * `associated_deals`, a deal's `associated_people` — so no query has to
 * guess a filter shape. An update writes plain values (`PATCH`), which Attio
 * reads by the attribute's type: text, a number, a select option or status by
 * its title, a date. Undo writes back what the attribute held before, and an
 * attribute that was empty is cleared.
 */

import type { CrmActivity, CrmField, CrmFieldValue, CrmObject, CrmProvider, CrmRecord } from '../provider';
import type { AttioAuth, AttioLookups, AttioNote, AttioRecord } from '@/libs/attio/client';
import type { FamilySource } from '@/libs/connectors/families';
import { ATTIO_API, ATTIO_OBJECT, attioAuthFrom, attioRequest, attributeText, currentScalar, loadAttioLookups, toAttioNote, toAttioRecord } from '@/libs/attio/client';
import { familySourceCredentials } from '@/libs/connectors/familyCredentials';
import { orThrow } from '@/libs/connectors/vendorFetch';

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRIBUTE_SLUG = /^[a-z][\w-]{0,79}$/i;

/**
 * The id, or a thrown sentence when it is not an Attio record id.
 * @param id - Candidate id.
 */
function attioId(id: string): string {
  const trimmed = id.trim();
  if (!RECORD_ID.test(trimmed)) {
    throw new Error(`${id} is not an Attio record id (a uuid). Find the record with crm_search_records first.`);
  }
  return trimmed;
}

/** The reference attributes that list what hangs off each object. */
const RELATED: Record<CrmObject, { contacts: string | null; deals: string | null }> = {
  account: { contacts: 'team', deals: 'associated_deals' },
  contact: { contacts: null, deals: 'associated_deals' },
  deal: { contacts: 'associated_people', deals: null },
};

type AttributeDef = { api_slug?: string; title?: string; type?: string; is_writable?: boolean; is_archived?: boolean };

/**
 * The CRM provider for one Attio source.
 * @param orgId - The workspace.
 * @param source - The source row.
 */
export async function attioCrmProvider(orgId: string, source: FamilySource): Promise<CrmProvider> {
  const baseUrl = typeof source.config.baseUrl === 'string' ? source.config.baseUrl : ATTIO_API;
  const parsed = attioAuthFrom(await familySourceCredentials(orgId, source), baseUrl);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const auth: AttioAuth = parsed.auth;
  let lookups: AttioLookups | null = null;

  async function names(): Promise<AttioLookups> {
    lookups ??= await loadAttioLookups(auth);
    return lookups;
  }

  async function raw(object: CrmObject, id: string): Promise<AttioRecord> {
    const record = orThrow(await attioRequest<{ data?: AttioRecord }>(auth, `/objects/${ATTIO_OBJECT[object]}/records/${attioId(id)}`)).data;
    if (!record) {
      throw new Error(`Attio has no ${object} ${id}.`);
    }
    return record;
  }

  /**
   * A record mapped, with its company's name looked up when it points at one.
   * @param object - The object.
   * @param record - The raw record.
   */
  async function mapped(object: CrmObject, record: AttioRecord): Promise<CrmRecord> {
    const known = await names();
    const out = toAttioRecord(object, record, known);
    if (out.account && !out.account.name) {
      const company = await attioRequest<{ data?: AttioRecord }>(auth, `/objects/companies/records/${out.account.id}`);
      const name = company.ok ? attributeText(company.data?.data?.values?.name?.[0]) : null;
      if (name) {
        known.companies.set(out.account.id, name);
        out.account = { ...out.account, name };
      }
    }
    return out;
  }

  /**
   * The records a reference attribute points at, up to 25.
   * @param record - The record holding the reference.
   * @param attribute - The reference attribute's slug.
   * @param object - What the references are.
   */
  async function referenced(record: AttioRecord, attribute: string | null, object: CrmObject): Promise<CrmRecord[]> {
    if (!attribute) {
      return [];
    }
    const ids = (record.values?.[attribute] ?? []).map(v => (typeof v.target_record_id === 'string' ? v.target_record_id : null)).filter((v): v is string => v !== null).slice(0, 25);
    const out: CrmRecord[] = [];
    for (const id of ids) {
      const res = await attioRequest<{ data?: AttioRecord }>(auth, `/objects/${ATTIO_OBJECT[object]}/records/${id}`);
      if (res.ok && res.data?.data) {
        out.push(toAttioRecord(object, res.data.data, await names()));
      }
    }
    return out;
  }

  return {
    kind: 'attio',
    sourceSlug: source.slug,

    async search(object, query, limit) {
      const hits = orThrow(await attioRequest<{ data?: Array<{ id?: { record_id?: string } }> }>(auth, '/objects/records/search', {
        method: 'POST',
        json: { query: query.trim(), objects: [ATTIO_OBJECT[object]], request_as: { type: 'workspace' }, limit },
      })).data ?? [];
      const out: CrmRecord[] = [];
      for (const hit of hits.slice(0, limit)) {
        const id = hit.id?.record_id;
        if (id && RECORD_ID.test(id)) {
          out.push(await mapped(object, await raw(object, id)));
        }
      }
      return out;
    },

    async getRecord(object, id) {
      const record = await raw(object, id);
      return {
        ...(await mapped(object, record)),
        related: {
          contacts: await referenced(record, RELATED[object].contacts, 'contact'),
          deals: await referenced(record, RELATED[object].deals, 'deal'),
        },
      };
    },

    async activity(object, id, limit) {
      const parent = { object: ATTIO_OBJECT[object], id: attioId(id) };
      const known = await names();
      const notes = orThrow(await attioRequest<{ data?: AttioNote[] }>(auth, '/notes', { query: { parent_object: parent.object, parent_record_id: parent.id, limit: Math.min(limit, 50) } })).data ?? [];
      const tasks = orThrow(await attioRequest<{ data?: Array<{ id?: { task_id?: string }; content_plaintext?: string; deadline_at?: string | null; is_completed?: boolean; created_at?: string }> }>(auth, '/tasks', { query: { linked_object: parent.object, linked_record_id: parent.id, limit } })).data ?? [];
      const all: CrmActivity[] = [
        ...notes.map(n => toAttioNote(n, known)),
        ...tasks.map(t => ({ id: t.id?.task_id ?? '', kind: 'task', subject: t.content_plaintext ?? '', body: '', when: t.deadline_at ?? t.created_at ?? null, done: typeof t.is_completed === 'boolean' ? t.is_completed : null, owner: null })),
      ];
      return all.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? '')).slice(0, limit);
    },

    async listDeals({ limit }) {
      // Attio's stages carry no won/lost category, so "open" cannot be told
      // from closed here; every deal comes back, oldest first, with its stage.
      const records = orThrow(await attioRequest<{ data?: AttioRecord[] }>(auth, '/objects/deals/records/query', {
        method: 'POST',
        json: { limit, sorts: [{ attribute: 'created_at', direction: 'asc' }] },
      })).data ?? [];
      const out: CrmRecord[] = [];
      for (const record of records) {
        out.push(await mapped('deal', record));
      }
      return out;
    },

    async fields(object): Promise<CrmField[]> {
      const defs = (orThrow(await attioRequest<{ data?: AttributeDef[] }>(auth, `/objects/${ATTIO_OBJECT[object]}/attributes`)).data ?? []).filter(a => a.api_slug && !a.is_archived);
      const out: CrmField[] = [];
      for (const def of defs) {
        const field: CrmField = { name: def.api_slug!, label: def.title ?? def.api_slug!, type: def.type ?? 'text', writable: def.is_writable !== false };
        if (def.type === 'select' || def.type === 'status') {
          const res = await attioRequest<{ data?: Array<{ title?: string; is_archived?: boolean }> }>(auth, `/objects/${ATTIO_OBJECT[object]}/attributes/${def.api_slug}/${def.type === 'status' ? 'statuses' : 'options'}`);
          if (res.ok) {
            field.options = (res.data?.data ?? []).filter(o => !o.is_archived && o.title).map(o => o.title!);
          }
        }
        out.push(field);
      }
      return out;
    },

    async updateRecord(object, id, values) {
      const recordId = attioId(id);
      const keys = Object.keys(values);
      if (keys.length === 0) {
        throw new Error('Name at least one field to set.');
      }
      for (const key of keys) {
        if (!ATTRIBUTE_SLUG.test(key)) {
          throw new Error(`${key} is not an Attio attribute slug. List them with crm_list_fields.`);
        }
      }
      const before = await raw(object, recordId);
      const previous: Record<string, CrmFieldValue> = Object.fromEntries(keys.map(key => [key, currentScalar(before.values?.[key])]));
      // An empty value is cleared with an empty list.
      const write = Object.fromEntries(keys.map(key => [key, values[key] === null ? [] : values[key]]));
      const updated = orThrow(await attioRequest<{ data?: AttioRecord }>(auth, `/objects/${ATTIO_OBJECT[object]}/records/${recordId}`, { method: 'PATCH', json: { data: { values: write } } })).data;
      return { previous, url: updated?.web_url ?? before.web_url ?? null };
    },

    async addNote(object, id, note) {
      const recordId = attioId(id);
      const title = (note.title ?? note.text.split('\n')[0] ?? 'Note').slice(0, 200) || 'Note';
      const created = orThrow(await attioRequest<{ data?: { id?: { note_id?: string } } }>(auth, '/notes', {
        method: 'POST',
        json: { data: { parent_object: ATTIO_OBJECT[object], parent_record_id: recordId, title, format: 'plaintext', content: note.text } },
      })).data;
      const noteId = created?.id?.note_id;
      if (!noteId) {
        throw new Error('Attio did not say which note it created.');
      }
      const parent = await attioRequest<{ data?: AttioRecord }>(auth, `/objects/${ATTIO_OBJECT[object]}/records/${recordId}`);
      return { id: noteId, url: parent.ok ? parent.data?.data?.web_url ?? null : null };
    },

    async deleteNote(id) {
      orThrow(await attioRequest(auth, `/notes/${attioId(id)}`, { method: 'DELETE' }));
    },
  };
}
