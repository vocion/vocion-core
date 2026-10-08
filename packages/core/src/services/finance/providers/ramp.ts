/**
 * RAMP — company spend, as a provider of the finance family (`../types.ts`).
 *
 * Read live with the workspace's own Ramp developer app (client credentials):
 * card transactions, reimbursements, bills and vendors. Read-only: Vocion
 * never issues a card, approves, or pays.
 *
 * Ramp API facts this file depends on: a token from
 * `POST /developer/v1/token` (HTTP Basic client id and secret, form
 * `grant_type=client_credentials` with the scopes asked for), sent as Bearer;
 * lists answer `{ data, page: { next } }`, where `next` is the full URL of the
 * next page (followed only on the same host as the API base); `page_size` up
 * to 100; transactions and reimbursements take `from_date` / `to_date`.
 *
 * Amounts: a transaction's and a reimbursement's `amount` is a number in
 * major units beside `currency_code`. A bill's `amount` is an object
 * `{ amount, currency_code }` in MINOR units (cents). Both shapes are read
 * defensively: a plain number is taken as major units, an object as minor.
 * Ramp documents no stable per-record web link, so `url` is null.
 */

import type { FinanceListQuery, FinancePage, FinanceProvider, FinanceProviderInput, FinanceRecord, FinanceRecordKind } from '../types';
import { Buffer } from 'node:buffer';
import { sameHost, vendorJson } from '@/libs/connectors/vendorHttp';
import { unsupportedKind } from '../types';

const VENDOR = 'Ramp';
const DEFAULT_BASE = 'https://api.ramp.com';
export const RAMP_SCOPES = 'transactions:read reimbursements:read bills:read vendors:read users:read business:read';

const KINDS: readonly FinanceRecordKind[] = ['transaction', 'reimbursement', 'bill', 'vendor'];

const COLLECTION: Partial<Record<FinanceRecordKind, { path: string; what: string; dates: boolean }>> = {
  transaction: { path: 'transactions', what: 'card transactions', dates: true },
  reimbursement: { path: 'reimbursements', what: 'reimbursements', dates: true },
  bill: { path: 'bills', what: 'bills', dates: false },
  vendor: { path: 'vendors', what: 'vendors', dates: false },
};

type RampObject = Record<string, unknown>;
type RampList = { data?: RampObject[]; page?: { next?: string | null } };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * An amount from either Ramp shape: a number in major units, or an object
 * `{ amount, currency_code }` in minor units.
 * @param value - The field.
 * @param fallbackCurrency - The record's currency when the field carries none.
 */
export function rampAmount(value: unknown, fallbackCurrency: unknown = null): { amount: number | null; currency: string | null } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { amount: value, currency: str(fallbackCurrency)?.toUpperCase() ?? null };
  }
  if (value && typeof value === 'object') {
    const o = value as RampObject;
    const minor = typeof o.amount === 'number' && Number.isFinite(o.amount) ? o.amount : null;
    return { amount: minor === null ? null : minor / 100, currency: (str(o.currency_code) ?? str(fallbackCurrency))?.toUpperCase() ?? null };
  }
  return { amount: null, currency: str(fallbackCurrency)?.toUpperCase() ?? null };
}

function person(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const o = value as RampObject;
  const name = [str(o.first_name), str(o.last_name)].filter(Boolean).join(' ');
  return name || str(o.full_name) || str(o.name);
}

/**
 * One Ramp object as a finance record.
 * @param kind - What it is.
 * @param o - The object.
 */
export function rampRecord(kind: FinanceRecordKind, o: RampObject): FinanceRecord {
  const id = String(o.id ?? '');
  const base: FinanceRecord = { kind, id, number: null, title: id, party: null, status: str(o.state) ?? str(o.status), amount: null, currency: null, balance: null, date: null, dueDate: null, updatedAt: null, url: null };
  switch (kind) {
    case 'transaction': {
      const money = rampAmount(o.amount, o.currency_code);
      const party = str(o.merchant_name) ?? str((o.merchant_descriptor as unknown));
      const holder = person(o.card_holder);
      return {
        ...base,
        title: `Card spend${party ? ` · ${party}` : ''}`,
        party,
        ...money,
        date: str(o.user_transaction_time)?.slice(0, 10) ?? null,
        details: { cardholder: holder, department: str((o.card_holder as RampObject | undefined)?.department_name), category: str(o.sk_category_name), memo: str(o.memo) },
      };
    }
    case 'reimbursement': {
      const money = rampAmount(o.amount, o.currency ?? o.currency_code);
      const party = str(o.merchant);
      return {
        ...base,
        title: `Reimbursement${party ? ` · ${party}` : ''}`,
        party,
        ...money,
        date: str(o.transaction_date)?.slice(0, 10) ?? str(o.created_at)?.slice(0, 10) ?? null,
        updatedAt: str(o.updated_at),
        details: { employee: str(o.user_full_name) ?? person(o.user), memo: str(o.memo) },
      };
    }
    case 'bill': {
      const money = rampAmount(o.amount);
      const vendor = o.vendor && typeof o.vendor === 'object' ? str((o.vendor as RampObject).remote_name) ?? str((o.vendor as RampObject).name) : null;
      const number = str(o.invoice_number);
      return {
        ...base,
        number,
        title: `Bill ${number ?? id}${vendor ? ` · ${vendor}` : ''}`,
        party: vendor,
        status: str(o.status) ?? str(o.payment_status) ?? base.status,
        ...money,
        date: str(o.issued_at)?.slice(0, 10) ?? str(o.created_at)?.slice(0, 10) ?? null,
        dueDate: str(o.due_at)?.slice(0, 10) ?? null,
        details: { approvalStatus: str(o.approval_status), paymentStatus: str(o.payment_status), memo: str(o.memo) },
      };
    }
    case 'vendor':
      return {
        ...base,
        title: str(o.name) ?? id,
        status: typeof o.is_active === 'boolean' ? (o.is_active ? 'active' : 'inactive') : base.status,
        date: str(o.created_at)?.slice(0, 10) ?? null,
      };
    default:
      return base;
  }
}

