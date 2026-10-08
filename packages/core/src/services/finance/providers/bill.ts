/**
 * BILL — payables and receivables, as a provider of the finance family
 * (`../types.ts`).
 *
 * Read live with the workspace's own BILL API user: bills (with their
 * approval and payment status), vendors, invoices (receivables) and
 * customers. Read-only: Vocion never pays, approves or sends anything.
 *
 * BILL v3 API facts this file depends on: a session from `POST /login`
 * (JSON `{ username, password, organizationId, devKey }` → `{ sessionId }`),
 * then `devKey` and `sessionId` headers on every call; sessions lapse after
 * about 35 idle minutes, so one is made per provider and never shared;
 * lists answer `{ results, nextPage }` and page by `page=<nextPage>` with
 * `max` up to 100; amounts are numbers in major units. BILL documents no
 * stable per-record web link, so `url` is null.
 *
 * The developer key is the workspace's own when its credential carries one,
 * else this server's `BILL_DEV_KEY`.
 */

import type { FinanceListQuery, FinancePage, FinanceProvider, FinanceProviderInput, FinanceRecord, FinanceRecordKind } from '../types';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { Env } from '@/libs/Env';
import { unsupportedKind } from '../types';

const VENDOR = 'BILL';
export const BILL_API_BASE = {
  production: 'https://gateway.prod.bill.com/connect/v3',
  sandbox: 'https://gateway.stage.bill.com/connect/v3',
} as const;

const KINDS: readonly FinanceRecordKind[] = ['bill', 'vendor', 'invoice', 'customer'];

const COLLECTION: Partial<Record<FinanceRecordKind, { path: string; what: string }>> = {
  bill: { path: 'bills', what: 'bills' },
  vendor: { path: 'vendors', what: 'vendors' },
  invoice: { path: 'invoices', what: 'invoices' },
  customer: { path: 'customers', what: 'customers' },
};

type BillObject = Record<string, unknown>;
type BillList = { results?: BillObject[]; nextPage?: string | null };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function day(value: unknown): string | null {
  return str(value)?.slice(0, 10) ?? null;
}

/**
 * One BILL object as a finance record.
 * @param kind - What it is.
 * @param o - The object.
 * @param whole - Whether to include lines.
 */
export function billRecord(kind: FinanceRecordKind, o: BillObject, whole: boolean): FinanceRecord {
  const id = String(o.id ?? '');
  const base: FinanceRecord = { kind, id, number: null, title: id, party: null, status: null, amount: null, currency: str(o.currency)?.toUpperCase() ?? null, balance: null, date: day(o.createdTime), dueDate: null, updatedAt: str(o.updatedTime), url: null };
  switch (kind) {
    case 'bill': {
      const invoice = (o.invoice ?? {}) as BillObject;
      const number = str(invoice.invoiceNumber) ?? str(o.invoiceNumber);
      const party = str(o.vendorName) ?? str((o.vendor as BillObject | undefined)?.name);
      const items = Array.isArray(o.billLineItems) ? (o.billLineItems as BillObject[]) : [];
      return {
        ...base,
        number,
        title: `Bill ${number ?? id}${party ? ` · ${party}` : ''}`,
        party,
        status: str(o.paymentStatus),
        amount: num(o.amount),
        balance: num(o.dueAmount),
        date: day(invoice.invoiceDate) ?? base.date,
        dueDate: day(o.dueDate),
        ...(whole ? { lines: items.map(line => ({ description: str(line.description) ?? 'Line item', quantity: num(line.quantity), amount: num(line.amount) })) } : {}),
        details: { approvalStatus: str(o.approvalStatus), paymentStatus: str(o.paymentStatus), vendorId: str(o.vendorId), archived: typeof o.archived === 'boolean' ? o.archived : null },
      };
    }
    case 'invoice': {
      const number = str(o.invoiceNumber);
      const party = str((o.customer as BillObject | undefined)?.name) ?? str(o.customerName);
      const items = Array.isArray(o.invoiceLineItems) ? (o.invoiceLineItems as BillObject[]) : [];
      return {
        ...base,
        number,
        title: `Invoice ${number ?? id}${party ? ` · ${party}` : ''}`,
        party,
        status: str(o.status),
        amount: num(o.totalAmount),
        balance: num(o.dueAmount),
        date: day(o.invoiceDate) ?? base.date,
        dueDate: day(o.dueDate),
        ...(whole ? { lines: items.map(line => ({ description: str(line.description) ?? 'Line item', quantity: num(line.quantity), amount: num(line.amount) ?? (num(line.price) !== null && num(line.quantity) !== null ? num(line.price)! * num(line.quantity)! : null) })) } : {}),
        details: { customerId: str(o.customerId) ?? str((o.customer as BillObject | undefined)?.id) },
      };
    }
    case 'vendor':
    case 'customer':
      return {
        ...base,
        title: str(o.name) ?? id,
        status: typeof o.archived === 'boolean' ? (o.archived ? 'archived' : 'active') : null,
        balance: num(o.balance),
        details: { email: str(o.email), accountType: str(o.accountType) },
      };
    default:
      return base;
  }
}

