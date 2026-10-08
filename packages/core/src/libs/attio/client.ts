/**
 * Shared Attio client — the one place that knows how to reach an Attio
 * workspace. The `attio` connector's sync and Test connection and the CRM
 * family's provider (`services/crm/providers/attio.ts`) go through it.
 *
 * Auth is a workspace API key (Workspace settings → Developers → access
 * token), sent as a Bearer token. Its scopes decide what it reads: records
 * and object configuration read for the sync, read-write and note read-write
 * for the actions.
 *
 * Attio stores every attribute as a list of values, each with the moment it
 * became current (`active_from`). A record has no last-modified stamp of its
 * own, so the newest `active_from` stands in for one, and a value is read by
 * its attribute type (`attributeText`), so a custom attribute reads as well
 * as a built-in one.
 */

import type { VendorResult } from '@/libs/connectors/vendorFetch';
import type { CrmActivity, CrmFieldValue, CrmObject, CrmRecord } from '@/services/crm/provider';
import { credentialString, vendorRequest } from '@/libs/connectors/vendorFetch';

export const ATTIO_API = 'https://api.attio.com/v2';

export type AttioAuth = { token: string; baseUrl: string };

const AUTH_HINT = 'Paste a current Attio access token (Workspace settings → Developers) with record and object-configuration read access, on the Connectors page.';

/** The Attio object behind each family object. */
export const ATTIO_OBJECT: Record<CrmObject, 'companies' | 'people' | 'deals'> = { account: 'companies', contact: 'people', deal: 'deals' };

/**
 * The stored key, or the reason there is none.
 * @param bag - The decrypted credential bag (`token`).
 * @param baseUrl - The API origin.
 */
export function attioAuthFrom(bag: Record<string, unknown> | undefined | null, baseUrl: string = ATTIO_API): { ok: true; auth: AttioAuth } | { ok: false; message: string } {
  const token = credentialString(bag, 'token');
  if (!token) {
    return { ok: false, message: `No Attio access token is stored. ${AUTH_HINT}` };
  }
  return { ok: true, auth: { token, baseUrl: baseUrl.replace(/\/+$/, '') } };
}

/**
 * One call against Attio. `path` starts with `/` under `/v2`.
 * @param auth - The key.
 * @param path - The path.
 * @param opts - Method, query and body.
 * @param opts.method - The HTTP method.
 * @param opts.query - Query parameters; empty ones dropped.
 * @param opts.json - A JSON body.
 */
