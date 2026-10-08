/**
 * STRIPE — billing, as a provider of the finance family (`../types.ts`).
 *
 * Read live with the workspace's restricted key: customers, invoices,
 * subscriptions, payments (charges) and payouts. Nothing it reads moves
 * money. The one write is a draft invoice (`auto_advance: false`, sent by
 * nobody), deleted by Undo — Stripe deletes only drafts, so a draft someone
 * has since finalized refuses the Undo rather than vanishing.
 *
 * Stripe API facts this file depends on: Bearer auth; form-encoded writes;
 * lists page by `starting_after=<last id>` with `has_more`; the Search API
 * (`/v1/<resource>/search`, customers and invoices here) pages by `page`
 * with `next_page`; amounts are integers in the currency's minor unit,
 * except zero-decimal currencies; `created` and dates are Unix seconds.
 */

import type { DraftInvoice, DraftInvoiceInput, FinanceLine, FinanceListQuery, FinancePage, FinanceProvider, FinanceProviderInput, FinanceRecord, FinanceRecordKind } from '../types';
import type { FetchLike } from '@/libs/connectors/vendorHttp';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { unsupportedKind } from '../types';

const API = 'https://api.stripe.com/v1';
const VENDOR = 'Stripe';

/** Currencies Stripe counts in whole units (no cents). */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

const KINDS: readonly FinanceRecordKind[] = ['customer', 'invoice', 'subscription', 'payment', 'payout'];

/** Each kind's API collection and its dashboard path. */
const COLLECTION: Partial<Record<FinanceRecordKind, { path: string; dashboard: string; what: string }>> = {
  customer: { path: 'customers', dashboard: 'customers', what: 'customers' },
  invoice: { path: 'invoices', dashboard: 'invoices', what: 'invoices' },
  subscription: { path: 'subscriptions', dashboard: 'subscriptions', what: 'subscriptions' },
  payment: { path: 'charges', dashboard: 'payments', what: 'payments' },
  payout: { path: 'payouts', dashboard: 'payouts', what: 'payouts' },
};

type StripeObject = Record<string, unknown>;
type StripeList = { data?: StripeObject[]; has_more?: boolean; next_page?: string | null };

/**
 * An amount in the currency's minor unit, in major units.
 * @param minor - The integer Stripe sent.
 * @param currency - The currency code.
 */
export function stripeMajor(minor: unknown, currency: unknown): number | null {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) {
    return null;
  }
  return typeof currency === 'string' && ZERO_DECIMAL.has(currency.toLowerCase()) ? minor : minor / 100;
}

/**
 * Major units back to Stripe's integer minor unit.
 * @param major - The amount.
 * @param currency - The currency code, when known.
 */
function stripeMinor(major: number, currency: string | undefined): number {
  return Math.round(currency && ZERO_DECIMAL.has(currency) ? major : major * 100);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A Unix-seconds field as an ISO date.
 * @param seconds - The field.
 */
function isoDate(seconds: unknown): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;
}

/**
 * An ISO date as Unix seconds, for `created[gte]`.
 * @param iso - The date.
 * @param endOfDay - Whether to take the end of that day.
 */
function unix(iso: string, endOfDay = false): number {
  const ms = Date.parse(iso.length === 10 ? `${iso}T${endOfDay ? '23:59:59' : '00:00:00'}Z` : iso);
  return Math.floor(ms / 1000);
}

/**
 * The name on a customer that may or may not be expanded.
 * @param value - A customer id, or an expanded customer.
 */
function customerName(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const c = value as StripeObject;
    return str(c.name) ?? str(c.email) ?? str(c.id);
  }
  return str(value);
}

function customerId(value: unknown): string | null {
  return value && typeof value === 'object' ? str((value as StripeObject).id) : str(value);
}

/**
 * One Stripe object as a finance record.
 * @param kind - What it is.
 * @param o - The object.
 * @param dashboard - The dashboard base for links (test mode has its own).
 * @param whole - Whether to include lines.
 */
