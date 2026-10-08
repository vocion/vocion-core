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
 * An expense line on a bill.
 * @param id - The line id.
 * @param account - The expense account.
 * @param description - The line's description.
 * @param amount - How much.
 */
function expenseLine(id: string, account: string, description: string, amount: number): QuickbooksRow {
  return {
    Id: id,
    Description: description,
    Amount: amount,
    DetailType: 'AccountBasedExpenseLineDetail',
    AccountBasedExpenseLineDetail: { AccountRef: { value: id, name: account } },
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

const ACCOUNTS: QuickbooksRow[] = [
  { Id: '35', Name: 'Operating Checking', AcctNum: '1010', AccountType: 'Bank', AccountSubType: 'Checking', Classification: 'Asset', CurrentBalance: 184_250.4, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-10-01T16:20:00-07:00') },
  { Id: '84', Name: 'Accounts Receivable (A/R)', AcctNum: '1200', AccountType: 'Accounts Receivable', AccountSubType: 'AccountsReceivable', Classification: 'Asset', CurrentBalance: 42_100, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-10-01T16:20:00-07:00') },
  { Id: '33', Name: 'Accounts Payable (A/P)', AcctNum: '2000', AccountType: 'Accounts Payable', AccountSubType: 'AccountsPayable', Classification: 'Liability', CurrentBalance: 9_840, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T11:05:00-07:00') },
  { Id: '79', Name: 'Services Revenue', AcctNum: '4000', AccountType: 'Income', AccountSubType: 'ServiceFeeIncome', Classification: 'Revenue', CurrentBalance: 412_600, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T11:05:00-07:00') },
  { Id: '58', Name: 'Rent and Facilities', AcctNum: '6100', AccountType: 'Expense', AccountSubType: 'RentOrLeaseOfBuildings', Classification: 'Expense', CurrentBalance: 63_000, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-28T10:00:00-07:00') },
  { Id: '60', Name: 'Events and Venues', AcctNum: '6200', AccountType: 'Expense', AccountSubType: 'Entertainment', Classification: 'Expense', CurrentBalance: 14_500, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-20T15:30:00-07:00') },
  { Id: '62', Name: 'Marketing', AcctNum: '6300', AccountType: 'Expense', AccountSubType: 'AdvertisingPromotional', Classification: 'Expense', CurrentBalance: 22_340, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T11:05:00-07:00') },
  { Id: '64', Name: 'Depreciation', AcctNum: '6900', AccountType: 'Expense', AccountSubType: 'Depreciation', Classification: 'Expense', CurrentBalance: 6_750, CurrencyRef: USD, Active: true, MetaData: meta('2026-01-02T09:00:00-07:00', '2026-09-30T18:00:00-07:00') },
];

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
