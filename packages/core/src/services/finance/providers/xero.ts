/**
 * XERO — the books, as a provider of the finance family (`../types.ts`).
 *
 * Two ways in, both read-only:
 *   - a "Connect with Xero" login (`libs/connect/providers/xero.ts`): an
 *     access token renewed through `usableLoginGrant`, which saves the
 *     refresh token Xero rotates on every refresh;
 *   - a pasted Xero custom connection (`clientId`, `clientSecret`): a
 *     client-credentials token minted per call, nothing to persist, and no
 *     OAuth app on this server needed.
 *
 * Xero Accounting API facts this file depends on: every call names the
 * organisation in `xero-tenant-id`; JSON with `Accept: application/json`;
 * Invoices with `Type` ACCREC are sales invoices and ACCPAY are bills;
 * Contacts carry `IsCustomer` / `IsSupplier`; lists page by `page` (1-based)
 * with `pageSize`; `If-Modified-Since` returns only what changed; `where`
 * takes a filter expression; dates arrive as `/Date(<ms>+0000)/`.
 */

import type { FinanceLine, FinanceListQuery, FinancePage, FinanceProvider, FinanceProviderInput, FinanceRecord, FinanceRecordKind } from '../types';
import type { FetchLike } from '@/libs/connectors/vendorHttp';
import { Buffer } from 'node:buffer';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshXeroGrant, XERO_CONNECTIONS_URL, XERO_TOKEN_URL } from '@/libs/connect/providers/xero';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { unsupportedKind } from '../types';

const API = 'https://api.xero.com/api.xro/2.0';
const VENDOR = 'Xero';

const KINDS: readonly FinanceRecordKind[] = ['customer', 'vendor', 'invoice', 'bill', 'payment', 'account'];

type XeroRow = Record<string, unknown>;

