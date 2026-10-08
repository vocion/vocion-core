/**
 * Shared Pipedrive client — the one place that knows how to reach a Pipedrive
 * company. The `pipedrive` connector's sync and Test connection and the CRM
 * family's provider (`services/crm/providers/pipedrive.ts`) go through it.
 *
 * Auth is a personal API token (Settings → Personal preferences → API), sent
 * as the `x-api-token` header — never in the query string, where it would
 * land in access logs. It acts as the person who owns it and sees what they
 * see.
 *
 * Records come from API v2 (`/api/v2/deals`, `persons`, `organizations`,
 * `activities`): cursor pagination, an `updated_since` filter for incremental
 * syncs. Notes, users and the field definitions are still v1 endpoints.
 * Pipedrive rate-limits per token; a 429 waits out `Retry-After`
 * (`vendorFetch.ts`).
 */

import type { VendorResult } from '@/libs/connectors/vendorFetch';
import type { CrmActivity, CrmFieldValue, CrmObject, CrmRecord } from '@/services/crm/provider';
import { credentialString, vendorRequest } from '@/libs/connectors/vendorFetch';
import { htmlToText } from '@/libs/surfaces/email';

export const PIPEDRIVE_API = 'https://api.pipedrive.com';

export type PipedriveAuth = { token: string; baseUrl: string };

const AUTH_HINT = 'Paste a current API token (Pipedrive → Settings → Personal preferences → API) on the Connectors page.';

/**
 * The stored token, or the reason there is none.
 * @param bag - The decrypted credential bag (`token`).
 * @param baseUrl - The API origin; Pipedrive's own unless a test points elsewhere.
 */
export function pipedriveAuthFrom(bag: Record<string, unknown> | undefined | null, baseUrl: string = PIPEDRIVE_API): { ok: true; auth: PipedriveAuth } | { ok: false; message: string } {
  const token = credentialString(bag, 'token');
  if (!token) {
    return { ok: false, message: `No Pipedrive API token is stored. ${AUTH_HINT}` };
  }
  return { ok: true, auth: { token, baseUrl: baseUrl.replace(/\/+$/, '') } };
}

/**
 * One call against Pipedrive. `path` starts with `/api/v2/` or `/v1/`.
 * @param auth - The token.
 * @param path - The path.
 * @param opts - Method, query and body.
 * @param opts.method - The HTTP method.
 * @param opts.query - Query parameters; empty ones are dropped.
 * @param opts.json - A JSON body.
 */