/**
 * The provider, over one workspace's Ramp app. Built per call; the token is
 * fetched once per provider and never shared with another.
 * @param input - The source and its credential.
 */
export function rampFinanceProvider(input: FinanceProviderInput): FinanceProvider {
  const clientId = typeof input.credentials.clientId === 'string' ? input.credentials.clientId.trim() : '';
  const clientSecret = typeof input.credentials.clientSecret === 'string' ? input.credentials.clientSecret.trim() : '';
  if (!clientId || !clientSecret) {
    throw new Error('No Ramp app is stored for this source. An admin pastes the Ramp developer app\'s client ID and secret on the Connectors page.');
  }
  const base = (typeof input.source.config.baseUrl === 'string' && input.source.config.baseUrl ? input.source.config.baseUrl : DEFAULT_BASE).replace(/\/+$/, '');
  let token: Promise<string> | null = null;

  function accessToken(): Promise<string> {
    token ??= vendorJson<{ access_token?: unknown }>({
      vendor: VENDOR,
      what: 'an access token',
      url: `${base}/developer/v1/token`,
      fetch: input.fetch,
      init: {
        method: 'POST',
        headers: {
          'authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'application/json',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: RAMP_SCOPES }).toString(),
      },
    }).then((body) => {
      const t = body?.access_token;
      if (typeof t !== 'string' || !t) {
        throw new Error('Ramp answered the token request without a token. Check the app has the client credentials grant.');
      }
      return t;
    });
    token.catch(() => {
      token = null;
    });
    return token;
  }

  async function call<T>(url: string, what: string): Promise<T> {
    const t = await accessToken();
    return vendorJson<T>({ vendor: VENDOR, what, url, fetch: input.fetch, init: { headers: { authorization: `Bearer ${t}`, accept: 'application/json' } } });
  }

  async function list(kind: FinanceRecordKind, q: FinanceListQuery): Promise<FinancePage> {
    const collection = COLLECTION[kind];
    if (!collection || !KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const ignored: string[] = [];
    let url: string;
    if (q.cursor) {
      if (!sameHost(q.cursor, base)) {
        throw new Error('That cursor is not a Ramp page of this source. Start the list again without one.');
      }
      url = q.cursor;
    } else {
      const params = new URLSearchParams({ page_size: String(Math.max(2, Math.min(q.limit, 100))) });
      if (collection.dates) {
        const since = q.since ?? (q.updatedSince ? q.updatedSince.toISOString() : undefined);
        if (since) {
          params.set('from_date', since.length === 10 ? `${since}T00:00:00Z` : since);
        }
        if (q.until) {
          params.set('to_date', q.until.length === 10 ? `${q.until}T23:59:59Z` : q.until);
        }
      } else {
        if (q.since) {
          ignored.push('since');
        }
        if (q.until) {
          ignored.push('until');
        }
      }
      if (q.partyId) {
        if (kind === 'bill') {
          params.set('vendor_id', q.partyId);
        } else {
          ignored.push('party_id');
        }
      }
      if (q.query) {
        ignored.push('query');
      }
      if (q.status) {
        ignored.push('status');
      }
      url = `${base}/developer/v1/${collection.path}?${params.toString()}`;
    }
    const page = await call<RampList>(url, collection.what);
    const data = Array.isArray(page?.data) ? page.data : [];
    const records = data.slice(0, q.limit).map(o => rampRecord(kind, o));
    const next = str(page?.page?.next);
    return { records, nextCursor: next && sameHost(next, base) ? next : null, ...(ignored.length > 0 ? { ignored } : {}) };
  }

  async function get(kind: FinanceRecordKind, id: string): Promise<FinanceRecord> {
    const collection = COLLECTION[kind];
    if (!collection || !KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const o = await call<RampObject>(`${base}/developer/v1/${collection.path}/${encodeURIComponent(id)}`, collection.what.replace(/s$/, ''));
    return rampRecord(kind, o);
  }

  return { kind: 'ramp', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get };
}
