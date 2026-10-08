/**
 * Shared Salesforce REST client — the one place that knows how to reach a
 * Salesforce org. The `salesforce` connector's sync and Test connection and
 * the CRM family's provider (`services/crm/providers/salesforce.ts`) all go
 * through it, so the auth, the instance URL, the SOQL quoting and the record
 * mapping exist exactly once.
 *
 * Two credentials reach it, both stored under the `salesforce` platform:
 *
 *   - a LOGIN (`Connect with Salesforce`): `{ accessToken, refreshToken,
 *     expiresAt, instanceUrl }`, refreshed through `usableLoginGrant` when it
 *     is expiring and saved back to the source's row;
 *   - a pasted CLIENT-CREDENTIALS app: `{ instanceUrl, clientId, clientSecret }`
 *     — a connected app in the customer's own org with the client credentials
 *     flow on and a run-as user. It works with no OAuth app registered on this
 *     server, so it is how a workspace connects Salesforce today. A token is
 *     minted from it per need and kept in memory, keyed by the exact client,
 *     until it is ten minutes old.
 *
 * Errors are data (`VendorResult`), as every family client has them. Ids and
 * field names are checked for shape before they go into SOQL, and every
 * string a person typed is quoted (`soqlLiteral`), so nothing an agent says
 * can change a query's meaning.
 */

import type { GrantPersistence } from '@/libs/connect/loginGrant';
import type { VendorResult } from '@/libs/connectors/vendorFetch';
import type { CrmActivity, CrmFieldValue, CrmObject, CrmRecord } from '@/services/crm/provider';
import { createHash } from 'node:crypto';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshSalesforceGrant } from '@/libs/connect/providers/salesforce';
import { credentialString, vendorRequest } from '@/libs/connectors/vendorFetch';

export const SALESFORCE_API_VERSION = 'v61.0';

/** Where calls go and as whom. */
export type SalesforceAuth = { accessToken: string; instanceUrl: string; apiVersion: string };

const AUTH_HINT = 'Reconnect Salesforce on the Connectors page: log in again, or check the pasted app\'s consumer key and secret and that its client credentials flow has a run-as user.';

/** A client-credentials token, kept until it is this old. */
const CLIENT_TOKEN_TTL_MS = 10 * 60_000;
const clientTokens = new Map<string, { token: string; instanceUrl: string; at: number }>();

/**
 * A Salesforce instance or My Domain URL trimmed to its origin, or null when
 * it is not an https address.
 * @param raw - As typed or stored.
 */
export function normalizeInstanceUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/i.test(trimmed) ? trimmed : null;
}

/**
 * Mint a token from a pasted client-credentials app, cached by the exact
 * client so one org's token never answers for another's.
 * @param input - The app.
 * @param input.instanceUrl - The org's My Domain URL.
 * @param input.clientId - The consumer key.
 * @param input.clientSecret - The consumer secret.
 */
async function clientCredentialsToken(input: { instanceUrl: string; clientId: string; clientSecret: string }): Promise<{ token: string; instanceUrl: string }> {
  const key = createHash('sha256').update(`${input.instanceUrl}\n${input.clientId}\n${input.clientSecret}`).digest('hex');
  const cached = clientTokens.get(key);
  if (cached && Date.now() - cached.at < CLIENT_TOKEN_TTL_MS) {
    return cached;
  }
  const res = await vendorRequest<{ access_token?: string; instance_url?: string }>({
    vendor: 'Salesforce',
    url: `${input.instanceUrl}/services/oauth2/token`,
    method: 'POST',
    form: { grant_type: 'client_credentials', client_id: input.clientId, client_secret: input.clientSecret },
    retries: 1,
  });
  if (!res.ok) {
    throw new Error(`Salesforce would not issue a token for the pasted app (${res.message}) ${AUTH_HINT}`);
  }
  const token = res.data?.access_token;
  if (!token) {
    throw new Error(`Salesforce answered without an access token. ${AUTH_HINT}`);
  }
  const entry = { token, instanceUrl: normalizeInstanceUrl(res.data?.instance_url ?? '') ?? input.instanceUrl, at: Date.now() };
  clientTokens.set(key, entry);
  return entry;
}

