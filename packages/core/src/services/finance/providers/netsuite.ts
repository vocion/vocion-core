/**
 * NETSUITE — the books, as a provider of the finance family (`../types.ts`).
 *
 * Token-based authentication: an integration record's consumer key and
 * secret plus an access token's id and secret, signing every request with
 * OAuth 1.0a HMAC-SHA256 — nothing to refresh, nothing to persist. Read-only:
 * every read is one SuiteQL query.
 *
 * NetSuite facts this file depends on: the REST host is the account id,
 * lower-case with `_` as `-`, under `suitetalk.api.netsuite.com`, and the
 * OAuth `realm` is the account id upper-case with `_`; SuiteQL is
 * `POST /services/rest/query/v1/suiteql?limit=&offset=` with
 * `Prefer: transient` and `{ q }`, answering `{ items, hasMore }`; dates come
 * back in the signing user's format unless `TO_CHAR`'d, so every date is;
 * invoices, bills and customer payments are `transaction` rows of type
 * `CustInvc`, `VendBill` and `CustPymt`. Every query here is built from
 * values this module controls; text is escaped, ids must be digits.
 */

import type { FinanceLine, FinanceListQuery, FinancePage, FinanceProvider, FinanceProviderInput, FinanceRecord, FinanceRecordKind } from '../types';
import { createHmac, randomBytes } from 'node:crypto';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { unsupportedKind } from '../types';

const VENDOR = 'NetSuite';

const KINDS: readonly FinanceRecordKind[] = ['customer', 'vendor', 'invoice', 'bill', 'payment', 'account'];

/** The transaction type of each transaction kind, and its record page. */
const TRANSACTION: Partial<Record<FinanceRecordKind, { type: string; page: string }>> = {
  invoice: { type: 'CustInvc', page: 'custinvc' },
  bill: { type: 'VendBill', page: 'vendbill' },
  payment: { type: 'CustPymt', page: 'custpymt' },
};

export type NetsuiteCredentials = { accountId: string; consumerKey: string; consumerSecret: string; tokenId: string; tokenSecret: string };

/**
 * RFC 3986 percent-encoding, as OAuth 1.0a signs.
 * @param value - The text.
 */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The account's REST host and OAuth realm.
 * @param accountId - As NetSuite shows it (1234567, 1234567_SB1).
 */
export function netsuiteAccount(accountId: string): { host: string; realm: string; appHost: string } {
  const lower = accountId.trim().toLowerCase().replaceAll('_', '-');
  return {
    host: `https://${lower}.suitetalk.api.netsuite.com`,
    appHost: `https://${lower}.app.netsuite.com`,
    realm: accountId.trim().toUpperCase().replaceAll('-', '_'),
  };
}

/**
 * The `Authorization` header for one request: OAuth 1.0a, HMAC-SHA256, the
 * query parameters signed with the oauth ones.
 * @param input - The request and credential.
 * @param input.method - The HTTP method.
 * @param input.url - The full URL, query included.
 * @param input.credentials - The token-based authentication set.
 * @param input.nonce - Injected for tests.
 * @param input.timestamp - Injected for tests (Unix seconds).
 */
export function netsuiteAuthorization(input: { method: string; url: string; credentials: NetsuiteCredentials; nonce?: string; timestamp?: number }): string {
  const c = input.credentials;
  const url = new URL(input.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.consumerKey,
    oauth_nonce: input.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: c.tokenId,
    oauth_version: '1.0',
  };
  const pairs: Array<[string, string]> = [...Object.entries(oauth), ...[...url.searchParams.entries()]].map(([k, v]) => [rfc3986(k), rfc3986(v)]);
  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const base = `${url.origin}${url.pathname}`;
  const baseString = [input.method.toUpperCase(), rfc3986(base), rfc3986(paramString)].join('&');
  const key = `${rfc3986(c.consumerSecret)}&${rfc3986(c.tokenSecret)}`;
  const signature = createHmac('sha256', key).update(baseString).digest('base64');
  const realm = netsuiteAccount(c.accountId).realm;
  const fields = { ...oauth, oauth_signature: signature };
  return `OAuth realm="${realm}", ${Object.entries(fields).map(([k, v]) => `${k}="${rfc3986(v)}"`).join(', ')}`;
}

