/**
 * QUICKBOOKS ONLINE — the books, as a provider of the finance family
 * (`../types.ts`), beside the `quickbooks` source's own sync
 * (`libs/sources/quickbooks.ts`), which this does not replace.
 *
 * Read live with the source's login, renewed and saved through
 * `usableLoginGrant` (Intuit rotates the refresh token). With `sample: true`
 * on the source it reads the fictional sample company in memory, with no
 * login: what the sample holds (invoices, bills, payments, card charges,
 * accounts), filtered here, and statements summed from those same rows.
 *
 * Writes, each behind an approved action with Undo: an expense line moved to
 * another account, and a balanced journal entry posted (and deleted again).
 * QuickBooks has no draft state for an invoice, so no draft is offered. The
 * sample company writes nothing.
 *
 * QuickBooks API facts this file depends on: one `query` endpoint taking its
 * own SQL dialect (`SELECT * FROM Invoice WHERE … ORDERBY … STARTPOSITION n
 * MAXRESULTS m`), AND only, `LIKE` on name fields, strings in single quotes
 * escaped with a backslash; one record by `GET /v3/company/<realm>/<entity>/<id>`;
 * statements by `GET /v3/company/<realm>/reports/<ProfitAndLoss|BalanceSheet>`;
 * a write by `POST /v3/company/<realm>/<entity>` carrying the record's current
 * `SyncToken` (`sparse: true` changes only the fields sent, but an array such
 * as `Line` is replaced whole, so every line is sent back).
 */

import type { FinanceLine, FinanceListQuery, FinancePage, FinanceProvider, FinanceProviderInput, FinanceRecord, FinanceRecordKind, FinanceReport, FinanceReportKind, FinanceReportQuery, FinanceReportRow, JournalEntryInput, PostedJournalEntry, RecategorizedExpense, RecategorizeExpenseInput } from '../types';
import type { QuickbooksEntity, QuickbooksRow } from '@/libs/quickbooks/client';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshQuickbooksGrant } from '@/libs/connect/providers/quickbooks';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { QUICKBOOKS_API_BASE, QUICKBOOKS_APP_HOST, QUICKBOOKS_MINOR_VERSION, quickbooksWrite } from '@/libs/quickbooks/client';
import { SAMPLE_BALANCES_AS_OF, sampleQuickbooksReader, sampleQuickbooksReport } from '@/libs/quickbooks/sampleCompany';
import { journalEntryProblem, unsupportedKind } from '../types';

const VENDOR = 'QuickBooks';

const LIVE_KINDS: readonly FinanceRecordKind[] = ['customer', 'vendor', 'invoice', 'bill', 'payment', 'transaction', 'account'];
const SAMPLE_KINDS: readonly FinanceRecordKind[] = ['invoice', 'bill', 'payment', 'transaction', 'account'];

/** What a write on the sample company says instead of writing. */
const SAMPLE_READ_ONLY = 'The QuickBooks sample company is read-only: nothing is written to its books. Log in with QuickBooks to make this change in a real company.';