/**
 * Where to call and with what, from a stored credential, or null when the bag
 * holds neither a login nor a client-credentials app.
 * @param credentials - The decrypted bag.
 * @param persistence - Where a refreshed login is saved, or `never`.
 * @param apiVersion - The REST version to call.
 * @throws {Error} When the login cannot be refreshed or the app is refused, with the sentence that names the fix.
 */
export async function resolveSalesforceAuth(credentials: Record<string, unknown> | undefined, persistence: GrantPersistence, apiVersion: string = SALESFORCE_API_VERSION): Promise<SalesforceAuth | null> {
  if (isLoginGrant(credentials)) {
    const instanceUrl = normalizeInstanceUrl(credentialString(credentials, 'instanceUrl'));
    if (!instanceUrl) {
      throw new Error('This Salesforce login has no instance URL. Log in with Salesforce again on the Connectors page.');
    }
    const grant = await usableLoginGrant({ vendor: 'Salesforce', provider: 'salesforce', connectorSlug: 'salesforce', grant: credentials, persistence, refresh: refreshSalesforceGrant });
    return { accessToken: grant.accessToken, instanceUrl, apiVersion };
  }
  const instanceUrl = normalizeInstanceUrl(credentialString(credentials, 'instanceUrl'));
  const clientId = credentialString(credentials, 'clientId');
  const clientSecret = credentialString(credentials, 'clientSecret');
  if (!clientId && !clientSecret) {
    return null;
  }
  if (!instanceUrl || !clientId || !clientSecret) {
    throw new Error('The pasted Salesforce app needs all three values: the My Domain URL (https://<domain>.my.salesforce.com), the consumer key and the consumer secret.');
  }
  const minted = await clientCredentialsToken({ instanceUrl, clientId, clientSecret });
  return { accessToken: minted.token, instanceUrl: minted.instanceUrl, apiVersion };
}

/**
 * One REST call against the org. `path` is under `/services/data/<version>`
 * unless it already starts with `/services/` (a `nextRecordsUrl`).
 * @param auth - Where and as whom.
 * @param path - The path, starting with `/`.
 * @param opts - Method and body.
 * @param opts.method - The HTTP method.
 * @param opts.json - A JSON body.
 */
export async function sfRequest<T>(auth: SalesforceAuth, path: string, opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; json?: unknown } = {}): Promise<VendorResult<T>> {
  const url = path.startsWith('/services/') ? `${auth.instanceUrl}${path}` : `${auth.instanceUrl}/services/data/${auth.apiVersion}${path}`;
  return vendorRequest<T>({ vendor: 'Salesforce', url, method: opts.method, json: opts.json, headers: { authorization: `Bearer ${auth.accessToken}` }, authHint: AUTH_HINT });
}

type QueryPage<R> = { totalSize?: number; done?: boolean; records?: R[]; nextRecordsUrl?: string };

/**
 * Every record a SOQL query returns, following `nextRecordsUrl`, up to `max`.
 * @param auth - Where and as whom.
 * @param soql - The query; every literal in it already quoted.
 * @param max - Stop after this many records.
 */
export async function soqlAll<R>(auth: SalesforceAuth, soql: string, max = Number.POSITIVE_INFINITY): Promise<VendorResult<R[]>> {
  const out: R[] = [];
  let next: string | undefined = `/query?q=${encodeURIComponent(soql)}`;
  while (next && out.length < max) {
    const res: VendorResult<QueryPage<R>> = await sfRequest<QueryPage<R>>(auth, next);
    if (!res.ok) {
      return res;
    }
    out.push(...(res.data.records ?? []));
    next = res.data.done === false ? res.data.nextRecordsUrl : undefined;
  }
  return { ok: true, status: 200, data: out.slice(0, Number.isFinite(max) ? max : undefined) };
}

/**
 * Walk a SOQL query page by page, for a sync that yields as it goes.
 * @param auth - Where and as whom.
 * @param soql - The query.
 * @yields {R[]} Each page of rows.
 */
