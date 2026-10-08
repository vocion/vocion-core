/**
 * QUICKBOOKS ONLINE — the books, as a provider of the finance family
 * (`../types.ts`), beside the `quickbooks` source's own sync
 * (`libs/sources/quickbooks.ts`), which this does not replace.
 *
 * Read live with the source's login, renewed and saved through
 * `usableLoginGrant` (Intuit rotates the refresh token). With `sample: true`
 * on the source it reads the fictional sample company in memory, with no
 * login: what the sample holds (invoices, bills, payments, accounts),
 * filtered here. Read-only: QuickBooks has no draft state for an invoice,
 * so no write is offered.
 *
 * QuickBooks API facts this file depends on: one `query` endpoint taking its
 * own SQL dialect (`SELECT * FROM Invoice WHERE … ORDERBY … STARTPOSITION n
 * MAXRESULTS m`), AND only, `LIKE` on name fields, strings in single quotes
 * escaped with a backslash; one record by `GET /v3/company/<realm>/<entity>/<id>`.
 */

import type { FinanceLine, FinanceListQuery, FinancePage, FinanceProvider, FinanceProviderInput, FinanceRecord, FinanceRecordKind } from '../types';
import type { QuickbooksEntity, QuickbooksRow } from '@/libs/quickbooks/client';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshQuickbooksGrant } from '@/libs/connect/providers/quickbooks';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { QUICKBOOKS_API_BASE, QUICKBOOKS_APP_HOST, QUICKBOOKS_MINOR_VERSION } from '@/libs/quickbooks/client';
import { sampleQuickbooksReader } from '@/libs/quickbooks/sampleCompany';
import { unsupportedKind } from '../types';

const VENDOR = 'QuickBooks';

const LIVE_KINDS: readonly FinanceRecordKind[] = ['customer', 'vendor', 'invoice', 'bill', 'payment', 'account'];
const SAMPLE_KINDS: readonly FinanceRecordKind[] = ['invoice', 'bill', 'payment', 'account'];

