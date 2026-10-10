/**
 * A fictional QuickBooks Online company, in the API's own JSON shapes, so the
 * QuickBooks connector works with no Intuit app and no credentials: a source
 * with `sample: true` reads these rows through the same mapping the real
 * books go through, and every document it makes says it is sample data.
 *
 * The books belong to Larkfield Systems, the fixture cast's client tenant.
 * Customers and vendors come from the same cast (`libs/fixtures/realDataGuard.ts`):
 * Northwind is on retainer, Bellwater Hall is the venue Larkfield hires.
 * Nothing here is real: names, ids, amounts and dates are made up.
 */

import type { QuickbooksEntity, QuickbooksReader, QuickbooksRow } from './client';

/** The sample company's name, as its documents say it. */
export const SAMPLE_COMPANY_NAME = 'Larkfield Systems (sample company)';

/**
 * Metadata as QuickBooks stamps it.
 * @param created - When the row was created, ISO.
 * @param updated - When it last changed, ISO; defaults to `created`.
 */
function meta(created: string, updated: string = created): QuickbooksRow {
  return { CreateTime: created, LastUpdatedTime: updated };
}

const USD = { value: 'USD', name: 'United States Dollar' };

const ACCOUNTS: QuickbooksRow[] = [
  { Id: '35', Name: 'Operating Checking', AcctNum: '1010', AccountType: 'Bank', AccountSubType: 'Checking', Classification: 'Asset', CurrentBalance: 184_250.4, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-10-01T16:20:00-07:00') },
  { Id: '84', Name: 'Accounts Receivable (A/R)', AcctNum: '1200', AccountType: 'Accounts Receivable', AccountSubType: 'AccountsReceivable', Classification: 'Asset', CurrentBalance: 42_100, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-10-01T16:20:00-07:00') },
  { Id: '41', Name: 'Company Card', AcctNum: '2100', AccountType: 'Credit Card', AccountSubType: 'CreditCard', Classification: 'Liability', CurrentBalance: 2_787, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-10-01T16:20:00-07:00') },
  { Id: '33', Name: 'Accounts Payable (A/P)', AcctNum: '2000', AccountType: 'Accounts Payable', AccountSubType: 'AccountsPayable', Classification: 'Liability', CurrentBalance: 9_840, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T11:05:00-07:00') },
  { Id: '79', Name: 'Services Revenue', AcctNum: '4000', AccountType: 'Income', AccountSubType: 'ServiceFeeIncome', Classification: 'Revenue', CurrentBalance: 412_600, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T11:05:00-07:00') },
  { Id: '58', Name: 'Rent and Facilities', AcctNum: '6100', AccountType: 'Expense', AccountSubType: 'RentOrLeaseOfBuildings', Classification: 'Expense', CurrentBalance: 63_000, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-28T10:00:00-07:00') },
  { Id: '60', Name: 'Events and Venues', AcctNum: '6200', AccountType: 'Expense', AccountSubType: 'Entertainment', Classification: 'Expense', CurrentBalance: 14_500, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-20T15:30:00-07:00') },
  { Id: '62', Name: 'Marketing', AcctNum: '6300', AccountType: 'Expense', AccountSubType: 'AdvertisingPromotional', Classification: 'Expense', CurrentBalance: 22_340, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T11:05:00-07:00') },
  { Id: '66', Name: 'Software and Subscriptions', AcctNum: '6400', AccountType: 'Expense', AccountSubType: 'OtherMiscellaneousServiceCost', Classification: 'Expense', CurrentBalance: 9_612, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-10-01T16:20:00-07:00') },
  { Id: '68', Name: 'Office Supplies and Equipment', AcctNum: '6500', AccountType: 'Expense', AccountSubType: 'OfficeGeneralAdministrativeExpenses', Classification: 'Expense', CurrentBalance: 3_180, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-12T12:00:00-07:00') },
  { Id: '64', Name: 'Depreciation', AcctNum: '6900', AccountType: 'Expense', AccountSubType: 'Depreciation', Classification: 'Expense', CurrentBalance: 6_750, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T18:00:00-07:00') },
];

/**
 * A sales line on an invoice.
 * @param id - The line id.
 * @param item - The product or service.
 * @param description - The line's description.
 * @param qty - How many.
 * @param unitPrice - At what.
 */
function salesLine(id: string, item: string, description: string, qty: number, unitPrice: number): QuickbooksRow {
  return {
    Id: id,
    LineNum: Number(id),
    Description: description,
    Amount: qty * unitPrice,
    DetailType: 'SalesItemLineDetail',
    SalesItemLineDetail: { ItemRef: { value: id, name: item }, Qty: qty, UnitPrice: unitPrice },
  };
}

/**
 * An expense line on a bill or a purchase, coded to one of the accounts below.
 * @param id - The line id.
 * @param account - The expense account's name.
 * @param description - The line's description.
 * @param amount - How much.
 */
function expenseLine(id: string, account: string, description: string, amount: number): QuickbooksRow {
  const coded = ACCOUNTS.find(row => row.Name === account);
  return {
    Id: id,
    Description: description,
    Amount: amount,
    DetailType: 'AccountBasedExpenseLineDetail',
    AccountBasedExpenseLineDetail: { AccountRef: { value: String(coded?.Id ?? id), name: account }, BillableStatus: 'NotBillable' },
  };
}

/**
 * A debit or credit on a journal entry.
 * @param id - The line id.
 * @param posting - Debit or Credit.
 * @param account - The account posted to.
 * @param amount - How much.
 * @param description - Why.
 */
function journalLine(id: string, posting: 'Debit' | 'Credit', account: string, amount: number, description: string): QuickbooksRow {
  return {
    Id: id,
    Description: description,
    Amount: amount,
    DetailType: 'JournalEntryLineDetail',
    JournalEntryLineDetail: { PostingType: posting, AccountRef: { value: id, name: account } },
  };
}

const INVOICES: QuickbooksRow[] = [
  {
    Id: '130',
    DocNumber: '1041',
    TxnDate: '2026-08-01',
    DueDate: '2026-08-31',
    CustomerRef: { value: '7', name: 'Northwind' },
    CurrencyRef: USD,
    TotalAmt: 12_000,
    Balance: 0,
    Line: [salesLine('1', 'Retainer', 'Monthly operations retainer, August', 1, 12_000)],
    CustomerMemo: { value: 'Thank you for your business.' },
    MetaData: meta('2026-08-01T08:30:00-07:00', '2026-08-29T10:12:00-07:00'),
  },
  {
    Id: '131',
    DocNumber: '1042',
    TxnDate: '2026-09-01',
    DueDate: '2026-10-01',
    CustomerRef: { value: '7', name: 'Northwind' },
    CurrencyRef: USD,
    TotalAmt: 14_500,
    Balance: 2_500,
    Line: [
      salesLine('1', 'Retainer', 'Monthly operations retainer, September', 1, 12_000),
      salesLine('2', 'Workshop', 'Onboarding workshop, two sessions', 2, 1_250),
    ],
    MetaData: meta('2026-09-01T08:30:00-07:00', '2026-09-22T14:40:00-07:00'),
  },
  {
    Id: '132',
    DocNumber: '1043',
    TxnDate: '2026-09-05',
    DueDate: '2026-10-05',
    CustomerRef: { value: '9', name: 'Meridian Dental' },
    CurrencyRef: USD,
    TotalAmt: 8_400,
    Balance: 8_400,
    Line: [salesLine('1', 'Implementation', 'Scheduling system implementation, phase one', 42, 200)],
    PrivateNote: 'Phase two to be quoted separately.',
    MetaData: meta('2026-09-05T11:00:00-07:00'),
  },
  {
    Id: '133',
    DocNumber: '1044',
    TxnDate: '2026-09-15',
    DueDate: '2026-10-15',
    CustomerRef: { value: '11', name: 'Atlas Field Services' },
    CurrencyRef: USD,
    TotalAmt: 19_200,
    Balance: 19_200,
    Line: [
      salesLine('1', 'Implementation', 'Dispatch workflow build', 64, 250),
      salesLine('2', 'Training', 'Field team training day', 1, 3_200),
    ],
    MetaData: meta('2026-09-15T09:45:00-07:00'),
  },
  {
    Id: '134',
    DocNumber: '1045',
    TxnDate: '2026-10-01',
    DueDate: '2026-10-31',
    CustomerRef: { value: '7', name: 'Northwind' },
    CurrencyRef: USD,
    TotalAmt: 12_000,
    Balance: 12_000,
    Line: [salesLine('1', 'Retainer', 'Monthly operations retainer, October', 1, 12_000)],
    MetaData: meta('2026-10-01T08:30:00-07:00'),
  },
];

const BILLS: QuickbooksRow[] = [
  {
    Id: '210',
    DocNumber: 'BH-2207',
    TxnDate: '2026-09-10',
    DueDate: '2026-09-25',
    VendorRef: { value: '21', name: 'Bellwater Hall' },
    CurrencyRef: USD,
    TotalAmt: 6_500,
    Balance: 0,
    Line: [expenseLine('1', 'Events and Venues', 'Venue hire for the September customer forum', 6_500)],
    MetaData: meta('2026-09-10T13:00:00-07:00', '2026-09-20T15:30:00-07:00'),
  },
  {
    Id: '211',
    DocNumber: 'SF-0930',
    TxnDate: '2026-09-28',
    DueDate: '2026-10-10',
    VendorRef: { value: '22', name: 'Summit Facilities' },
    CurrencyRef: USD,
    TotalAmt: 7_000,
    Balance: 7_000,
    Line: [expenseLine('1', 'Rent and Facilities', 'Office lease and facilities, October', 7_000)],
    MetaData: meta('2026-09-28T10:00:00-07:00'),
  },
  {
    Id: '212',
    DocNumber: 'CM-118',
    TxnDate: '2026-09-30',
    DueDate: '2026-10-30',
    VendorRef: { value: '23', name: 'Corvus Media' },
    CurrencyRef: USD,
    TotalAmt: 4_340,
    Balance: 2_840,
    Line: [
      expenseLine('1', 'Marketing', 'Paid social campaign, September', 3_340),
      expenseLine('2', 'Marketing', 'Case study video edit', 1_000),
    ],
    PrivateNote: 'Deposit paid on signature.',
    MetaData: meta('2026-09-30T11:05:00-07:00'),
  },
];

const PAYMENTS: QuickbooksRow[] = [
  {
    Id: '301',
    TxnDate: '2026-08-29',
    CustomerRef: { value: '7', name: 'Northwind' },
    CurrencyRef: USD,
    TotalAmt: 12_000,
    UnappliedAmt: 0,
    PaymentRefNum: 'ACH-55120',
    DepositToAccountRef: { value: '35', name: 'Operating Checking' },
    Line: [{ Amount: 12_000, LinkedTxn: [{ TxnId: '130', TxnType: 'Invoice' }] }],
    MetaData: meta('2026-08-29T10:12:00-07:00'),
  },
  {
    Id: '302',
    TxnDate: '2026-09-22',
    CustomerRef: { value: '7', name: 'Northwind' },
    CurrencyRef: USD,
    TotalAmt: 12_000,
    UnappliedAmt: 0,
    PaymentRefNum: 'ACH-55871',
    DepositToAccountRef: { value: '35', name: 'Operating Checking' },
    Line: [{ Amount: 12_000, LinkedTxn: [{ TxnId: '131', TxnType: 'Invoice' }] }],
    MetaData: meta('2026-09-22T14:40:00-07:00'),
  },
];

const BILL_PAYMENTS: QuickbooksRow[] = [
  {
    Id: '401',
    DocNumber: '5512',
    TxnDate: '2026-09-20',
    VendorRef: { value: '21', name: 'Bellwater Hall' },
    CurrencyRef: USD,
    TotalAmt: 6_500,
    PayType: 'Check',
    CheckPayment: { BankAccountRef: { value: '35', name: 'Operating Checking' } },
    Line: [{ Amount: 6_500, LinkedTxn: [{ TxnId: '210', TxnType: 'Bill' }] }],
    MetaData: meta('2026-09-20T15:30:00-07:00'),
  },
  {
    Id: '402',
    DocNumber: '5513',
    TxnDate: '2026-09-30',
    VendorRef: { value: '23', name: 'Corvus Media' },
    CurrencyRef: USD,
    TotalAmt: 1_500,
    PayType: 'Check',
    CheckPayment: { BankAccountRef: { value: '35', name: 'Operating Checking' } },
    Line: [{ Amount: 1_500, LinkedTxn: [{ TxnId: '212', TxnType: 'Bill' }] }],
    MetaData: meta('2026-09-30T11:05:00-07:00'),
  },
];

const CARD = { value: '41', name: 'Company Card' };

/**
 * Card charges, as QuickBooks holds them: `Purchase` rows paid from the
 * company card. The Apple laptop is coded to Marketing, a mistake left in on
 * purpose, so a recategorization has something to find.
 */
const PURCHASES: QuickbooksRow[] = [
  {
    Id: '601',
    TxnDate: '2026-09-03',
    PaymentType: 'CreditCard',
    AccountRef: CARD,
    EntityRef: { value: '31', name: 'Anthropic', type: 'Vendor' },
    CurrencyRef: USD,
    TotalAmt: 750,
    Credit: false,
    Line: [expenseLine('1', 'Software and Subscriptions', 'Claude Team plan, September, 25 seats', 750)],
    MetaData: meta('2026-09-04T09:10:00-07:00'),
  },
  {
    Id: '602',
    TxnDate: '2026-09-08',
    PaymentType: 'CreditCard',
    AccountRef: CARD,
    EntityRef: { value: '32', name: 'Loom', type: 'Vendor' },
    CurrencyRef: USD,
    TotalAmt: 150,
    Credit: false,
    Line: [expenseLine('1', 'Software and Subscriptions', 'Loom Business, 10 seats, September', 150)],
    MetaData: meta('2026-09-09T09:10:00-07:00'),
  },
  {
    Id: '603',
    TxnDate: '2026-09-12',
    PaymentType: 'CreditCard',
    AccountRef: CARD,
    EntityRef: { value: '33', name: 'Apple', type: 'Vendor' },
    CurrencyRef: USD,
    TotalAmt: 1_299,
    Credit: false,
    Line: [expenseLine('1', 'Marketing', 'MacBook Air for the operations coordinator', 1_299)],
    PrivateNote: 'Receipt in the shared drive.',
    MetaData: meta('2026-09-12T12:00:00-07:00'),
  },
  {
    Id: '604',
    TxnDate: '2026-10-01',
    PaymentType: 'CreditCard',
    AccountRef: CARD,
    EntityRef: { value: '34', name: 'Google', type: 'Vendor' },
    CurrencyRef: USD,
    TotalAmt: 588,
    Credit: false,
    Line: [
      expenseLine('1', 'Software and Subscriptions', 'Google Workspace Business Standard, 12 users, October', 168),
      expenseLine('2', 'Marketing', 'Google Ads, September', 420),
    ],
    MetaData: meta('2026-10-01T16:20:00-07:00'),
  },
];

const JOURNAL_ENTRIES: QuickbooksRow[] = [
  {
    Id: '501',
    DocNumber: 'JE-0930-1',
    TxnDate: '2026-09-30',
    CurrencyRef: USD,
    PrivateNote: 'September depreciation on office equipment.',
    Line: [
      journalLine('0', 'Debit', 'Depreciation', 750, 'Office equipment, September'),
      journalLine('1', 'Credit', 'Accumulated Depreciation', 750, 'Office equipment, September'),
    ],
    MetaData: meta('2026-09-30T18:00:00-07:00'),
  },
  {
    Id: '502',
    DocNumber: 'JE-0930-2',
    TxnDate: '2026-09-30',
    CurrencyRef: USD,
    PrivateNote: 'Accrue September workshop revenue earned but not yet invoiced.',
    Line: [
      journalLine('0', 'Debit', 'Unbilled Receivables', 2_500, 'Atlas Field Services workshop, delivered 2026-09-29'),
      journalLine('1', 'Credit', 'Services Revenue', 2_500, 'Atlas Field Services workshop, delivered 2026-09-29'),
    ],
    MetaData: meta('2026-09-30T18:10:00-07:00'),
  },
];

const ROWS: Record<QuickbooksEntity, QuickbooksRow[]> = {
  Account: ACCOUNTS,
  Invoice: INVOICES,
  Bill: BILLS,
  Payment: PAYMENTS,
  BillPayment: BILL_PAYMENTS,
  Purchase: PURCHASES,
  JournalEntry: JOURNAL_ENTRIES,
};

/**
 * When a sample row last changed.
 * @param row - A row from the tables above.
 */
function lastUpdated(row: QuickbooksRow): number {
  const at = (row.MetaData as { LastUpdatedTime?: string } | undefined)?.LastUpdatedTime;
  return at ? Date.parse(at) : 0;
}

/**
 * A reader over the sample company. Answers the way the live API does:
 * paged from position 1, filtered on the last-updated watermark.
 */
export function sampleQuickbooksReader(): QuickbooksReader {
  return {
    realmId: 'sample',
    sample: true,
    appHost: null,
    async query(entity, page) {
      const since = page.since ? page.since.getTime() : null;
      const rows = ROWS[entity].filter(row => since === null || lastUpdated(row) >= since);
      return rows.slice(page.start - 1, page.start - 1 + page.max).map(row => structuredClone(row));
    },
  };
}

/** The date the sample's account balances stand at. */
export const SAMPLE_BALANCES_AS_OF = '2026-10-01';

type Cell = { value: string; id?: string };
type ReportRow = { type: 'Section' | 'Data'; group?: string; Header?: { ColData: Cell[] }; Rows?: { Row: ReportRow[] }; Summary?: { ColData: Cell[] }; ColData?: Cell[] };

/**
 * An amount as a report cell: two decimals, blank for nothing.
 * @param amount - The figure.
 */
function cell(amount: number | null): Cell {
  return { value: amount === null ? '' : amount.toFixed(2) };
}

/**
 * The months a period spans, as `YYYY-MM`.
 * @param start - The first day.
 * @param end - The last day.
 */
function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.slice(0, 7).split('-').map(Number) as [number, number];
  const last = end.slice(0, 7);
  for (let guard = 0; guard < 120; guard += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) {
      break;
    }
    m = m === 12 ? 1 : m + 1;
    y = m === 1 ? y + 1 : y;
  }
  return out;
}

/**
 * Every amount the sample's transactions post to an income or expense
 * account, signed so income and expense each read as positive: invoice lines
 * to Services Revenue, bill and card lines to their expense accounts, and
 * journal lines to whichever income or expense account they name.
 */
function profitAndLossPostings(): Array<{ account: string; date: string; amount: number }> {
  const classification = (name: string) => ACCOUNTS.find(row => row.Name === name)?.Classification;
  const out: Array<{ account: string; date: string; amount: number }> = [];
  for (const invoice of INVOICES) {
    for (const line of invoice.Line as QuickbooksRow[]) {
      out.push({ account: 'Services Revenue', date: String(invoice.TxnDate), amount: Number(line.Amount) });
    }
  }
  for (const row of [...BILLS, ...PURCHASES]) {
    for (const line of row.Line as QuickbooksRow[]) {
      const account = ((line.AccountBasedExpenseLineDetail as { AccountRef?: { name?: string } } | undefined)?.AccountRef?.name) ?? '';
      out.push({ account, date: String(row.TxnDate), amount: Number(line.Amount) });
    }
  }
  for (const entry of JOURNAL_ENTRIES) {
    for (const line of entry.Line as QuickbooksRow[]) {
      const detail = line.JournalEntryLineDetail as { PostingType: string; AccountRef: { name: string } };
      const kind = classification(detail.AccountRef.name);
      if (kind === 'Revenue' || kind === 'Expense') {
        const debit = detail.PostingType === 'Debit';
        const amount = Number(line.Amount) * ((kind === 'Expense') === debit ? 1 : -1);
        out.push({ account: detail.AccountRef.name, date: String(entry.TxnDate), amount });
      }
    }
  }
  return out;
}

/**
 * A statement over the sample company, in the JSON shape Intuit's reports
 * API answers with, so it reads through the same mapping a live report does.
 * The profit and loss is summed from the sample's own invoices, bills, card
 * charges and journal entries in the period, by total or by month. The
 * balance sheet is the accounts' balances on `SAMPLE_BALANCES_AS_OF`, with
 * equity as assets less liabilities.
 * @param report - The report, by its API name.
 * @param params - The query parameters the live API takes.
 */
export function sampleQuickbooksReport(report: 'ProfitAndLoss' | 'BalanceSheet', params: Record<string, string>): QuickbooksRow {
  const end = params.end_date ?? SAMPLE_BALANCES_AS_OF;
  const start = params.start_date ?? `${end.slice(0, 4)}-01-01`;
  const byMonth = report === 'ProfitAndLoss' && params.summarize_column_by === 'Month';
  const months = byMonth ? monthsBetween(start, end) : [];
  const columns = [{ ColTitle: '', ColType: 'Account' }, ...months.map(month => ({ ColTitle: month, ColType: 'Money' })), { ColTitle: 'Total', ColType: 'Money' }];
  const header = { ReportName: report, StartPeriod: report === 'BalanceSheet' ? null : start, EndPeriod: report === 'BalanceSheet' ? SAMPLE_BALANCES_AS_OF : end, ReportBasis: 'Accrual', Currency: 'USD', SummarizeColumnsBy: byMonth ? 'Month' : 'Total' };
  const accountId = (name: string) => String(ACCOUNTS.find(row => row.Name === name)?.Id ?? '');
  const sumRow = (label: string, figures: number[]): Cell[] => [{ value: label }, ...figures.map(cell)];

  if (report === 'BalanceSheet') {
    const of = (classification: string) => ACCOUNTS.filter(row => row.Classification === classification);
    const total = (rows: QuickbooksRow[]) => rows.reduce((sum, row) => sum + Number(row.CurrentBalance), 0);
    const data = (rows: QuickbooksRow[]): ReportRow[] => rows.map(row => ({ type: 'Data', ColData: [{ value: String(row.Name), id: String(row.Id) }, cell(Number(row.CurrentBalance))] }));
    const assets = total(of('Asset'));
    const liabilities = total(of('Liability'));
    return {
      Header: header,
      Columns: { Column: [columns[0], columns.at(-1)] },
      Rows: { Row: [
        { type: 'Section', group: 'TotalAssets', Header: { ColData: [{ value: 'Assets' }, { value: '' }] }, Rows: { Row: data(of('Asset')) }, Summary: { ColData: sumRow('Total Assets', [assets]) } },
        { type: 'Section', group: 'TotalLiabilitiesAndEquity', Header: { ColData: [{ value: 'Liabilities and Equity' }, { value: '' }] }, Rows: { Row: [
          { type: 'Section', group: 'Liabilities', Header: { ColData: [{ value: 'Liabilities' }, { value: '' }] }, Rows: { Row: data(of('Liability')) }, Summary: { ColData: sumRow('Total Liabilities', [liabilities]) } },
          { type: 'Section', group: 'Equity', Header: { ColData: [{ value: 'Equity' }, { value: '' }] }, Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Retained Earnings and Net Income' }, cell(assets - liabilities)] }] }, Summary: { ColData: sumRow('Total Equity', [assets - liabilities]) } },
        ] }, Summary: { ColData: sumRow('Total Liabilities and Equity', [assets]) } },
      ] },
    };
  }

  const postings = profitAndLossPostings().filter(p => p.date >= start && p.date <= end);
  const figures = (match: (p: { account: string; date: string }) => boolean): number[] => {
    const inPeriod = postings.filter(match);
    const sum = (rows: typeof inPeriod) => Math.round(rows.reduce((total, p) => total + p.amount, 0) * 100) / 100;
    return [...months.map(month => sum(inPeriod.filter(p => p.date.startsWith(month)))), sum(inPeriod)];
  };
  const section = (group: string, label: string, classification: string): { row: ReportRow; totals: number[] } => {
    const names = ACCOUNTS.filter(row => row.Classification === classification).map(row => String(row.Name)).filter(name => postings.some(p => p.account === name));
    const totals = figures(p => names.includes(p.account));
    return {
      row: { type: 'Section', group, Header: { ColData: [{ value: label }, ...columns.slice(1).map(() => ({ value: '' }))] }, Rows: { Row: names.map(name => ({ type: 'Data', ColData: [{ value: name, id: accountId(name) }, ...figures(p => p.account === name).map(cell)] })) }, Summary: { ColData: sumRow(`Total ${label}`, totals) } },
      totals,
    };
  };
  const income = section('Income', 'Income', 'Revenue');
  const expenses = section('Expenses', 'Expenses', 'Expense');
  const net = income.totals.map((figure, i) => Math.round((figure - expenses.totals[i]!) * 100) / 100);
  return {
    Header: header,
    Columns: { Column: columns },
    Rows: { Row: [
      income.row,
      { type: 'Section', group: 'GrossProfit', Summary: { ColData: sumRow('Gross Profit', income.totals) } },
      expenses.row,
      { type: 'Section', group: 'NetOperatingIncome', Summary: { ColData: sumRow('Net Operating Income', net) } },
      { type: 'Section', group: 'NetIncome', Summary: { ColData: sumRow('Net Income', net) } },
    ] },
  };
}