export async function* soqlPages<R>(auth: SalesforceAuth, soql: string): AsyncIterable<R[]> {
  let next: string | undefined = `/query?q=${encodeURIComponent(soql)}`;
  while (next) {
    const res: VendorResult<QueryPage<R>> = await sfRequest<QueryPage<R>>(auth, next);
    if (!res.ok) {
      throw new Error(res.message);
    }
    yield res.data.records ?? [];
    next = res.data.done === false ? res.data.nextRecordsUrl : undefined;
  }
}

/**
 * A string as a SOQL literal: quoted, with backslash and quote escaped.
 * @param value - Any text.
 */
export function soqlLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

/**
 * Words as a SOQL `LIKE` pattern matching them anywhere: `%` and `_` in the
 * words match themselves.
 * @param words - What a person is looking for.
 */
export function soqlContains(words: string): string {
  const escaped = words.trim().replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `'%${escaped}%'`;
}

/**
 * A date as SOQL wants a dateTime literal: ISO, seconds, Z, unquoted.
 * @param at - The moment.
 */
export function soqlDateTime(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const SALESFORCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const FIELD_NAME = /^[a-z]\w{0,79}$/i;

/**
 * Whether a string is the shape of a Salesforce record id (15 or 18 letters and digits).
 * @param id - Candidate id.
 */
export function isSalesforceId(id: string): boolean {
  return SALESFORCE_ID.test(id);
}

/**
 * The id, or a thrown sentence when it is not one.
 * @param id - Candidate id.
 */
export function salesforceId(id: string): string {
  const trimmed = id.trim();
  if (!isSalesforceId(trimmed)) {
    throw new Error(`${id} is not a Salesforce record id (15 or 18 letters and digits, e.g. 001XXXXXXXXXXXXAAA). Find the record with crm_search_records first.`);
  }
  return trimmed;
}

/**
 * The field name, or a thrown sentence when it is not one.
 * @param name - Candidate API name, e.g. `StageName` or `Region__c`.
 */
export function salesforceFieldName(name: string): string {
  if (!FIELD_NAME.test(name)) {
    throw new Error(`${name} is not a Salesforce field API name. List them with crm_list_fields.`);
  }
  return name;
}

/** The sObject behind each family object. */
export const SOBJECT: Record<CrmObject, string> = { account: 'Account', contact: 'Contact', deal: 'Opportunity' };

/** What a read selects for each object. */
export const SELECT_FIELDS: Record<CrmObject, readonly string[]> = {
  account: ['Id', 'Name', 'Website', 'Industry', 'Type', 'Description', 'NumberOfEmployees', 'AnnualRevenue', 'BillingCity', 'BillingCountry', 'OwnerId', 'Owner.Name', 'CreatedDate', 'LastModifiedDate'],
  contact: ['Id', 'Name', 'FirstName', 'LastName', 'Email', 'Title', 'Department', 'AccountId', 'Account.Name', 'OwnerId', 'Owner.Name', 'CreatedDate', 'LastModifiedDate'],
  deal: ['Id', 'Name', 'StageName', 'Amount', 'CloseDate', 'Probability', 'IsClosed', 'IsWon', 'Type', 'NextStep', 'LeadSource', 'Description', 'AccountId', 'Account.Name', 'OwnerId', 'Owner.Name', 'CreatedDate', 'LastModifiedDate'],
};

export const TASK_FIELDS = ['Id', 'Subject', 'Description', 'Status', 'IsClosed', 'ActivityDate', 'TaskSubtype', 'WhoId', 'Who.Name', 'WhatId', 'What.Name', 'AccountId', 'OwnerId', 'Owner.Name', 'CreatedDate', 'LastModifiedDate'] as const;
export const EVENT_FIELDS = ['Id', 'Subject', 'Description', 'StartDateTime', 'EndDateTime', 'Location', 'WhoId', 'Who.Name', 'WhatId', 'What.Name', 'AccountId', 'OwnerId', 'Owner.Name', 'CreatedDate', 'LastModifiedDate'] as const;

export type SfRow = Record<string, unknown> & { Id: string };

function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

function rel(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return v && typeof v === 'object' ? str(v as Record<string, unknown>, 'Name') : null;
}

function num(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The domain of a website, without scheme or `www.`.
 * @param website - As stored on the account.
 */
function domainOf(website: string | null): string | null {
  if (!website) {
    return null;
  }
  return website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').toLowerCase() || null;
}

/**
 * A record's page in Lightning.
 * @param instanceUrl - The org.
 * @param sobject - The sObject, e.g. `Account`.
 * @param id - The record id.
 */
export function lightningUrl(instanceUrl: string, sobject: string, id: string): string {
  return `${instanceUrl}/lightning/r/${sobject}/${id}/view`;
}

/**
 * Every scalar field of a row, by API name, for `CrmRecord.fields`.
 * @param row - The SOQL row.
 */
function scalarFields(row: Record<string, unknown>): Record<string, CrmFieldValue> {
  const out: Record<string, CrmFieldValue> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'attributes' || (v !== null && typeof v === 'object')) {
      continue;
    }
    out[k] = v as CrmFieldValue;
  }
  return out;
}