/** Each kind's QuickBooks entity, and where it opens in QuickBooks. */
const ENTITY: Partial<Record<FinanceRecordKind, { entity: string; app: (id: string) => string }>> = {
  customer: { entity: 'Customer', app: id => `/app/customerdetail?nameId=${encodeURIComponent(id)}` },
  vendor: { entity: 'Vendor', app: id => `/app/vendordetail?nameId=${encodeURIComponent(id)}` },
  invoice: { entity: 'Invoice', app: id => `/app/invoice?txnId=${encodeURIComponent(id)}` },
  bill: { entity: 'Bill', app: id => `/app/bill?txnId=${encodeURIComponent(id)}` },
  payment: { entity: 'Payment', app: id => `/app/recvpayment?txnId=${encodeURIComponent(id)}` },
  account: { entity: 'Account', app: id => `/app/register?accountId=${encodeURIComponent(id)}` },
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ref(value: unknown, field: 'name' | 'value'): string | null {
  return value && typeof value === 'object' ? str((value as Record<string, unknown>)[field]) : null;
}

/**
 * Paid, partly paid or unpaid, from the balance against the total.
 * @param total - The total.
 * @param balance - What is still owed.
 */
function settlement(total: number | null, balance: number | null): string | null {
  if (total === null || balance === null) {
    return null;
  }
  return balance <= 0 ? 'paid' : balance < total ? 'partly paid' : 'unpaid';
}

/**
 * One QuickBooks row as a finance record.
 * @param kind - What it is.
 * @param row - The row.
 * @param appHost - Where it opens in QuickBooks, or null (the sample).
 */
export function quickbooksRecord(kind: FinanceRecordKind, row: QuickbooksRow, appHost: string | null): FinanceRecord {
  const id = String(row.Id ?? '');
  const updatedAt = str((row.MetaData as Record<string, unknown> | undefined)?.LastUpdatedTime);
  const url = appHost && ENTITY[kind] ? `${appHost}${ENTITY[kind]!.app(id)}` : null;
  const currency = ref(row.CurrencyRef, 'value');
  const base: FinanceRecord = { kind, id, number: null, title: id, party: null, status: null, amount: null, currency, balance: null, date: str(row.TxnDate), dueDate: null, updatedAt, url };
  switch (kind) {
    case 'customer':
    case 'vendor':
      return {
        ...base,
        title: str(row.DisplayName) ?? str(row.CompanyName) ?? id,
        status: row.Active === false ? 'inactive' : 'active',
        balance: num(row.Balance),
        details: { email: str((row.PrimaryEmailAddr as Record<string, unknown> | undefined)?.Address), company: str(row.CompanyName) },
      };
    case 'invoice':
    case 'bill': {
      const number = str(row.DocNumber);
      const party = ref(kind === 'invoice' ? row.CustomerRef : row.VendorRef, 'name');
      const total = num(row.TotalAmt);
      const balance = num(row.Balance);
      const lines: FinanceLine[] = (Array.isArray(row.Line) ? row.Line as QuickbooksRow[] : [])
        .filter(line => line.DetailType !== 'SubTotalLineDetail')
        .map((line) => {
          const type = str(line.DetailType);
          const detail = (type && line[type] && typeof line[type] === 'object' ? line[type] : {}) as Record<string, unknown>;
          const what = [ref(detail.ItemRef, 'name') ?? ref(detail.AccountRef, 'name'), str(line.Description)].filter(Boolean).join(': ');
          return { description: what || 'Line', quantity: num(detail.Qty), amount: num(line.Amount) };
        });
      return {
        ...base,
        number,
        title: `${kind === 'invoice' ? 'Invoice' : 'Bill'} ${number ?? id}${party ? ` · ${party}` : ''}`,
        party,
        status: settlement(total, balance),
        amount: total,
        balance,
        dueDate: str(row.DueDate),
        lines,
        details: { partyId: ref(kind === 'invoice' ? row.CustomerRef : row.VendorRef, 'value'), note: str(row.PrivateNote) },
      };
    }
    case 'payment': {
      const party = ref(row.CustomerRef, 'name');
      return {
        ...base,
        title: `Payment from ${party ?? 'a customer'}${base.date ? ` · ${base.date}` : ''}`,
        party,
        amount: num(row.TotalAmt),
        details: { reference: str(row.PaymentRefNum), unapplied: num(row.UnappliedAmt), depositedTo: ref(row.DepositToAccountRef, 'name') },
      };
    }
    case 'account': {
      const number = str(row.AcctNum);
      return {
        ...base,
        number,
        title: `${number ? `${number} ` : ''}${str(row.FullyQualifiedName) ?? str(row.Name) ?? id}`,
        status: row.Active === false ? 'inactive' : 'active',
        balance: num(row.CurrentBalance),
        details: { type: str(row.AccountType), classification: str(row.Classification) },
      };
    }
    default:
      return base;
  }
}

/**
 * A QuickBooks query string literal.
 * @param value - The text.
 */
function literal(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`;
}

/**
 * The query for one page.
 * @param kind - What to read.
 * @param q - The filters.
 * @param start - 1-based start position.
 * @param max - Page size.
 */
export function quickbooksListQuery(kind: FinanceRecordKind, q: Partial<FinanceListQuery>, start: number, max: number): { sql: string; ignored: string[] } {
  const entity = ENTITY[kind]?.entity;
  if (!entity) {
    throw unsupportedKind(VENDOR, kind, LIVE_KINDS);
  }
  const where: string[] = [];
  const ignored: string[] = [];
  const transaction = kind === 'invoice' || kind === 'bill' || kind === 'payment';
  if (q.query) {
    if (kind === 'customer' || kind === 'vendor') {
      where.push(`DisplayName LIKE ${literal(`%${q.query}%`)}`);
    } else if (kind === 'account') {
      where.push(`Name LIKE ${literal(`%${q.query}%`)}`);
    } else if (kind === 'invoice' || kind === 'bill') {
      where.push(`DocNumber = ${literal(q.query)}`);
    } else {
      ignored.push('query');
    }
  }
  if (q.status) {
    const s = q.status.toLowerCase();
    if (kind === 'customer' || kind === 'vendor' || kind === 'account') {
      where.push(`Active = ${s === 'inactive' ? 'false' : 'true'}`);
    } else if ((kind === 'invoice' || kind === 'bill') && ['open', 'unpaid', 'partly paid'].includes(s)) {
      where.push('Balance > \'0\'');
    } else if ((kind === 'invoice' || kind === 'bill') && s === 'paid') {
      where.push('Balance = \'0\'');
    } else {
      ignored.push('status');
    }
  }
  if (q.partyId) {
    if (kind === 'invoice' || kind === 'payment') {
      where.push(`CustomerRef = ${literal(q.partyId)}`);
    } else if (kind === 'bill') {
      where.push(`VendorRef = ${literal(q.partyId)}`);
    } else {
      ignored.push('party_id');
    }
  }
  if (q.since || q.until) {
    if (transaction) {
      if (q.since) {
        where.push(`TxnDate >= ${literal(q.since.slice(0, 10))}`);
      }
      if (q.until) {
        where.push(`TxnDate <= ${literal(q.until.slice(0, 10))}`);
      }
    } else {
      ignored.push('since/until');
    }
  }
  if (q.updatedSince) {
    where.push(`Metadata.LastUpdatedTime >= ${literal(q.updatedSince.toISOString())}`);
  }
  const sql = `SELECT * FROM ${entity}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDERBY Metadata.LastUpdatedTime DESC STARTPOSITION ${start} MAXRESULTS ${max}`;
  return { sql, ignored };
}

/**
 * Whether a sample row passes the filters the live query would apply.
 * @param record - The mapped record.
 * @param q - The filters.
 */
function sampleMatches(record: FinanceRecord, q: FinanceListQuery): boolean {
  if (q.query) {
    const needle = q.query.toLowerCase();
    if (![record.title, record.number, record.party].some(v => v?.toLowerCase().includes(needle))) {
      return false;
    }
  }
  if (q.status && record.status && record.status.toLowerCase() !== q.status.toLowerCase()) {
    return false;
  }
  if (q.partyId && record.details?.partyId !== q.partyId) {
    return false;
  }
  if (q.since && record.date && record.date < q.since.slice(0, 10)) {
    return false;
  }
  if (q.until && record.date && record.date > q.until.slice(0, 10)) {
    return false;
  }
  return true;
}

/**
 * The provider, over one workspace's QuickBooks company (or the sample).
 * Built per call.
 * @param input - The source and its credential.
 */
export async function quickbooksFinanceProvider(input: FinanceProviderInput): Promise<FinanceProvider> {
  if (input.source.config.sample === true) {
    const reader = sampleQuickbooksReader();
    const entityOf: Partial<Record<FinanceRecordKind, QuickbooksEntity>> = { invoice: 'Invoice', bill: 'Bill', payment: 'Payment', account: 'Account' };
    const all = async (kind: FinanceRecordKind) => {
      const entity = entityOf[kind];
      if (!entity) {
        throw unsupportedKind(`${VENDOR} (sample company)`, kind, SAMPLE_KINDS);
      }
      return (await reader.query(entity, { start: 1, max: 1000 })).map(row => quickbooksRecord(kind, row, null));
    };
    return {
      kind: 'quickbooks',
      vendor: `${VENDOR} (sample company)`,
      sourceSlug: input.source.slug,
      kinds: SAMPLE_KINDS,
      async list(kind, q) {
        const matched = (await all(kind)).filter(r => sampleMatches(r, q));
        const offset = q.cursor?.startsWith('start:') ? Math.max(0, Number(q.cursor.slice(6)) - 1) : 0;
        const page = matched.slice(offset, offset + q.limit);
        return { records: page, nextCursor: matched.length > offset + q.limit ? `start:${offset + q.limit + 1}` : null };
      },
      async get(kind, id) {
        const found = (await all(kind)).find(r => r.id === id);
        if (!found) {
          throw new Error(`The sample company has no ${kind} ${id}.`);
        }
        return found;
      },
    };
  }

  const c = input.credentials;
  if (!isLoginGrant(c) || typeof c.realmId !== 'string' || !c.realmId) {
    throw new Error('QuickBooks needs a login: an admin logs in with QuickBooks on the Connectors page. To try it first, turn on sample data for this source.');
  }
  const grant = await usableLoginGrant({ vendor: VENDOR, provider: 'quickbooks', connectorSlug: 'quickbooks', grant: c, persistence: input.persistence, refresh: refreshQuickbooksGrant });
  const realmId = String(grant.realmId);
  const environment = grant.environment === 'sandbox' ? 'sandbox' : 'production';
  const base = (str(input.source.config.baseUrl) ?? QUICKBOOKS_API_BASE[environment]).replace(/\/+$/, '');
  const appHost = QUICKBOOKS_APP_HOST[environment];
  const headers = { accept: 'application/json', authorization: `Bearer ${grant.accessToken}` };

  async function list(kind: FinanceRecordKind, q: FinanceListQuery): Promise<FinancePage> {
    const entity = ENTITY[kind]?.entity;
    if (!entity) {
      throw unsupportedKind(VENDOR, kind, LIVE_KINDS);
    }
    const max = Math.max(1, Math.min(q.limit, 1000));
    const start = q.cursor?.startsWith('start:') ? Math.max(1, Number(q.cursor.slice(6)) || 1) : 1;
    const { sql, ignored } = quickbooksListQuery(kind, q, start, max);
    const params = new URLSearchParams({ query: sql, minorversion: QUICKBOOKS_MINOR_VERSION });
    const body = await vendorJson<{ QueryResponse?: Record<string, unknown> }>({ vendor: VENDOR, what: `${entity} records`, url: `${base}/v3/company/${encodeURIComponent(realmId)}/query?${params.toString()}`, fetch: input.fetch, init: { headers } });
    const rows = body?.QueryResponse?.[entity];
    const records = (Array.isArray(rows) ? rows as QuickbooksRow[] : []).map(row => quickbooksRecord(kind, row, appHost));
    return { records, nextCursor: records.length >= max ? `start:${start + max}` : null, ...(ignored.length > 0 ? { ignored } : {}) };
  }

  async function get(kind: FinanceRecordKind, id: string): Promise<FinanceRecord> {
    const entity = ENTITY[kind]?.entity;
    if (!entity) {
      throw unsupportedKind(VENDOR, kind, LIVE_KINDS);
    }
    if (!/^\d+$/.test(id)) {
      throw new Error(`${id} is not a QuickBooks id (digits).`);
    }
    const body = await vendorJson<Record<string, unknown>>({ vendor: VENDOR, what: `the ${entity}`, url: `${base}/v3/company/${encodeURIComponent(realmId)}/${entity.toLowerCase()}/${id}?minorversion=${QUICKBOOKS_MINOR_VERSION}`, fetch: input.fetch, init: { headers } });
    const row = body?.[entity];
    if (!row || typeof row !== 'object') {
      throw new Error(`QuickBooks has no ${kind} ${id}.`);
    }
    return quickbooksRecord(kind, row as QuickbooksRow, appHost);
  }

  return { kind: 'quickbooks', vendor: VENDOR, sourceSlug: input.source.slug, kinds: LIVE_KINDS, list, get };
}