/**
 * Text as a SuiteQL string literal, lower-cased for a LIKE.
 * @param value - The text.
 */
function likeLiteral(value: string): string {
  return `'%${value.toLowerCase().replaceAll('\'', '\'\'')}%'`;
}

/**
 * An ISO date as a SuiteQL date, refusing anything else.
 * @param iso - The date.
 */
function dateLiteral(iso: string): string {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(iso)) {
    throw new Error(`${iso} is not an ISO date.`);
  }
  return `TO_DATE('${day}', 'YYYY-MM-DD')`;
}

function timestampLiteral(at: Date): string {
  return `TO_TIMESTAMP('${at.toISOString().slice(0, 19).replace('T', ' ')}', 'YYYY-MM-DD HH24:MI:SS')`;
}

const ISO_DAY = '\'YYYY-MM-DD\'';
const ISO_TIME = '\'YYYY-MM-DD"T"HH24:MI:SS\'';

/**
 * The SuiteQL for one page of a kind.
 * @param kind - What to read.
 * @param q - The filters.
 * @param id - One record only, by its internal id.
 */
export function netsuiteQuery(kind: FinanceRecordKind, q: Partial<FinanceListQuery>, id?: string): { sql: string; ignored: string[] } {
  const ignored: string[] = [];
  const where: string[] = [];
  let sql: string;
  const tx = TRANSACTION[kind];
  if (tx) {
    sql = `SELECT t.id, t.tranid, TO_CHAR(t.trandate, ${ISO_DAY}) AS trandate, TO_CHAR(t.duedate, ${ISO_DAY}) AS duedate, BUILTIN.DF(t.status) AS status, t.entity, BUILTIN.DF(t.entity) AS entityname, t.foreigntotal, t.foreignamountremaining, BUILTIN.DF(t.currency) AS currency, TO_CHAR(t.lastmodifieddate, ${ISO_TIME}) AS lastmodified, t.memo FROM transaction t`;
    where.push(`t.type = '${tx.type}'`);
    if (q.query) {
      where.push(`(LOWER(t.tranid) LIKE ${likeLiteral(q.query)} OR LOWER(BUILTIN.DF(t.entity)) LIKE ${likeLiteral(q.query)})`);
    }
    if (q.status) {
      where.push(`LOWER(BUILTIN.DF(t.status)) LIKE ${likeLiteral(q.status)}`);
    }
    if (q.partyId) {
      if (/^\d+$/.test(q.partyId)) {
        where.push(`t.entity = ${q.partyId}`);
      } else {
        ignored.push('party_id');
      }
    }
    if (q.since) {
      where.push(`t.trandate >= ${dateLiteral(q.since)}`);
    }
    if (q.until) {
      where.push(`t.trandate <= ${dateLiteral(q.until)}`);
    }
    if (q.updatedSince) {
      where.push(`t.lastmodifieddate >= ${timestampLiteral(q.updatedSince)}`);
    }
    if (id) {
      where.push(`t.id = ${id}`);
    }
  } else if (kind === 'customer' || kind === 'vendor') {
    sql = `SELECT e.id, e.entityid, e.companyname, e.email, e.isinactive, BUILTIN.DF(e.currency) AS currency, TO_CHAR(e.lastmodifieddate, ${ISO_TIME}) AS lastmodified FROM ${kind} e`;
    if (q.query) {
      where.push(`(LOWER(e.companyname) LIKE ${likeLiteral(q.query)} OR LOWER(e.entityid) LIKE ${likeLiteral(q.query)} OR LOWER(e.email) LIKE ${likeLiteral(q.query)})`);
    }
    if (q.status) {
      where.push(`e.isinactive = '${/^(?:inactive|archived)$/i.test(q.status) ? 'T' : 'F'}'`);
    }
    if (q.updatedSince) {
      where.push(`e.lastmodifieddate >= ${timestampLiteral(q.updatedSince)}`);
    }
    if (q.partyId) {
      ignored.push('party_id');
    }
    if (q.since || q.until) {
      ignored.push('since/until');
    }
    if (id) {
      where.push(`e.id = ${id}`);
    }
  } else if (kind === 'account') {
    sql = 'SELECT a.id, a.acctnumber, a.fullname, BUILTIN.DF(a.accttype) AS accttype, a.isinactive FROM account a';
    if (q.query) {
      where.push(`(LOWER(a.fullname) LIKE ${likeLiteral(q.query)} OR LOWER(a.acctnumber) LIKE ${likeLiteral(q.query)})`);
    }
    if (q.status) {
      where.push(`a.isinactive = '${/^(?:inactive|archived)$/i.test(q.status) ? 'T' : 'F'}'`);
    }
    for (const [name, set] of [['party_id', q.partyId], ['since/until', q.since || q.until]] as const) {
      if (set) {
        ignored.push(name);
      }
    }
    if (id) {
      where.push(`a.id = ${id}`);
    }
  } else {
    throw unsupportedKind(VENDOR, kind, KINDS);
  }
  return { sql: `${sql}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${tx ? 't' : kind === 'account' ? 'a' : 'e'}.id DESC`, ignored };
}

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null;
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * One SuiteQL row as a finance record.
 * @param kind - What it is.
 * @param row - The row (column names lower-case, as SuiteQL returns them).
 * @param appHost - The account's app host, for links.
 */
