/**
 * THE FINANCE FAMILY — a business's money as an agent reads it, whichever
 * system holds it.
 *
 * Billing (Stripe), the books (QuickBooks, Xero, NetSuite), spend (Ramp) and
 * payables (BILL) all answer the same handful of questions: who owes what,
 * what we owe, what was paid, what came in. So the agent's tools are named
 * for those records (`finance_list`, `finance_get`) and this is the shape
 * every provider fills in (`providers/*.ts`). The source a workspace
 * connected decides which vendor answers; an agent never names one.
 *
 * Read-only by default. The one write is a draft invoice that is never sent
 * or charged (`finance.draft_invoice`), on a provider that can delete the
 * draft again, so Undo is real.
 */

import type { GrantPersistence } from '@/libs/connect/loginGrant';
import type { FetchLike } from '@/libs/connectors/vendorHttp';

/** The records a finance system can hold. A provider serves the ones its vendor has. */
export const FINANCE_RECORD_KINDS = [
  'customer',
  'vendor',
  'invoice',
  'bill',
  'payment',
  'subscription',
  'payout',
  'transaction',
  'reimbursement',
  'account',
] as const;

export type FinanceRecordKind = typeof FINANCE_RECORD_KINDS[number];

/** One line of an invoice or a bill. Amounts are in major units (dollars, not cents). */
export type FinanceLine = {
  description: string;
  quantity: number | null;
  amount: number | null;
};

/**
 * One record, the same shape from every vendor. Amounts are in major units of
 * `currency`. Dates are ISO (`2026-09-30` or a full timestamp). `url` opens the
 * record in the vendor's own app when the vendor has a stable link, so a claim
 * is checked in one move; null otherwise.
 */
export type FinanceRecord = {
  kind: FinanceRecordKind;
  /** The vendor's id for the record — what `finance_get` takes. */
  id: string;
  /** The number a person knows it by (INV-0042), when it has one. */
  number: string | null;
  /** A one-line name: the customer's name, "Invoice INV-0042 · Contoso Supply". */
  title: string;
  /** The other side: the customer on an invoice, the vendor on a bill, the merchant on a card spend. */
  party: string | null;
  /** The vendor's own status word (draft, open, paid, AUTHORISED, cleared…). */
  status: string | null;
  amount: number | null;
  currency: string | null;
  /** What is still owed on an invoice or bill. */
  balance: number | null;
  /** The record's own date: issued, paid, spent, created. */
  date: string | null;
  dueDate: string | null;
  updatedAt: string | null;
  url: string | null;
  /** Present on a whole record (`get`), for invoices and bills. */
  lines?: FinanceLine[];
  /** Anything else worth reading, flat: an email, a payment method's brand, an approval status. Never a secret. */
  details?: Record<string, string | number | boolean | null>;
};

/** What a list asks for. Every filter is optional; a provider applies the ones its vendor supports and says which it ignored. */
export type FinanceListQuery = {
  /** A name, number or email to look for. */
  query?: string;
  /** The vendor's own status word. */
  status?: string;
  /** Only records dated on or after this ISO date. */
  since?: string;
  /** Only records dated on or before this ISO date. */
  until?: string;
  /** Only records changed at or after this time — what an incremental sync asks. */
  updatedSince?: Date | null;
  /** Only records of this customer or vendor (the vendor's id for it). */
  partyId?: string;
  limit: number;
  /** The `nextCursor` of the page before. */
  cursor?: string | null;
};

export type FinancePage = {
  records: FinanceRecord[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  /** Filters this vendor could not apply, so the agent knows the list is wider than asked. */
  ignored?: string[];
};

/** A draft invoice to create: never sent, never charged, deleted by Undo. */
export type DraftInvoiceInput = {
  /** The customer's id in the finance system (from `finance_list kind=customer`). */
  customerId: string;
  currency?: string;
  /** Days until due, counted from when it is eventually sent. */
  daysUntilDue?: number;
  memo?: string;
  lines: Array<{ description: string; quantity: number; unitAmount: number }>;
};

export type DraftInvoice = { id: string; number: string | null; url: string | null; total: number; currency: string };

export type FinanceProvider = {
  /** The connector kind behind it (`stripe`). */
  kind: string;
  /** The vendor's name, as a person knows it. */
  vendor: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /** The records this vendor holds, in the order a sync reads them. */
  kinds: readonly FinanceRecordKind[];
  list: (kind: FinanceRecordKind, query: FinanceListQuery) => Promise<FinancePage>;
  get: (kind: FinanceRecordKind, id: string) => Promise<FinanceRecord>;
  /** Present only on a vendor with a draft state that can be deleted again. */
  draftInvoice?: (input: DraftInvoiceInput) => Promise<DraftInvoice>;
  /** Deletes a draft the provider created; refuses one that is no longer a draft. */
  discardDraftInvoice?: (id: string) => Promise<void>;
};

/**
 * What a provider is built from: one org's source, its decrypted credential,
 * and where a renewed login is saved. Built per call, never cached.
 */
export type FinanceProviderInput = {
  orgId: string;
  source: { id: number; slug: string; config: Record<string, unknown> };
  credentials: Record<string, unknown>;
  persistence: GrantPersistence;
  fetch?: FetchLike;
};

/** How many records a list returns when the caller does not say, and the most it may ask for. */
export const FINANCE_DEFAULT_LIMIT = 25;
export const FINANCE_MAX_LIMIT = 100;

/**
 * A kind the provider does not hold, as a sentence that says which it does.
 * @param vendor - The vendor's name.
 * @param kind - What was asked for.
 * @param kinds - What it holds.
 */
export function unsupportedKind(vendor: string, kind: string, kinds: readonly string[]): Error {
  return new Error(`${vendor} holds no ${kind} records here. It holds: ${kinds.join(', ')}.`);
}