/**
 * The provider, over one workspace's BILL API user. Built per call; it signs
 * in once on first use and never shares the session.
 * @param input - The source and its credential.
 */
export function billFinanceProvider(input: FinanceProviderInput): FinanceProvider {
  const c = input.credentials;
  const username = typeof c.username === 'string' ? c.username.trim() : '';
  const password = typeof c.password === 'string' ? c.password : '';
  const organizationId = typeof c.organizationId === 'string' ? c.organizationId.trim() : '';
  if (!username || !password || !organizationId) {
    throw new Error('No BILL sign-in is stored for this source. An admin pastes the API user\'s email, password and organization ID on the Connectors page.');
  }
  const devKey = (typeof c.devKey === 'string' && c.devKey.trim()) || Env.BILL_DEV_KEY?.trim() || '';
  if (!devKey) {
    throw new Error('BILL needs a developer key: add one to the BILL credential on the Connectors page, or set BILL_DEV_KEY on this server.');
  }
  const base = input.source.config.sandbox === true ? BILL_API_BASE.sandbox : BILL_API_BASE.production;
  let session: Promise<string> | null = null;

  function sessionId(): Promise<string> {
    session ??= vendorJson<{ sessionId?: unknown }>({
      vendor: VENDOR,
      what: 'a sign-in',
      url: `${base}/login`,
      fetch: input.fetch,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ username, password, organizationId, devKey }),
      },
    }).then((body) => {
      const id = body?.sessionId;
      if (typeof id !== 'string' || !id) {
        throw new Error('BILL answered the sign-in without a session. Check the user, password and organization ID.');
      }
      return id;
    });
    session.catch(() => {
      session = null;
    });
    return session;
  }

  async function call<T>(path: string, what: string): Promise<T> {
    const sid = await sessionId();
    return vendorJson<T>({ vendor: VENDOR, what, url: `${base}${path}`, fetch: input.fetch, init: { headers: { devKey, sessionId: sid, accept: 'application/json' } } });
  }

  async function list(kind: FinanceRecordKind, q: FinanceListQuery): Promise<FinancePage> {
    const collection = COLLECTION[kind];
    if (!collection || !KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const params = new URLSearchParams({ max: String(Math.max(1, Math.min(q.limit, 100))) });
    if (q.cursor) {
      params.set('page', q.cursor);
    }
    // BILL's list filters differ per object and are not relied on here; every
    // filter is named as ignored so the agent knows the list is wider.
    const ignored = (['query', 'status', 'since', 'until', 'partyId'] as const)
      .filter(key => Boolean(q[key]))
      .map(key => (key === 'partyId' ? 'party_id' : key));
    const page = await call<BillList>(`/${collection.path}?${params.toString()}`, collection.what);
    const data = Array.isArray(page?.results) ? page.results : [];
    return { records: data.map(o => billRecord(kind, o, false)), nextCursor: str(page?.nextPage), ...(ignored.length > 0 ? { ignored } : {}) };
  }

  async function get(kind: FinanceRecordKind, id: string): Promise<FinanceRecord> {
    const collection = COLLECTION[kind];
    if (!collection || !KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const o = await call<BillObject>(`/${collection.path}/${encodeURIComponent(id)}`, collection.what.replace(/s$/, ''));
    return billRecord(kind, o, true);
  }

  return { kind: 'bill', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get };
}