export function stripeRecord(kind: FinanceRecordKind, o: StripeObject, dashboard: string, whole: boolean): FinanceRecord {
  const id = String(o.id ?? '');
  const currency = str(o.currency)?.toUpperCase() ?? null;
  const link = `${dashboard}/${COLLECTION[kind]?.dashboard ?? ''}/${encodeURIComponent(id)}`;
  const base: FinanceRecord = { kind, id, number: null, title: id, party: null, status: null, amount: null, currency, balance: null, date: isoDate(o.created), dueDate: null, updatedAt: null, url: link };
  switch (kind) {
    case 'customer':
      return {
        ...base,
        title: str(o.name) ?? str(o.email) ?? id,
        details: { email: str(o.email), description: str(o.description), delinquent: typeof o.delinquent === 'boolean' ? o.delinquent : null },
      };
    case 'invoice': {
      const party = str(o.customer_name) ?? str(o.customer_email) ?? customerName(o.customer);
      const number = str(o.number);
      const lines: FinanceLine[] = Array.isArray((o.lines as StripeList | undefined)?.data)
        ? ((o.lines as StripeList).data ?? []).map(line => ({ description: str(line.description) ?? 'Line item', quantity: typeof line.quantity === 'number' ? line.quantity : null, amount: stripeMajor(line.amount, o.currency) }))
        : [];
      return {
        ...base,
        number,
        title: `Invoice ${number ?? id}${party ? ` · ${party}` : ''}`,
        party,
        status: str(o.status),
        amount: stripeMajor(o.total, o.currency),
        balance: stripeMajor(o.amount_remaining, o.currency),
        dueDate: isoDate(o.due_date),
        ...(whole ? { lines } : {}),
        details: { customerId: customerId(o.customer), amountPaid: stripeMajor(o.amount_paid, o.currency), collection: str(o.collection_method), subscription: str(o.subscription) },
      };
    }
    case 'subscription': {
      const items = Array.isArray((o.items as StripeList | undefined)?.data) ? (o.items as StripeList).data ?? [] : [];
      const minor = items.reduce((sum, item) => {
        const price = (item.price ?? {}) as StripeObject;
        const unit = typeof price.unit_amount === 'number' ? price.unit_amount : 0;
        return sum + unit * (typeof item.quantity === 'number' ? item.quantity : 1);
      }, 0);
      const interval = items.map(item => str((((item.price ?? {}) as StripeObject).recurring as StripeObject | undefined)?.interval)).find(Boolean) ?? null;
      const party = customerName(o.customer);
      return {
        ...base,
        title: `Subscription${party ? ` · ${party}` : ''}`,
        party,
        status: str(o.status),
        amount: items.length > 0 ? stripeMajor(minor, o.currency) : null,
        date: isoDate(o.start_date) ?? base.date,
        details: { customerId: customerId(o.customer), interval, renews: isoDate(o.current_period_end ?? items[0]?.current_period_end), cancelAtPeriodEnd: typeof o.cancel_at_period_end === 'boolean' ? o.cancel_at_period_end : null },
      };
    }
    case 'payment': {
      const billing = (o.billing_details ?? {}) as StripeObject;
      const party = str(billing.name) ?? str(billing.email) ?? customerName(o.customer);
      return {
        ...base,
        title: `Payment${party ? ` · ${party}` : ''}`,
        party,
        status: str(o.status),
        amount: stripeMajor(o.amount, o.currency),
        url: `${dashboard}/payments/${encodeURIComponent(str(o.payment_intent) ?? id)}`,
        details: { description: str(o.description), refunded: stripeMajor(o.amount_refunded, o.currency), invoice: str(o.invoice), customerId: customerId(o.customer) },
      };
    }
    case 'payout':
      return {
        ...base,
        title: `Payout ${isoDate(o.arrival_date) ?? id}`,
        status: str(o.status),
        amount: stripeMajor(o.amount, o.currency),
        date: isoDate(o.arrival_date) ?? base.date,
        details: { method: str(o.method), description: str(o.description) },
      };
    default:
      return base;
  }
}

/**
 * A Stripe search-query string literal, quotes escaped.
 * @param value - The text a person or agent typed.
 */
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/**
 * The provider, over one workspace's key. Built per call.
 * @param input - The source and its credential.
 */