export function netsuiteRecord(kind: FinanceRecordKind, row: Row, appHost: string): FinanceRecord {
  const id = String(row.id ?? '');
  const base: FinanceRecord = { kind, id, number: null, title: id, party: null, status: null, amount: null, currency: str(row.currency), balance: null, date: null, dueDate: null, updatedAt: str(row.lastmodified) ? `${str(row.lastmodified)}Z` : null, url: null };
  const tx = TRANSACTION[kind];
  if (tx) {
    const number = str(row.tranid);
    const party = str(row.entityname);
    const label = kind === 'invoice' ? 'Invoice' : kind === 'bill' ? 'Bill' : 'Payment';
    return {
      ...base,
      number,
      title: `${label} ${number ?? id}${party ? ` · ${party}` : ''}`,
      party,
      status: str(row.status),
      amount: num(row.foreigntotal),
      balance: kind === 'payment' ? null : num(row.foreignamountremaining),
      date: str(row.trandate),
      dueDate: str(row.duedate),
      url: `${appHost}/app/accounting/transactions/${tx.page}.nl?id=${encodeURIComponent(id)}`,
      details: { memo: str(row.memo), partyId: str(row.entity) },
    };
  }
  if (kind === 'customer' || kind === 'vendor') {
    return {
      ...base,
      number: str(row.entityid),
      title: str(row.companyname) ?? str(row.entityid) ?? id,
      status: row.isinactive === 'T' ? 'inactive' : 'active',
      url: `${appHost}/app/common/entity/${kind === 'customer' ? 'custjob' : 'vendor'}.nl?id=${encodeURIComponent(id)}`,
      details: { email: str(row.email) },
    };
  }
  return {
    ...base,
    number: str(row.acctnumber),
    title: `${str(row.acctnumber) ? `${str(row.acctnumber)} ` : ''}${str(row.fullname) ?? id}`,
    status: row.isinactive === 'T' ? 'inactive' : 'active',
    url: `${appHost}/app/accounting/account/account.nl?id=${encodeURIComponent(id)}`,
    details: { type: str(row.accttype) },
  };
}