/**
 * A SOQL row as a family record.
 * @param object - Which object the row is.
 * @param row - The row, selected with `SELECT_FIELDS[object]`.
 * @param instanceUrl - The org, for the record's link.
 */
export function toCrmRecord(object: CrmObject, row: SfRow, instanceUrl: string): CrmRecord {
  const accountId = str(row, 'AccountId');
  const base: CrmRecord = {
    object,
    id: row.Id,
    name: str(row, 'Name') ?? [str(row, 'FirstName'), str(row, 'LastName')].filter(Boolean).join(' '),
    url: lightningUrl(instanceUrl, SOBJECT[object], row.Id),
    owner: rel(row, 'Owner'),
    created: str(row, 'CreatedDate'),
    updated: str(row, 'LastModifiedDate'),
    fields: scalarFields(row),
  };
  if (object === 'account') {
    return { ...base, domain: domainOf(str(row, 'Website')), industry: str(row, 'Industry'), description: str(row, 'Description') };
  }
  if (object === 'contact') {
    return { ...base, email: str(row, 'Email'), title: str(row, 'Title'), account: accountId ? { id: accountId, name: rel(row, 'Account') } : null };
  }
  const closed = row.IsClosed;
  return {
    ...base,
    description: str(row, 'Description'),
    account: accountId ? { id: accountId, name: rel(row, 'Account') } : null,
    stage: str(row, 'StageName'),
    amount: num(row, 'Amount'),
    closeDate: str(row, 'CloseDate'),
    open: typeof closed === 'boolean' ? !closed : null,
  };
}

/**
 * The family object an id belongs to, by Salesforce's key prefix.
 * @param id - A WhoId / WhatId.
 */
function objectOfId(id: string | null): CrmObject | null {
  if (!id) {
    return null;
  }
  const prefix = id.slice(0, 3);
  return prefix === '001' ? 'account' : prefix === '003' ? 'contact' : prefix === '006' ? 'deal' : null;
}

/**
 * A Task or Event row as a family activity.
 * @param sobject - `Task` or `Event`.
 * @param row - The row, selected with `TASK_FIELDS` / `EVENT_FIELDS`.
 */
export function toCrmActivity(sobject: 'Task' | 'Event', row: SfRow): CrmActivity {
  const whatId = str(row, 'WhatId');
  const whoId = str(row, 'WhoId');
  const onId = whatId ?? whoId;
  const kind = sobject === 'Event' ? 'event' : (str(row, 'TaskSubtype') ?? 'task').toLowerCase();
  return {
    id: row.Id,
    kind,
    subject: str(row, 'Subject') ?? '',
    body: str(row, 'Description') ?? '',
    when: sobject === 'Event' ? str(row, 'StartDateTime') : (str(row, 'ActivityDate') ?? str(row, 'CreatedDate')),
    done: sobject === 'Task' && typeof row.IsClosed === 'boolean' ? row.IsClosed : null,
    owner: rel(row, 'Owner'),
    on: onId ? { object: objectOfId(onId), id: onId, name: whatId ? rel(row, 'What') : rel(row, 'Who') } : null,
    updated: str(row, 'LastModifiedDate'),
  };
}