/** Each kind's QuickBooks entity, and where it opens in QuickBooks. */
const ENTITY: Partial<Record<FinanceRecordKind, { entity: string; app: (id: string) => string }>> = {
  customer: { entity: 'Customer', app: id => `/app/customerdetail?nameId=${encodeURIComponent(id)}` },
  vendor: { entity: 'Vendor', app: id => `/app/vendordetail?nameId=${encodeURIComponent(id)}` },
  invoice: { entity: 'Invoice', app: id => `/app/invoice?txnId=${encodeURIComponent(id)}` },
  bill: { entity: 'Bill', app: id => `/app/bill?txnId=${encodeURIComponent(id)}` },
  payment: { entity: 'Payment', app: id => `/app/recvpayment?txnId=${encodeURIComponent(id)}` },
  transaction: { entity: 'Purchase', app: id => `/app/expense?txnId=${encodeURIComponent(id)}` },
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

/** How a purchase was paid, as a bookkeeper says it. */
const PAID_BY: Record<string, string> = { CreditCard: 'Card charge', Check: 'Check', Cash: 'Bank expense' };

/**
 * The lines of a transaction, each with its id and, on a line coded to an
 * account, that account. A subtotal line is not an item, so it is left out.
 * @param row - The transaction.
 */
function financeLines(row: QuickbooksRow): FinanceLine[] {
  return (Array.isArray(row.Line) ? row.Line as QuickbooksRow[] : [])
    .filter(line => line.DetailType !== 'SubTotalLineDetail')
    .map((line) => {
      const type = str(line.DetailType);
      const detail = (type && line[type] && typeof line[type] === 'object' ? line[type] : {}) as Record<string, unknown>;
      const what = [ref(detail.ItemRef, 'name') ?? ref(detail.AccountRef, 'name'), str(line.Description)].filter(Boolean).join(': ');
      const id = str(line.Id);
      const accountId = ref(detail.AccountRef, 'value');
      const accountName = ref(detail.AccountRef, 'name');
      return {
        description: what || 'Line',
        quantity: num(detail.Qty),
        amount: num(line.Amount),
        ...(id ? { id } : {}),
        ...(accountId ? { accountId } : {}),
        ...(accountName ? { accountName } : {}),
      };
    });
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
      const lines = financeLines(row);
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
    case 'transaction': {
      const party = ref(row.EntityRef, 'name');
      const paymentType = str(row.PaymentType);
      const label = row.Credit === true ? 'Card refund' : PAID_BY[paymentType ?? ''] ?? 'Expense';
      return {
        ...base,
        number: str(row.DocNumber),
        title: `${label}${party ? ` · ${party}` : ''}${base.date ? ` · ${base.date}` : ''}`,
        party,
        amount: num(row.TotalAmt),
        lines: financeLines(row),
        details: { paymentType, paidFrom: ref(row.AccountRef, 'name'), paidFromId: ref(row.AccountRef, 'value'), partyId: ref(row.EntityRef, 'value'), credit: row.Credit === true, note: str(row.PrivateNote) },
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
  const transaction = kind === 'invoice' || kind === 'bill' || kind === 'payment' || kind === 'transaction';
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

/** Intuit's name for each statement. */
const REPORT_NAME: Record<FinanceReportKind, 'ProfitAndLoss' | 'BalanceSheet'> = { profit_and_loss: 'ProfitAndLoss', balance_sheet: 'BalanceSheet' };

const REPORT_TITLE: Record<FinanceReportKind, string> = { profit_and_loss: 'Profit and Loss', balance_sheet: 'Balance Sheet' };

/** `summarize_column_by` for each way a statement splits its columns. */
const SUMMARIZE_BY: Record<NonNullable<FinanceReportQuery['summarizeBy']>, string> = { total: 'Total', month: 'Month', class: 'Classes', customer: 'Customers' };

/**
 * The query string a statement asks with.
 * @param kind - Which statement.
 * @param q - The period and how to split it.
 */
export function quickbooksReportParams(kind: FinanceReportKind, q: FinanceReportQuery): Record<string, string> {
  const params: Record<string, string> = { end_date: q.end.slice(0, 10), minorversion: QUICKBOOKS_MINOR_VERSION };
  // A balance sheet is one date, which Intuit takes as a period ending there;
  // a profit and loss without a start runs from the start of the end's year.
  params.start_date = kind === 'balance_sheet' ? q.end.slice(0, 10) : (q.start?.slice(0, 10) ?? `${q.end.slice(0, 4)}-01-01`);
  params.summarize_column_by = SUMMARIZE_BY[q.summarizeBy ?? 'total'];
  if (q.basis) {
    params.accounting_method = q.basis === 'cash' ? 'Cash' : 'Accrual';
  }
  return params;
}

type ReportCell = { value?: unknown; id?: unknown };
type IntuitReportRow = { type?: unknown; Header?: { ColData?: ReportCell[] }; Rows?: { Row?: IntuitReportRow[] }; Summary?: { ColData?: ReportCell[] }; ColData?: ReportCell[] };

/**
 * The amount cells of a row, blank as null.
 * @param cells - The row's cells, the label first.
 */
function amountsOf(cells: ReportCell[] | undefined): Array<number | null> {
  return (cells ?? []).slice(1).map((c) => {
    const n = typeof c.value === 'string' && c.value.trim() !== '' ? Number(c.value) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  });
}

/**
 * One of Intuit's report rows as a statement row: a data line, a section with
 * its rows and its total, or a total standing alone (Net Income).
 * @param row - The row.
 */
function reportRow(row: IntuitReportRow): FinanceReportRow | null {
  if (row.ColData) {
    const label = str(row.ColData[0]?.value) ?? '';
    const accountId = str(row.ColData[0]?.id);
    return { label, ...(accountId ? { accountId } : {}), amounts: amountsOf(row.ColData) };
  }
  const summary = row.Summary?.ColData;
  if (!row.Header && summary) {
    return { label: str(summary[0]?.value) ?? '', amounts: amountsOf(summary) };
  }
  const label = str(row.Header?.ColData?.[0]?.value) ?? '';
  const rows = (row.Rows?.Row ?? []).map(reportRow).filter((r): r is FinanceReportRow => r !== null);
  return {
    label,
    rows,
    ...(summary ? { total: { label: str(summary[0]?.value) ?? `Total ${label}`, amounts: amountsOf(summary) } } : {}),
  };
}

/**
 * Intuit's report JSON as a statement. The bottom lines are the top-level
 * totals: each section's total and each total standing alone.
 * @param kind - Which statement.
 * @param body - The report as Intuit answered it.
 * @param notes - What the provider could not do as asked.
 */
export function quickbooksReport(kind: FinanceReportKind, body: unknown, notes: string[] = []): FinanceReport {
  const report = (body ?? {}) as { Header?: Record<string, unknown>; Columns?: { Column?: Array<{ ColTitle?: unknown }> }; Rows?: { Row?: IntuitReportRow[] } };
  const header = report.Header ?? {};
  const basis = str(header.ReportBasis)?.toLowerCase();
  const rows = (report.Rows?.Row ?? []).map(reportRow).filter((r): r is FinanceReportRow => r !== null);
  const totals = rows.flatMap(r => (r.total ? [r.total] : r.rows ? [] : [{ label: r.label, amounts: r.amounts ?? [] }]));
  const start = kind === 'balance_sheet' ? null : str(header.StartPeriod);
  return {
    kind,
    title: REPORT_TITLE[kind],
    period: { start, end: str(header.EndPeriod) ?? '' },
    basis: basis === 'cash' || basis === 'accrual' ? basis : null,
    currency: str(header.Currency),
    columns: (report.Columns?.Column ?? []).slice(1).map(c => str(c.ColTitle) ?? ''),
    rows,
    totals,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/**
 * The account a purchase line is coded to, and the line itself; refuses a
 * line that is not coded to an account (an item line moves with its item).
 * @param row - The Purchase.
 * @param lineId - The line.
 */
function expenseLineOf(row: QuickbooksRow, lineId: string): { line: QuickbooksRow; accountId: string; accountName: string | null } {
  const lines = Array.isArray(row.Line) ? row.Line as QuickbooksRow[] : [];
  const line = lines.find(l => String(l.Id ?? '') === lineId);
  if (!line) {
    throw new Error(`Expense ${String(row.Id)} has no line ${lineId}. Its lines: ${lines.map(l => String(l.Id ?? '')).filter(Boolean).join(', ') || 'none'}.`);
  }
  const detail = line.AccountBasedExpenseLineDetail as Record<string, unknown> | undefined;
  const accountId = ref(detail?.AccountRef, 'value');
  if (line.DetailType !== 'AccountBasedExpenseLineDetail' || !accountId) {
    throw new Error(`Line ${lineId} of expense ${String(row.Id)} is not coded to an account (it is ${str(line.DetailType) ?? 'another kind of line'}), so it cannot be moved to another account.`);
  }
  return { line, accountId, accountName: ref(detail?.AccountRef, 'name') };
}

/**
 * The sparse update that moves one line to another account: every line sent
 * back as it was (QuickBooks replaces the array whole), that one recoded.
 * @param row - The Purchase as read, with its SyncToken.
 * @param lineId - The line to move.
 * @param to - The account it moves to.
 * @param to.id - Its id.
 * @param to.name - Its name, when known.
 */
export function recategorizeBody(row: QuickbooksRow, lineId: string, to: { id: string; name?: string | null }): QuickbooksRow {
  const lines = (Array.isArray(row.Line) ? row.Line as QuickbooksRow[] : []).map((line) => {
    if (String(line.Id ?? '') !== lineId) {
      return line;
    }
    const detail = line.AccountBasedExpenseLineDetail as Record<string, unknown>;
    return { ...line, AccountBasedExpenseLineDetail: { ...detail, AccountRef: { value: to.id, ...(to.name ? { name: to.name } : {}) } } };
  });
  return { Id: row.Id, SyncToken: row.SyncToken, sparse: true, PaymentType: row.PaymentType, AccountRef: row.AccountRef, Line: lines };
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
    const entityOf: Partial<Record<FinanceRecordKind, QuickbooksEntity>> = { invoice: 'Invoice', bill: 'Bill', payment: 'Payment', transaction: 'Purchase', account: 'Account' };
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
      async report(kind, q) {
        const notes: string[] = [];
        const split = kind === 'profit_and_loss' && q.summarizeBy === 'month' ? 'month' : 'total';
        if (q.summarizeBy && q.summarizeBy !== split) {
          notes.push(`The sample company splits ${kind === 'balance_sheet' ? 'a balance sheet by total only' : 'a profit and loss by total or month only'}, so this is the total.`);
        }
        if (q.basis === 'cash') {
          notes.push('The sample company keeps accrual books only, so this is on the accrual basis.');
        }
        if (kind === 'balance_sheet') {
          notes.push(`The sample company's balances stand at ${SAMPLE_BALANCES_AS_OF} whatever date is asked; its equity is assets less liabilities.`);
        }
        return quickbooksReport(kind, sampleQuickbooksReport(REPORT_NAME[kind], quickbooksReportParams(kind, { ...q, summarizeBy: split })), notes);
      },
      readOnlyReason: SAMPLE_READ_ONLY,
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

  const company = `${base}/v3/company/${encodeURIComponent(realmId)}`;
  const write = (entity: QuickbooksEntity, body: QuickbooksRow, operation?: 'delete') =>
    quickbooksWrite({ base, realmId, accessToken: grant.accessToken, entity, body, operation, fetch: input.fetch });

  /**
   * One entity as QuickBooks holds it now, with its current SyncToken.
   * @param entity - The entity.
   * @param id - Its id.
   */
  async function readRow(entity: QuickbooksEntity, id: string): Promise<QuickbooksRow> {
    if (!/^\d+$/.test(id)) {
      throw new Error(`${id} is not a QuickBooks id (digits).`);
    }
    const body = await vendorJson<Record<string, unknown>>({ vendor: VENDOR, what: `the ${entity}`, url: `${company}/${entity.toLowerCase()}/${id}?minorversion=${QUICKBOOKS_MINOR_VERSION}`, fetch: input.fetch, init: { headers } });
    const row = body?.[entity];
    if (!row || typeof row !== 'object') {
      throw new Error(`QuickBooks has no ${entity} ${id}.`);
    }
    return row as QuickbooksRow;
  }

  async function report(kind: FinanceReportKind, q: FinanceReportQuery): Promise<FinanceReport> {
    const params = new URLSearchParams(quickbooksReportParams(kind, q));
    const body = await vendorJson<unknown>({ vendor: VENDOR, what: `the ${REPORT_TITLE[kind]}`, url: `${company}/reports/${REPORT_NAME[kind]}?${params.toString()}`, fetch: input.fetch, init: { headers } });
    return quickbooksReport(kind, body);
  }

  async function recategorizeExpense(change: RecategorizeExpenseInput): Promise<RecategorizedExpense> {
    const row = await readRow('Purchase', change.expenseId);
    const { line, accountId, accountName } = expenseLineOf(row, change.lineId);
    if (change.expectFromAccountId && accountId !== change.expectFromAccountId) {
      throw new Error(`Line ${change.lineId} of expense ${change.expenseId} is coded to ${accountName ?? accountId} now, not the account this change expected, so it was left alone.`);
    }
    if (!/^\d+$/.test(change.toAccountId)) {
      throw new Error(`${change.toAccountId} is not a QuickBooks account id (digits).`);
    }
    const updated = await write('Purchase', recategorizeBody(row, change.lineId, { id: change.toAccountId, name: change.toAccountName }));
    const moved = Array.isArray(updated.Line) ? (updated.Line as QuickbooksRow[]).find(l => String(l.Id ?? '') === change.lineId) : undefined;
    const toName = ref((moved?.AccountBasedExpenseLineDetail as Record<string, unknown> | undefined)?.AccountRef, 'name') ?? change.toAccountName ?? null;
    return {
      expenseId: change.expenseId,
      lineId: change.lineId,
      amount: num(line.Amount),
      party: ref(row.EntityRef, 'name'),
      from: { id: accountId, name: accountName },
      to: { id: change.toAccountId, name: toName },
      url: `${appHost}${ENTITY.transaction!.app(change.expenseId)}`,
    };
  }

  /**
   * A class's id from its name, for a journal line tagged with a class.
   * @param name - The class's name.
   */
  async function classId(name: string): Promise<string> {
    const params = new URLSearchParams({ query: `SELECT * FROM Class WHERE Name = ${literal(name)}`, minorversion: QUICKBOOKS_MINOR_VERSION });
    const body = await vendorJson<{ QueryResponse?: { Class?: QuickbooksRow[] } }>({ vendor: VENDOR, what: 'classes', url: `${company}/query?${params.toString()}`, fetch: input.fetch, init: { headers } });
    const id = body?.QueryResponse?.Class?.[0]?.Id;
    if (!id) {
      throw new Error(`QuickBooks has no class named ${name}; nothing was posted.`);
    }
    return String(id);
  }

  async function postJournalEntry(entry: JournalEntryInput): Promise<PostedJournalEntry> {
    const problem = journalEntryProblem(entry.lines);
    if (problem) {
      throw new Error(problem);
    }
    const classes = new Map<string, string>();
    for (const name of new Set(entry.lines.map(l => l.className).filter((n): n is string => Boolean(n)))) {
      classes.set(name, await classId(name));
    }
    const created = await write('JournalEntry', {
      TxnDate: entry.date.slice(0, 10),
      PrivateNote: entry.memo,
      Line: entry.lines.map(l => ({
        DetailType: 'JournalEntryLineDetail',
        Amount: l.debit && l.debit > 0 ? l.debit : l.credit,
        ...(l.description ? { Description: l.description } : {}),
        JournalEntryLineDetail: {
          PostingType: l.debit && l.debit > 0 ? 'Debit' : 'Credit',
          AccountRef: { value: l.accountId, ...(l.accountName ? { name: l.accountName } : {}) },
          ...(l.className ? { ClassRef: { value: classes.get(l.className), name: l.className } } : {}),
          ...(l.customerId ? { Entity: { Type: 'Customer', EntityRef: { value: l.customerId } } } : {}),
        },
      })),
    });
    const id = String(created.Id ?? '');
    if (!id) {
      throw new Error('QuickBooks answered without the journal entry\'s id; check QuickBooks before posting it again.');
    }
    const total = num(created.TotalAmt) ?? entry.lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
    return { id, number: str(created.DocNumber), url: `${appHost}/app/journal?txnId=${encodeURIComponent(id)}`, total, currency: ref(created.CurrencyRef, 'value') };
  }

  async function deleteJournalEntry(id: string): Promise<void> {
    const row = await readRow('JournalEntry', id);
    await write('JournalEntry', { Id: row.Id, SyncToken: row.SyncToken }, 'delete');
  }

  return { kind: 'quickbooks', vendor: VENDOR, sourceSlug: input.source.slug, kinds: LIVE_KINDS, list, get, report, recategorizeExpense, postJournalEntry, deleteJournalEntry };
}