/**
 * The credential set out of the vault bag, or why it is incomplete.
 * @param bag - The decrypted credential.
 */
function credentialsFrom(bag: Record<string, unknown>): NetsuiteCredentials {
  const pick = (name: string) => (typeof bag[name] === 'string' ? (bag[name] as string).trim() : '');
  const c = { accountId: pick('accountId'), consumerKey: pick('consumerKey'), consumerSecret: pick('consumerSecret'), tokenId: pick('tokenId'), tokenSecret: pick('tokenSecret') };
  const missing = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`The NetSuite credential is missing ${missing.join(', ')}. An admin pastes the account ID, the integration's consumer key and secret, and the access token's ID and secret on the Connectors page.`);
  }
  return c;
}

/**
 * The provider, over one workspace's NetSuite account. Built per call.
 * @param input - The source and its credential.
 */
export function netsuiteFinanceProvider(input: FinanceProviderInput): FinanceProvider {
  const credentials = credentialsFrom(input.credentials);
  const account = netsuiteAccount(credentials.accountId);

  async function suiteql(sql: string, limit: number, offset: number, what: string): Promise<{ items: Row[]; hasMore: boolean }> {
    const url = `${account.host}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
    const body = await vendorJson<{ items?: Row[]; hasMore?: boolean }>({
      vendor: VENDOR,
      what,
      url,
      fetch: input.fetch,
      init: {
        method: 'POST',
        headers: {
          'authorization': netsuiteAuthorization({ method: 'POST', url, credentials }),
          'content-type': 'application/json',
          'accept': 'application/json',
          'prefer': 'transient',
        },
        body: JSON.stringify({ q: sql }),
      },
    });
    return { items: Array.isArray(body?.items) ? body.items : [], hasMore: body?.hasMore === true };
  }

  async function list(kind: FinanceRecordKind, q: FinanceListQuery): Promise<FinancePage> {
    if (!KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const { sql, ignored } = netsuiteQuery(kind, q);
    const limit = Math.max(1, Math.min(q.limit, 1000));
    const offset = q.cursor?.startsWith('offset:') ? Math.max(0, Number(q.cursor.slice(7)) || 0) : 0;
    const page = await suiteql(sql, limit, offset, `${kind} records`);
    return {
      records: page.items.map(row => netsuiteRecord(kind, row, account.appHost)),
      nextCursor: page.hasMore ? `offset:${offset + limit}` : null,
      ...(ignored.length > 0 ? { ignored } : {}),
    };
  }

  async function get(kind: FinanceRecordKind, id: string): Promise<FinanceRecord> {
    if (!KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    if (!/^\d+$/.test(id)) {
      throw new Error(`${id} is not a NetSuite internal id (digits).`);
    }
    const { sql } = netsuiteQuery(kind, {}, id);
    const page = await suiteql(sql, 1, 0, `the ${kind}`);
    const row = page.items[0];
    if (!row) {
      throw new Error(`NetSuite has no ${kind} ${id} this role can see.`);
    }
    const record = netsuiteRecord(kind, row, account.appHost);
    if (kind === 'invoice' || kind === 'bill') {
      const lines = await suiteql(`SELECT tl.memo, tl.quantity, tl.foreignamount, BUILTIN.DF(tl.item) AS item FROM transactionline tl WHERE tl.transaction = ${id} AND tl.mainline = 'F' AND tl.taxline = 'F' ORDER BY tl.linesequencenumber`, 1000, 0, `the ${kind}'s lines`);
      record.lines = lines.items.map((line): FinanceLine => {
        const amount = num(line.foreignamount);
        const quantity = num(line.quantity);
        return { description: [str(line.item), str(line.memo)].filter(Boolean).join(': ') || 'Line', quantity: quantity === null ? null : Math.abs(quantity), amount: amount === null ? null : Math.abs(amount) };
      });
    }
    return record;
  }

  return { kind: 'netsuite', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get };
}
