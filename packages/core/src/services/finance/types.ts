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
 * Read-only by default. The writes are approval actions with a real Undo: a
 * draft invoice that is never sent or charged (`finance.draft_invoice`), an
 * expense line moved to another account (`finance.recategorize_expense`) and
 * a balanced journal entry (`finance.post_journal_entry`). The last two change
 * the books; none of them moves money.
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

/** One line of an invoice, a bill or an expense. Amounts are in major units (dollars, not cents). */
export type FinanceLine = {
  description: string;
  quantity: number | null;
  amount: number | null;
  /** The vendor's id for the line, when it has one: what a recategorization names. */
  id?: string;
  /** The account the line is coded to, on a line coded to an account. */
  accountId?: string;
  accountName?: string;
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

/** The statements a provider can run. */
export const FINANCE_REPORT_KINDS = ['profit_and_loss', 'balance_sheet'] as const;

export type FinanceReportKind = typeof FINANCE_REPORT_KINDS[number];

/** How a statement splits its columns: one total, or one column per month, class or customer. */
export const FINANCE_REPORT_SUMMARIES = ['total', 'month', 'class', 'customer'] as const;

export type FinanceReportQuery = {
  /** The first day of the period (ISO). A balance sheet ignores it. */
  start?: string;
  /** The last day of the period, or the balance sheet's date (ISO). */
  end: string;
  summarizeBy?: typeof FINANCE_REPORT_SUMMARIES[number];
  basis?: 'accrual' | 'cash';
};

/**
 * One row of a statement: an account line with its amounts, or a section
 * (Income, Current Assets) with its rows and its total. `amounts` lines up
 * with the report's `columns`; null is a blank cell.
 */
export type FinanceReportRow = {
  label: string;
  /** The account's id, on an account line. */
  accountId?: string;
  amounts?: Array<number | null>;
  rows?: FinanceReportRow[];
  /** A section's total, labelled as the vendor labels it (Total Income). */
  total?: { label: string; amounts: Array<number | null> };
};

/** A statement, the same shape from every vendor. Amounts are in major units of `currency`. */
export type FinanceReport = {
  kind: FinanceReportKind;
  title: string;
  period: { start: string | null; end: string };
  basis: 'accrual' | 'cash' | null;
  currency: string | null;
  /** The amount columns, left to right (Total; or Jan 2026, Feb 2026, Total). */
  columns: string[];
  rows: FinanceReportRow[];
  /** The bottom lines (Net Income, Total Assets), each with its amounts. */
  totals: Array<{ label: string; amounts: Array<number | null> }>;
  /** What the provider could not do as asked, in words. */
  notes?: string[];
};

/** Move one expense line to another account. */
export type RecategorizeExpenseInput = {
  expenseId: string;
  lineId: string;
  toAccountId: string;
  toAccountName?: string;
  /** Refuse unless the line is on this account now: how Undo leaves a later change alone. */
  expectFromAccountId?: string;
};

export type RecategorizedExpense = {
  expenseId: string;
  lineId: string;
  amount: number | null;
  party: string | null;
  from: { id: string; name: string | null };
  to: { id: string; name: string | null };
  url: string | null;
};

/** A journal entry to post. Each line is a debit or a credit, never both; debits equal credits. */
export type JournalEntryInput = {
  date: string;
  memo: string;
  lines: Array<{
    accountId: string;
    accountName?: string;
    debit?: number;
    credit?: number;
    description?: string;
    className?: string;
    customerId?: string;
  }>;
};

export type PostedJournalEntry = { id: string; number: string | null; url: string | null; total: number; currency: string | null };

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
  /** Present only on a vendor that runs its own statements. */
  report?: (kind: FinanceReportKind, query: FinanceReportQuery) => Promise<FinanceReport>;
  /** Present only on a vendor whose expense lines can be moved to another account. */
  recategorizeExpense?: (input: RecategorizeExpenseInput) => Promise<RecategorizedExpense>;
  /** Present only on a vendor that takes journal entries and can delete one again. */
  postJournalEntry?: (input: JournalEntryInput) => Promise<PostedJournalEntry>;
  deleteJournalEntry?: (id: string) => Promise<void>;
  /** Why this connection writes nothing (the sample company), said by a write that refuses. */
  readOnlyReason?: string;
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
 * What is wrong with a journal entry, or null when it may be posted: every
 * line a debit or a credit above zero and never both, and debits equal to
 * credits to the cent.
 * @param lines - The entry's lines.
 */
export function journalEntryProblem(lines: JournalEntryInput['lines']): string | null {
  if (lines.length < 2) {
    return 'A journal entry needs at least two lines.';
  }
  let debits = 0;
  let credits = 0;
  for (const [i, line] of lines.entries()) {
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    if ((debit > 0) === (credit > 0) || debit < 0 || credit < 0) {
      return `Line ${i + 1} needs exactly one of a debit or a credit above zero.`;
    }
    debits += Math.round(debit * 100);
    credits += Math.round(credit * 100);
  }
  if (debits !== credits) {
    return `Debits (${(debits / 100).toFixed(2)}) and credits (${(credits / 100).toFixed(2)}) differ by ${(Math.abs(debits - credits) / 100).toFixed(2)}; a journal entry posts only when they are equal.`;
  }
  return null;
}

/**
 * A kind the provider does not hold, as a sentence that says which it does.
 * @param vendor - The vendor's name.
 * @param kind - What was asked for.
 * @param kinds - What it holds.
 */
export function unsupportedKind(vendor: string, kind: string, kinds: readonly string[]): Error {
  return new Error(`${vendor} holds no ${kind} records here. It holds: ${kinds.join(', ')}.`);
}