export async function pdRequest<T>(auth: PipedriveAuth, path: string, opts: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; query?: Record<string, string | number | undefined | null>; json?: unknown } = {}): Promise<VendorResult<T>> {
  const url = new URL(`${auth.baseUrl}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  return vendorRequest<T>({ vendor: 'Pipedrive', url: url.toString(), method: opts.method, json: opts.json, headers: { 'x-api-token': auth.token }, authHint: AUTH_HINT });
}

/** Pipedrive's envelope on every answer. */
export type PdEnvelope<T> = { success?: boolean; data?: T; additional_data?: { next_cursor?: string | null; pagination?: { more_items_in_collection?: boolean; next_start?: number } } };

/** The v2 collection behind each family object. */
export const PD_COLLECTION: Record<CrmObject, 'organizations' | 'persons' | 'deals'> = { account: 'organizations', contact: 'persons', deal: 'deals' };
/** The singular a Pipedrive page link and a note's parent key use. */
export const PD_SINGULAR: Record<CrmObject, 'organization' | 'person' | 'deal'> = { account: 'organization', contact: 'person', deal: 'deal' };
/** The key a note or an activity names its parent by. */
export const PD_PARENT_KEY: Record<CrmObject, 'org_id' | 'person_id' | 'deal_id'> = { account: 'org_id', contact: 'person_id', deal: 'deal_id' };

/**
 * Every page of a v2 collection, following `next_cursor`.
 * @param auth - The token.
 * @param collection - `deals`, `persons`, `organizations`, `activities`.
 * @param query - Filters, e.g. `updated_since`.
 * @yields {T[]} Each page of rows.
 */
export async function* pdPages<T>(auth: PipedriveAuth, collection: string, query: Record<string, string | number | undefined> = {}): AsyncIterable<T[]> {
  let cursor: string | undefined;
  do {
    const res = await pdRequest<PdEnvelope<T[]>>(auth, `/api/v2/${collection}`, { query: { limit: 500, ...query, cursor } });
    if (!res.ok) {
      throw new Error(res.message);
    }
    yield res.data?.data ?? [];
    cursor = res.data?.additional_data?.next_cursor ?? undefined;
  } while (cursor);
}

/** Who the token is, and the company's subdomain its links live under. */
export type PdMe = { id?: number; name?: string; email?: string; company_name?: string; company_domain?: string };

/**
 * The token's owner, for Test connection and for record links.
 * @param auth - The token.
 */
export async function readPipedriveMe(auth: PipedriveAuth): Promise<VendorResult<PdMe>> {
  const res = await pdRequest<PdEnvelope<PdMe>>(auth, '/v1/users/me');
  return res.ok ? { ok: true, status: res.status, data: res.data?.data ?? {} } : res;
}

/**
 * A record's page on Pipedrive, or null without the company's subdomain.
 * @param companyDomain - The subdomain, from `users/me`.
 * @param object - The object.
 * @param id - The record id.
 */
export function pipedriveUrl(companyDomain: string | null | undefined, object: CrmObject, id: string | number): string | null {
  return companyDomain ? `https://${companyDomain}.pipedrive.com/${PD_SINGULAR[object]}/${id}` : null;
}

/** Names that resolve a v2 record's numeric references. */
export type PdLookups = {
  companyDomain: string | null;
  users: Map<number, string>;
  orgs: Map<number, string>;
  stages: Map<number, { name: string; pipeline: string | null }>;
};

/**
 * The users, stages and pipelines a record's ids point at — three requests.
 * Organization names start empty and fill as organizations are read.
 * @param auth - The token.
 * @param companyDomain - The subdomain, when already known.
 */
export async function loadPipedriveLookups(auth: PipedriveAuth, companyDomain: string | null): Promise<PdLookups> {
  const users = new Map<number, string>();
  const stages = new Map<number, { name: string; pipeline: string | null }>();
  const usersRes = await pdRequest<PdEnvelope<Array<{ id: number; name?: string; email?: string }>>>(auth, '/v1/users');
  for (const u of usersRes.ok ? usersRes.data?.data ?? [] : []) {
    users.set(u.id, u.name ?? u.email ?? String(u.id));
  }
  const pipelines = new Map<number, string>();
  const pipelinesRes = await pdRequest<PdEnvelope<Array<{ id: number; name?: string }>>>(auth, '/api/v2/pipelines');
  for (const p of pipelinesRes.ok ? pipelinesRes.data?.data ?? [] : []) {
    pipelines.set(p.id, p.name ?? String(p.id));
  }
  const stagesRes = await pdRequest<PdEnvelope<Array<{ id: number; name?: string; pipeline_id?: number }>>>(auth, '/api/v2/stages');
  for (const s of stagesRes.ok ? stagesRes.data?.data ?? [] : []) {
    stages.set(s.id, { name: s.name ?? String(s.id), pipeline: s.pipeline_id ? pipelines.get(s.pipeline_id) ?? null : null });
  }
  return { companyDomain, users, orgs: new Map(), stages };
}

export type PdRow = Record<string, unknown> & { id: number };

function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

function int(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Every scalar field of a row, custom fields included, by API key.
 * @param row - The v2 row.
 */
function scalarFields(row: Record<string, unknown>): Record<string, CrmFieldValue> {
  const out: Record<string, CrmFieldValue> = {};
  const custom = row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields as Record<string, unknown> : {};
  for (const [k, v] of [...Object.entries(row), ...Object.entries(custom)]) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = v as CrmFieldValue;
    }
  }
  return out;
}

/**
 * The primary (else first) email of a v2 person.
 * @param row - The person.
 */
function primaryEmail(row: Record<string, unknown>): string | null {
  const emails = Array.isArray(row.emails) ? row.emails as Array<{ value?: string; primary?: boolean }> : [];
  return (emails.find(e => e.primary) ?? emails[0])?.value ?? null;
}