export function stripeFinanceProvider(input: FinanceProviderInput): FinanceProvider {
  const key = typeof input.credentials.apiKey === 'string' ? input.credentials.apiKey.trim() : '';
  if (!key) {
    throw new Error('No Stripe key is stored for this source. An admin pastes a restricted key on the Connectors page.');
  }
  const doFetch: FetchLike | undefined = input.fetch;
  const dashboard = /^[rs]k_test_/.test(key) ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' };

  const call = <T>(path: string, what: string, init?: { method?: string; form?: URLSearchParams }) => vendorJson<T>({
    vendor: VENDOR,
    what,
    url: `${API}${path}`,
    fetch: doFetch,
    init: {
      method: init?.method ?? 'GET',
      headers: init?.form ? { ...headers, 'content-type': 'application/x-www-form-urlencoded' } : headers,
      ...(init?.form ? { body: init.form.toString() } : {}),
    },
  });

  async function list(kind: FinanceRecordKind, q: FinanceListQuery): Promise<FinancePage> {
    const collection = COLLECTION[kind];
    if (!collection || !KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const ignored: string[] = [];
    const limit = Math.max(1, Math.min(q.limit, 100));
    const params = new URLSearchParams({ limit: String(limit) });
    const searchable = (kind === 'customer' || kind === 'invoice') && Boolean(q.query);
    if (searchable) {
      // The Search API: a text filter the list endpoints do not have.
      const clauses: string[] = kind === 'customer'
        ? [`name~${quote(q.query!)} OR email~${quote(q.query!)}`]
        : [`number:${quote(q.query!)}`];
      if (kind === 'invoice' && q.status) {
        clauses.push(`status:${quote(q.status)}`);
      }
      if (kind === 'invoice' && q.partyId) {
        clauses.push(`customer:${quote(q.partyId)}`);
      }
      if (q.since) {
        clauses.push(`created>=${unix(q.since)}`);
      }
      if (q.until) {
        clauses.push(`created<=${unix(q.until, true)}`);
      }
      params.set('query', clauses.map(c => (clauses.length > 1 && c.includes(' OR ') ? `(${c})` : c)).join(' AND '));
      if (q.cursor?.startsWith('page:')) {
        params.set('page', q.cursor.slice(5));
      }
    } else {
      if (q.query) {
        ignored.push('query');
      }
      if (q.status) {
        if (kind === 'invoice' || kind === 'subscription' || kind === 'payout') {
          params.set('status', q.status);
        } else {
          ignored.push('status');
        }
      }
      if (q.partyId) {
        if (kind === 'invoice' || kind === 'subscription' || kind === 'payment') {
          params.set('customer', q.partyId);
        } else {
          ignored.push('party_id');
        }
      }
      // `created` is the one date every list filters on; a sync's watermark
      // reads it too, since Stripe exposes no "updated since".
      const since = q.since ? unix(q.since) : q.updatedSince ? Math.floor(q.updatedSince.getTime() / 1000) : null;
      if (since !== null) {
        params.set('created[gte]', String(since));
      }
      if (q.until) {
        params.set('created[lte]', String(unix(q.until, true)));
      }
      if (kind === 'subscription') {
        params.append('expand[]', 'data.customer');
        if (!q.status) {
          // Stripe lists only live subscriptions by default; a person asking for "subscriptions" means all of them.
          params.set('status', 'all');
        }
      }
      if (q.cursor?.startsWith('after:')) {
        params.set('starting_after', q.cursor.slice(6));
      }
    }
    const page = await call<StripeList>(`/${collection.path}${searchable ? '/search' : ''}?${params.toString()}`, collection.what);
    const data = Array.isArray(page?.data) ? page.data : [];
    const records = data.map(o => stripeRecord(kind, o, dashboard, false));
    let nextCursor: string | null = null;
    if (page?.has_more) {
      nextCursor = searchable ? (page.next_page ? `page:${page.next_page}` : null) : (records.at(-1) ? `after:${records.at(-1)!.id}` : null);
    }
    return { records, nextCursor, ...(ignored.length > 0 ? { ignored } : {}) };
  }

  async function get(kind: FinanceRecordKind, id: string): Promise<FinanceRecord> {
    const collection = COLLECTION[kind];
    if (!collection || !KINDS.includes(kind)) {
      throw unsupportedKind(VENDOR, kind, KINDS);
    }
    const expand = kind === 'subscription' ? '?expand[]=customer' : '';
    const o = await call<StripeObject>(`/${collection.path}/${encodeURIComponent(id)}${expand}`, collection.what.replace(/s$/, ''));
    return stripeRecord(kind, o, dashboard, true);
  }

  async function draftInvoice(draft: DraftInvoiceInput): Promise<DraftInvoice> {
    const form = new URLSearchParams({
      'customer': draft.customerId,
      'auto_advance': 'false',
      'collection_method': 'send_invoice',
      'days_until_due': String(draft.daysUntilDue ?? 30),
      'pending_invoice_items_behavior': 'exclude',
      'metadata[created_by]': 'vocion',
    });
    if (draft.currency) {
      form.set('currency', draft.currency);
    }
    if (draft.memo) {
      form.set('description', draft.memo);
    }
    const invoice = await call<StripeObject>('/invoices', 'a draft invoice', { method: 'POST', form });
    const invoiceId = String(invoice.id);
    const currency = str(invoice.currency) ?? draft.currency;
    try {
      for (const line of draft.lines) {
        // One total per line: Stripe's invoice item `amount` is the line's
        // whole price, so a fractional quantity survives, written into the text.
        const item = new URLSearchParams({
          customer: draft.customerId,
          invoice: invoiceId,
          amount: String(stripeMinor(line.quantity * line.unitAmount, currency ?? undefined)),
          description: line.quantity === 1 ? line.description : `${line.quantity} × ${line.description}`,
        });
        if (currency) {
          item.set('currency', currency);
        }
        await call('/invoiceitems', 'an invoice line', { method: 'POST', form: item });
      }
    } catch (error) {
      // A half-built draft is worse than none: take it back, then say why.
      await call(`/invoices/${encodeURIComponent(invoiceId)}`, 'the draft invoice', { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
    const final = await call<StripeObject>(`/invoices/${encodeURIComponent(invoiceId)}`, 'the draft invoice');
    return {
      id: invoiceId,
      number: str(final.number),
      url: `${dashboard}/invoices/${encodeURIComponent(invoiceId)}`,
      total: stripeMajor(final.total, final.currency) ?? 0,
      currency: str(final.currency) ?? currency ?? '',
    };
  }

  async function discardDraftInvoice(id: string): Promise<void> {
    const invoice = await call<StripeObject>(`/invoices/${encodeURIComponent(id)}`, 'the draft invoice');
    if (invoice.status !== 'draft') {
      throw new Error(`Stripe invoice ${id} is ${String(invoice.status)} now, not a draft, so it was left alone. Void it in Stripe if it should not stand.`);
    }
    await call(`/invoices/${encodeURIComponent(id)}`, 'the draft invoice', { method: 'DELETE' });
  }

  return { kind: 'stripe', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get, draftInvoice, discardDraftInvoice };
}