/** Each kind's endpoint, the key its answer lists rows under, and its id field. */
const ENDPOINT: Partial<Record<FinanceRecordKind, { path: string; key: string; idField: string; what: string }>> = {
  customer: { path: 'Contacts', key: 'Contacts', idField: 'ContactID', what: 'contacts' },
  vendor: { path: 'Contacts', key: 'Contacts', idField: 'ContactID', what: 'contacts' },
  invoice: { path: 'Invoices', key: 'Invoices', idField: 'InvoiceID', what: 'invoices' },
  bill: { path: 'Invoices', key: 'Invoices', idField: 'InvoiceID', what: 'bills' },
  payment: { path: 'Payments', key: 'Payments', idField: 'PaymentID', what: 'payments' },
  account: { path: 'Accounts', key: 'Accounts', idField: 'AccountID', what: 'accounts' },
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A Xero date (`/Date(1790000000000+0000)/`, or an ISO string) as ISO.
 * @param value - The field.
 * @param dateOnly - Keep only the date.
 */
export function xeroDate(value: unknown, dateOnly = true): string | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const ms = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(value);
  const parsed = ms ? Number(ms[1]) : Date.parse(value.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const iso = new Date(parsed).toISOString();
  return dateOnly ? iso.slice(0, 10) : iso;
}

/**
 * A string literal inside a Xero `where` expression, quotes escaped.
 * @param value - The value.
 */
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/**
 * An ISO date as Xero's `DateTime(y,m,d)` filter literal.
 * @param iso - The date.
 */
function dateTime(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `DateTime(${y},${String(m).padStart(2, '0')},${String(d).padStart(2, '0')})`;
}

/**
 * One Xero row as a finance record.
 * @param kind - What it is.
 * @param row - The row.
 * @param whole - Whether to include lines.
 */
export function xeroRecord(kind: FinanceRecordKind, row: XeroRow, whole: boolean): FinanceRecord {
  const blank: FinanceRecord = { kind, id: '', number: null, title: '', party: null, status: null, amount: null, currency: null, balance: null, date: null, dueDate: null, updatedAt: xeroDate(row.UpdatedDateUTC, false), url: null };
  switch (kind) {
    case 'customer':
    case 'vendor': {
      const id = String(row.ContactID ?? '');
      const balances = (row.Balances ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const side = kind === 'customer' ? balances.AccountsReceivable : balances.AccountsPayable;
      return {
        ...blank,
        id,
        number: str(row.AccountNumber),
        title: str(row.Name) ?? id,
        status: str(row.ContactStatus),
        balance: num(side?.Outstanding),
        currency: str(row.DefaultCurrency),
        url: `https://go.xero.com/Contacts/View/${encodeURIComponent(id)}`,
        details: { email: str(row.EmailAddress), overdue: num(side?.Overdue) },
      };
    }
    case 'invoice':
    case 'bill': {
      const id = String(row.InvoiceID ?? '');
      const number = str(row.InvoiceNumber);
      const party = str((row.Contact as XeroRow | undefined)?.Name);
      const lines: FinanceLine[] = Array.isArray(row.LineItems)
        ? (row.LineItems as XeroRow[]).map(line => ({ description: str(line.Description) ?? 'Line item', quantity: num(line.Quantity), amount: num(line.LineAmount) }))
        : [];
      return {
        ...blank,
        id,
        number,
        title: `${kind === 'invoice' ? 'Invoice' : 'Bill'} ${number ?? id}${party ? ` · ${party}` : ''}`,
        party,
        status: str(row.Status),
        amount: num(row.Total),
        balance: num(row.AmountDue),
        currency: str(row.CurrencyCode),
        date: xeroDate(row.DateString ?? row.Date),
        dueDate: xeroDate(row.DueDateString ?? row.DueDate),
        url: `https://go.xero.com/${kind === 'invoice' ? 'AccountsReceivable' : 'AccountsPayable'}/View.aspx?InvoiceID=${encodeURIComponent(id)}`,
        ...(whole ? { lines } : {}),
        details: { reference: str(row.Reference), amountPaid: num(row.AmountPaid), contactId: str((row.Contact as XeroRow | undefined)?.ContactID) },
      };
    }
    case 'payment': {
      const id = String(row.PaymentID ?? '');
      const invoice = (row.Invoice ?? {}) as XeroRow;
      const party = str((invoice.Contact as XeroRow | undefined)?.Name);
      return {
        ...blank,
        id,
        title: `Payment${party ? ` · ${party}` : ''}`,
        party,
        status: str(row.Status),
        amount: num(row.Amount),
        currency: str(invoice.CurrencyCode),
        date: xeroDate(row.Date),
        details: { invoice: str(invoice.InvoiceNumber), invoiceId: str(invoice.InvoiceID), reference: str(row.Reference), paymentType: str(row.PaymentType) },
      };
    }
    case 'account': {
      const id = String(row.AccountID ?? '');
      const code = str(row.Code);
      return {
        ...blank,
        id,
        number: code,
        title: `${code ? `${code} ` : ''}${str(row.Name) ?? id}`,
        status: str(row.Status),
        currency: str(row.CurrencyCode),
        details: { type: str(row.Type), class: str(row.Class), taxType: str(row.TaxType), description: str(row.Description) },
      };
    }
    default:
      return blank;
  }
}

/**
 * The access token for this call: a login renewed and saved when expiring,
 * or a custom connection's client-credentials token minted now.
 * @param input - The provider input.
 * @param doFetch - The network.
 */
async function accessToken(input: FinanceProviderInput, doFetch: FetchLike | undefined): Promise<string> {
  const c = input.credentials;
  if (isLoginGrant(c)) {
    const grant = await usableLoginGrant({ vendor: VENDOR, provider: 'xero', connectorSlug: 'xero', grant: c, persistence: input.persistence, refresh: refreshXeroGrant });
    return grant.accessToken;
  }
  const clientId = str(c.clientId);
  const clientSecret = str(c.clientSecret);
  if (!clientId || !clientSecret) {
    throw new Error('No Xero login or custom connection is stored for this source. An admin logs in with Xero, or pastes a custom connection, on the Connectors page.');
  }
  const body = await vendorJson<Record<string, unknown>>({
    vendor: VENDOR,
    what: 'a token for the custom connection',
    url: XERO_TOKEN_URL,
    fetch: doFetch,
    init: {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    },
  });
  const token = str(body?.access_token);
  if (!token) {
    throw new Error('Xero issued no token for the custom connection. Check that it is authorised by the organisation.');
  }
  return token;
}

/**
 * The provider, over one workspace's Xero organisation. Built per call.
 * @param input - The source and its credential.
 */
export async function xeroFinanceProvider(input: FinanceProviderInput): Promise<FinanceProvider> {
  const doFetch = input.fetch;
  const token = await accessToken(input, doFetch);
  let tenantId = str(input.source.config.tenantId) ?? str(input.credentials.tenantId);
  if (!tenantId) {
    const tenants = await vendorJson<Array<Record<string, unknown>>>({ vendor: VENDOR, what: 'its organisations', url: XERO_CONNECTIONS_URL, fetch: doFetch, init: { headers: { accept: 'application/json', authorization: `Bearer ${token}` } } });
    const rows = Array.isArray(tenants) ? tenants : [];
    tenantId = str((rows.find(row => row.tenantType === 'ORGANISATION') ?? rows[0])?.tenantId);
  }
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${token}`, ...(tenantId ? { 'xero-tenant-id': tenantId } : {}) };

  const call = <T>(path: string, what: string, extra?: Record<string, string>) => vendorJson<T>({ vendor: VENDOR, what, url: `${API}/${path}`, fetch: doFetch, init: { headers: { ...headers, ...extra } } });

  async function list(kind: FinanceRecordKind, q: FinanceListQuery): Promise<FinancePage> {
    const endpoint = ENDPOINT[kind];
    if (!endpoint) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const ignored: string[] = [];
    const where: string[] = [];
    const params = new URLSearchParams();
    const limit = Math.max(1, Math.min(q.limit, 100));
    const page = q.cursor?.startsWith('page:') ? Math.max(1, Number(q.cursor.slice(5)) || 1) : 1;
    if (kind === 'customer') {
      where.push('IsCustomer==true');
    }
    if (kind === 'vendor') {
      where.push('IsSupplier==true');
    }
    if (kind === 'invoice' || kind === 'bill') {
      where.push(`Type==${quote(kind === 'invoice' ? 'ACCREC' : 'ACCPAY')}`);
    }
    if (q.status) {
      const status = q.status.toUpperCase();
      if (kind === 'invoice' || kind === 'bill') {
        params.set('Statuses', status);
      } else {
        where.push(`${kind === 'customer' || kind === 'vendor' ? 'ContactStatus' : 'Status'}==${quote(status)}`);
      }
    }
    if (q.query) {
      if (kind === 'account') {
        // Accounts are one short list; a text filter is applied below.
      } else if (kind === 'payment') {
        ignored.push('query');
      } else {
        params.set(kind === 'customer' || kind === 'vendor' ? 'searchTerm' : 'SearchTerm', q.query);
      }
    }
    if (q.partyId) {
      if (kind === 'invoice' || kind === 'bill') {
        params.set('ContactIDs', q.partyId);
      } else {
        ignored.push('party_id');
      }
    }
    if (q.since || q.until) {
      if (kind === 'invoice' || kind === 'bill' || kind === 'payment') {
        if (q.since) {
          where.push(`Date>=${dateTime(q.since)}`);
        }
        if (q.until) {
          where.push(`Date<=${dateTime(q.until)}`);
        }
      } else {
        ignored.push('since/until');
      }
    }
    if (where.length > 0) {
      params.set('where', where.join(' AND '));
    }
    const paged = kind !== 'account';
    if (paged) {
      params.set('page', String(page));
      params.set('pageSize', String(limit));
    }
    const extra = q.updatedSince ? { 'If-Modified-Since': q.updatedSince.toISOString().slice(0, 19) } : undefined;
    const body = await call<Record<string, unknown>>(`${endpoint.path}?${params.toString()}`, endpoint.what, extra);
    let rows = Array.isArray(body?.[endpoint.key]) ? body[endpoint.key] as XeroRow[] : [];
    if (kind === 'account' && q.query) {
      const needle = q.query.toLowerCase();
      rows = rows.filter(row => [row.Name, row.Code].some(v => typeof v === 'string' && v.toLowerCase().includes(needle)));
    }
    if (!paged) {
      const start = page - 1;
      const slice = rows.slice(start * limit, start * limit + limit);
      return { records: slice.map(row => xeroRecord(kind, row, false)), nextCursor: rows.length > (start + 1) * limit ? `page:${page + 1}` : null, ...(ignored.length ? { ignored } : {}) };
    }
    return { records: rows.map(row => xeroRecord(kind, row, false)), nextCursor: rows.length >= limit ? `page:${page + 1}` : null, ...(ignored.length ? { ignored } : {}) };
  }

  async function get(kind: FinanceRecordKind, id: string): Promise<FinanceRecord> {
    const endpoint = ENDPOINT[kind];
    if (!endpoint) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const body = await call<Record<string, unknown>>(`${endpoint.path}/${encodeURIComponent(id)}`, endpoint.what.replace(/s$/, ''));
    const row = Array.isArray(body?.[endpoint.key]) ? (body[endpoint.key] as XeroRow[])[0] : undefined;
    if (!row) {
      throw new Error(`Xero has no ${kind} ${id}.`);
    }
    return xeroRecord(kind, row, true);
  }

  return { kind: 'xero', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get };
}