export async function attioRequest<T>(auth: AttioAuth, path: string, opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; query?: Record<string, string | number | undefined>; json?: unknown } = {}): Promise<VendorResult<T>> {
  const url = new URL(`${auth.baseUrl}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  return vendorRequest<T>({ vendor: 'Attio', url: url.toString(), method: opts.method, json: opts.json, headers: { authorization: `Bearer ${auth.token}` }, authHint: AUTH_HINT });
}

/** One stored value of an attribute. */
export type AttioValue = Record<string, unknown> & { attribute_type?: string; active_from?: string; active_until?: string | null };

export type AttioRecord = {
  id: { record_id: string; object_id?: string; workspace_id?: string };
  created_at?: string;
  web_url?: string;
  values?: Record<string, AttioValue[]>;
};

/**
 * Every record of an object, page by page (500 a page, by offset).
 * @param auth - The key.
 * @param object - `companies`, `people`, `deals`.
 * @yields {AttioRecord[]} Each page of records.
 */
export async function* attioRecordPages(auth: AttioAuth, object: string): AsyncIterable<AttioRecord[]> {
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const res = await attioRequest<{ data?: AttioRecord[] }>(auth, `/objects/${object}/records/query`, { method: 'POST', json: { limit, offset } });
    if (!res.ok) {
      throw new Error(res.message);
    }
    const page = res.data?.data ?? [];
    yield page;
    if (page.length < limit) {
      return;
    }
  }
}

/**
 * Who the key belongs to: the workspace and whether it is live.
 * @param auth - The key.
 */
export async function readAttioSelf(auth: AttioAuth): Promise<VendorResult<{ active?: boolean; workspace_name?: string; workspace_slug?: string; scope?: string }>> {
  return attioRequest(auth, '/self');
}

/**
 * One value as text, whatever its attribute type.
 * @param v - The value.
 */
export function attributeText(v: AttioValue | undefined): string | null {
  if (!v) {
    return null;
  }
  const s = (key: string): string | null => (typeof v[key] === 'string' && v[key] !== '' ? v[key] as string : null);
  switch (v.attribute_type) {
    case 'personal-name':
      return s('full_name') ?? ([s('first_name'), s('last_name')].filter(Boolean).join(' ') || null);
    case 'email-address':
      return s('email_address');
    case 'domain':
      return s('domain');
    case 'phone-number':
      return s('original_phone_number') ?? s('phone_number');
    case 'currency':
      return typeof v.currency_value === 'number' ? String(v.currency_value) : null;
    case 'select':
      return v.option && typeof v.option === 'object' ? (v.option as { title?: string }).title ?? null : null;
    case 'status':
      return v.status && typeof v.status === 'object' ? (v.status as { title?: string }).title ?? null : null;
    case 'record-reference':
      return s('target_record_id');
    case 'actor-reference':
      return s('referenced_actor_id');
    case 'location':
      return [s('line_1'), s('locality'), s('region'), s('country_code')].filter(Boolean).join(', ') || null;
    case 'interaction':
      return s('interacted_at');
    default:
      return typeof v.value === 'string' || typeof v.value === 'number' || typeof v.value === 'boolean' ? String(v.value) : null;
  }
}

/**
 * The value an attribute holds now as a scalar the tools show and the update
 * action can write back: a number stays a number, a checkbox a boolean.
 * @param values - The attribute's values.
 */
export function currentScalar(values: AttioValue[] | undefined): CrmFieldValue {
  const v = values?.find(x => !x.active_until) ?? values?.[0];
  if (!v) {
    return null;
  }
  if (v.attribute_type === 'currency' && typeof v.currency_value === 'number') {
    return v.currency_value;
  }
  if ((v.attribute_type === 'number' || v.attribute_type === 'rating') && typeof v.value === 'number') {
    return v.value;
  }
  if (v.attribute_type === 'checkbox' && typeof v.value === 'boolean') {
    return v.value;
  }
  return attributeText(v);
}

function first(record: AttioRecord, attr: string): string | null {
  return attributeText(record.values?.[attr]?.find(x => !x.active_until) ?? record.values?.[attr]?.[0]);
}

/**
 * When a record last changed: the newest moment one of its values became current.
 * @param record - The record.
 */
function lastChanged(record: AttioRecord): string | null {
  let newest: string | null = null;
  for (const values of Object.values(record.values ?? {})) {
    for (const v of values) {
      if (typeof v.active_from === 'string' && (!newest || v.active_from > newest)) {
        newest = v.active_from;
      }
    }
  }
  return newest ?? record.created_at ?? null;
}

/** Names for the ids a record points at. */
export type AttioLookups = { members: Map<string, string>; companies: Map<string, string> };

/**
 * The workspace members, by id, for owners. One request.
 * @param auth - The key.
 */
export async function loadAttioLookups(auth: AttioAuth): Promise<AttioLookups> {
  const members = new Map<string, string>();
  const res = await attioRequest<{ data?: Array<{ id?: { workspace_member_id?: string }; first_name?: string; last_name?: string; email_address?: string }> }>(auth, '/workspace_members');
  for (const m of res.ok ? res.data?.data ?? [] : []) {
    const id = m.id?.workspace_member_id;
    if (id) {
      members.set(id, [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email_address || id);
    }
  }
  return { members, companies: new Map() };
}

/**
 * An Attio record as a family record.
 * @param object - Which object it is.
 * @param record - The record.
 * @param lookups - Names for its references.
 */
export function toAttioRecord(object: CrmObject, record: AttioRecord, lookups: AttioLookups): CrmRecord {
  const fields: Record<string, CrmFieldValue> = {};
  for (const [slug, values] of Object.entries(record.values ?? {})) {
    fields[slug] = currentScalar(values);
  }
  const ownerId = first(record, 'owner');
  const base: CrmRecord = {
    object,
    id: record.id.record_id,
    name: first(record, 'name') ?? `${object} ${record.id.record_id}`,
    url: record.web_url ?? null,
    owner: ownerId ? lookups.members.get(ownerId) ?? ownerId : null,
    created: record.created_at ?? null,
    updated: lastChanged(record),
    fields,
  };
  if (object === 'account') {
    return { ...base, domain: first(record, 'domains'), description: first(record, 'description'), industry: first(record, 'categories') };
  }
  if (object === 'contact') {
    const companyId = first(record, 'company');
    return { ...base, email: first(record, 'email_addresses'), title: first(record, 'job_title'), account: companyId ? { id: companyId, name: lookups.companies.get(companyId) ?? null } : null };
  }
  const companyId = first(record, 'associated_company');
  const value = record.values?.value?.find(x => !x.active_until) ?? record.values?.value?.[0];
  return {
    ...base,
    account: companyId ? { id: companyId, name: lookups.companies.get(companyId) ?? null } : null,
    stage: first(record, 'stage'),
    amount: typeof value?.currency_value === 'number' ? value.currency_value : null,
    currency: typeof value?.currency_code === 'string' ? value.currency_code : null,
    // Attio's deal stages carry no won/lost category, so whether a deal is open is not knowable here.
    open: null,
  };
}

/** A note as Attio lists it. */
export type AttioNote = { id?: { note_id?: string }; parent_object?: string; parent_record_id?: string; title?: string; content_plaintext?: string; created_at?: string; created_by_actor?: { id?: string | null } };

const FAMILY_OF: Record<string, CrmObject> = { companies: 'account', people: 'contact', deals: 'deal' };

/**
 * An Attio note as a family activity.
 * @param note - The note.
 * @param lookups - Names for its author.
 */
export function toAttioNote(note: AttioNote, lookups: AttioLookups): CrmActivity {
  const author = note.created_by_actor?.id ?? null;
  return {
    id: note.id?.note_id ?? '',
    kind: 'note',
    subject: note.title ?? '',
    body: note.content_plaintext ?? '',
    when: note.created_at ?? null,
    done: null,
    owner: author ? lookups.members.get(author) ?? null : null,
    on: note.parent_record_id ? { object: FAMILY_OF[note.parent_object ?? ''] ?? null, id: note.parent_record_id, name: null } : null,
    updated: note.created_at ?? null,
  };
}