/**
 * A v2 row as a family record.
 * @param object - Which object the row is.
 * @param row - The row.
 * @param lookups - Names for its ids.
 */
export function toPipedriveRecord(object: CrmObject, row: PdRow, lookups: PdLookups): CrmRecord {
  const ownerId = int(row, 'owner_id');
  const orgId = int(row, 'org_id');
  const base: CrmRecord = {
    object,
    id: String(row.id),
    name: str(row, object === 'deal' ? 'title' : 'name') ?? `${object} ${row.id}`,
    url: pipedriveUrl(lookups.companyDomain, object, row.id),
    owner: ownerId !== null ? lookups.users.get(ownerId) ?? String(ownerId) : null,
    created: str(row, 'add_time'),
    updated: str(row, 'update_time'),
    fields: scalarFields(row),
  };
  const account = orgId !== null ? { id: String(orgId), name: lookups.orgs.get(orgId) ?? null } : null;
  if (object === 'account') {
    const address = row.address && typeof row.address === 'object' ? str(row.address as Record<string, unknown>, 'value') : null;
    return { ...base, fields: { ...base.fields, ...(address ? { address } : {}) } };
  }
  if (object === 'contact') {
    return { ...base, email: primaryEmail(row), title: str(row, 'job_title'), account };
  }
  const stageId = int(row, 'stage_id');
  const stage = stageId !== null ? lookups.stages.get(stageId) : undefined;
  const status = str(row, 'status');
  return {
    ...base,
    account,
    stage: stage ? stage.name : null,
    amount: int(row, 'value'),
    currency: str(row, 'currency'),
    closeDate: str(row, 'expected_close_date') ?? str(row, 'close_time'),
    open: status ? status === 'open' : null,
    fields: { ...base.fields, ...(stage?.pipeline ? { pipeline: stage.pipeline } : {}) },
  };
}

/**
 * The family object an activity or note hangs off, and its id.
 * @param row - The activity or note.
 */
function parentOf(row: Record<string, unknown>): { object: CrmObject; id: string } | null {
  for (const object of ['deal', 'contact', 'account'] as const) {
    const id = int(row, PD_PARENT_KEY[object]);
    if (id !== null) {
      return { object, id: String(id) };
    }
  }
  return null;
}

/**
 * A v2 activity as a family activity.
 * @param row - The activity.
 * @param lookups - Names for its ids.
 */
export function toPipedriveActivity(row: PdRow, lookups: PdLookups): CrmActivity {
  const ownerId = int(row, 'owner_id');
  const parent = parentOf(row);
  const due = str(row, 'due_date');
  return {
    id: `activity-${row.id}`,
    kind: str(row, 'type') ?? 'activity',
    subject: str(row, 'subject') ?? '',
    body: htmlToText(str(row, 'note') ?? str(row, 'public_description') ?? ''),
    when: due ? `${due}${str(row, 'due_time') ? `T${str(row, 'due_time')}` : ''}` : str(row, 'add_time'),
    done: typeof row.done === 'boolean' ? row.done : null,
    owner: ownerId !== null ? lookups.users.get(ownerId) ?? String(ownerId) : null,
    on: parent ? { ...parent, name: parent.object === 'account' ? lookups.orgs.get(Number(parent.id)) ?? null : null } : null,
    updated: str(row, 'update_time'),
  };
}

/**
 * A v1 timestamp (`2026-10-01 12:34:56`, UTC) as ISO; an ISO one as it is.
 * @param value - The timestamp as Pipedrive wrote it.
 */
export function pdTime(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
}

/**
 * A v1 note as a family activity.
 * @param row - The note.
 */
export function toPipedriveNote(row: PdRow): CrmActivity {
  const parent = parentOf(row);
  const user = row.user && typeof row.user === 'object' ? str(row.user as Record<string, unknown>, 'name') : null;
  return {
    id: `note-${row.id}`,
    kind: 'note',
    subject: '',
    body: htmlToText(str(row, 'content') ?? ''),
    when: pdTime(str(row, 'add_time')),
    done: null,
    owner: user,
    on: parent ? { ...parent, name: null } : null,
    updated: pdTime(str(row, 'update_time')),
  };
}
