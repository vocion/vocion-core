/**
 * QuickBooks Online as a finance provider: the sample company (no login),
 * the query a live list sends, that each login spends its own token, card
 * expenses, statements, and the two writes (a recoded expense line, a
 * journal entry) with the SyncToken each carries. Fictional cast; no live calls.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Env', () => ({ Env: {} }));

const { quickbooksFinanceProvider, quickbooksListQuery, quickbooksReport, quickbooksReportParams } = await import('./quickbooks');

type Seen = { url: string; auth: string };

function fakeFetch(answer: unknown, seen: Seen[] = []) {
  return async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: (init?.headers as Record<string, string>).authorization! });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
}

const LOGIN = { accessToken: 'qat-northwind', refreshToken: 'qrt', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), realmId: '9130350000000001', environment: 'sandbox' };

function provider(credentials: Record<string, unknown>, config: Record<string, unknown>, fetchImpl?: ReturnType<typeof fakeFetch>) {
  return quickbooksFinanceProvider({ orgId: 'org_a', source: { id: 1, slug: 'quickbooks', config }, credentials, persistence: { kind: 'never' }, fetch: fetchImpl });
}

describe('quickbooks finance provider', () => {
  it('reads the sample company with no login: what it holds, filtered, and nothing it does not', async () => {
    const p = await provider({}, { sample: true });

    expect(p.vendor).toBe('QuickBooks (sample company)');
    expect(p.kinds).toEqual(['invoice', 'bill', 'payment', 'transaction', 'account']);

    const invoices = await p.list('invoice', { limit: 100 });

    expect(invoices.records.length).toBeGreaterThan(0);
    expect(invoices.records.every(r => r.url === null)).toBe(true);

    const unpaid = await p.list('invoice', { limit: 100, status: 'unpaid' });

    expect(unpaid.records.every(r => r.status === 'unpaid')).toBe(true);

    const one = await p.get('invoice', invoices.records[0]!.id);

    expect(one.id).toBe(invoices.records[0]!.id);
    await expect(p.list('customer', { limit: 1 })).rejects.toThrow(/holds no customer records/);
  });

  it('builds its query from controlled values, escaping quotes', () => {
    const { sql, ignored } = quickbooksListQuery('customer', { query: 'O\'Brien', status: 'active', since: '2026-09-01' }, 1, 25);

    expect(sql).toBe('SELECT * FROM Customer WHERE DisplayName LIKE \'%O\\\'Brien%\' AND Active = true ORDERBY Metadata.LastUpdatedTime DESC STARTPOSITION 1 MAXRESULTS 25');
    expect(ignored).toEqual(['since/until']);
    expect(quickbooksListQuery('bill', { status: 'open', partyId: '58', updatedSince: new Date('2026-09-30T08:00:00Z') }, 26, 25).sql)
      .toBe('SELECT * FROM Bill WHERE Balance > \'0\' AND VendorRef = \'58\' AND Metadata.LastUpdatedTime >= \'2026-09-30T08:00:00.000Z\' ORDERBY Metadata.LastUpdatedTime DESC STARTPOSITION 26 MAXRESULTS 25');
  });

  it('lists live invoices on the login\'s environment, linked into QuickBooks', async () => {
    const seen: Seen[] = [];
    const p = await provider(LOGIN, {}, fakeFetch({ QueryResponse: { Invoice: [{ Id: '130', DocNumber: '1042', CustomerRef: { value: '58', name: 'Contoso Supply' }, TotalAmt: 12500, Balance: 10000, TxnDate: '2026-09-01', DueDate: '2026-10-01', CurrencyRef: { value: 'USD' } }] } }, seen));
    const page = await p.list('invoice', { limit: 1 });

    expect(page.records[0]).toMatchObject({ number: '1042', party: 'Contoso Supply', status: 'partly paid', amount: 12500, balance: 10000, url: 'https://app.sandbox.qbo.intuit.com/app/invoice?txnId=130' });
    expect(page.nextCursor).toBe('start:2');
    expect(seen[0]!.url.startsWith('https://sandbox-quickbooks.api.intuit.com/v3/company/9130350000000001/query?')).toBe(true);
  });

  it('each login spends its own token', async () => {
    const seen: Seen[] = [];
    const a = await provider(LOGIN, {}, fakeFetch({ QueryResponse: {} }, seen));
    const b = await provider({ ...LOGIN, accessToken: 'qat-kestrel', realmId: '9130350000000002' }, {}, fakeFetch({ QueryResponse: {} }, seen));
    await a.list('account', { limit: 1 });
    await b.list('account', { limit: 1 });

    expect(seen.map(s => s.auth)).toEqual(['Bearer qat-northwind', 'Bearer qat-kestrel']);
    expect(seen[1]!.url).toContain('/company/9130350000000002/');
  });

  it('asks for a login when there is none and no sample', async () => {
    await expect(provider({}, {})).rejects.toThrow(/QuickBooks needs a login/);
  });

  it('reads a card charge with each line\'s id and the account it is coded to', async () => {
    const p = await provider(LOGIN, {}, fakeFetch({ Purchase: {
      Id: '601',
      SyncToken: '2',
      TxnDate: '2026-09-03',
      PaymentType: 'CreditCard',
      AccountRef: { value: '41', name: 'Company Card' },
      EntityRef: { value: '31', name: 'Corvus Media', type: 'Vendor' },
      TotalAmt: 750,
      CurrencyRef: { value: 'USD' },
      Line: [{ Id: '1', Amount: 750, Description: 'Team plan', DetailType: 'AccountBasedExpenseLineDetail', AccountBasedExpenseLineDetail: { AccountRef: { value: '66', name: 'Software and Subscriptions' } } }],
    } }));
    const record = await p.get('transaction', '601');

    expect(record).toMatchObject({
      kind: 'transaction',
      title: 'Card charge · Corvus Media · 2026-09-03',
      party: 'Corvus Media',
      amount: 750,
      url: 'https://app.sandbox.qbo.intuit.com/app/expense?txnId=601',
      lines: [{ id: '1', accountId: '66', accountName: 'Software and Subscriptions', amount: 750, description: 'Software and Subscriptions: Team plan' }],
      details: { paymentType: 'CreditCard', paidFrom: 'Company Card', paidFromId: '41', partyId: '31', credit: false },
    });
    expect(quickbooksListQuery('transaction', { since: '2026-09-01', partyId: '31' }, 1, 25)).toEqual({
      sql: 'SELECT * FROM Purchase WHERE TxnDate >= \'2026-09-01\' ORDERBY Metadata.LastUpdatedTime DESC STARTPOSITION 1 MAXRESULTS 25',
      ignored: ['party_id'],
    });
  });

  it('maps Intuit\'s report JSON into sections, lines, totals and the bottom lines', () => {
    const body = {
      Header: { ReportName: 'ProfitAndLoss', StartPeriod: '2026-08-01', EndPeriod: '2026-09-30', ReportBasis: 'Accrual', Currency: 'USD', SummarizeColumnsBy: 'Month' },
      Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Aug 2026', ColType: 'Money' }, { ColTitle: 'Sep 2026', ColType: 'Money' }, { ColTitle: 'Total', ColType: 'Money' }] },
      Rows: { Row: [
        { type: 'Section', group: 'Income', Header: { ColData: [{ value: 'Income' }, { value: '' }, { value: '' }, { value: '' }] }, Rows: { Row: [
          { type: 'Data', ColData: [{ value: 'Services Revenue', id: '79' }, { value: '12000.00' }, { value: '42100.00' }, { value: '54100.00' }] },
        ] }, Summary: { ColData: [{ value: 'Total Income' }, { value: '12000.00' }, { value: '42100.00' }, { value: '54100.00' }] } },
        { type: 'Section', group: 'GrossProfit', Summary: { ColData: [{ value: 'Gross Profit' }, { value: '12000.00' }, { value: '42100.00' }, { value: '54100.00' }] } },
        { type: 'Section', group: 'Expenses', Header: { ColData: [{ value: 'Expenses' }, { value: '' }, { value: '' }, { value: '' }] }, Rows: { Row: [
          { type: 'Section', Header: { ColData: [{ value: 'Facilities' }, { value: '' }, { value: '' }, { value: '' }] }, Rows: { Row: [
            { type: 'Data', ColData: [{ value: 'Rent and Facilities', id: '58' }, { value: '' }, { value: '7000.00' }, { value: '7000.00' }] },
          ] }, Summary: { ColData: [{ value: 'Total Facilities' }, { value: '' }, { value: '7000.00' }, { value: '7000.00' }] } },
          { type: 'Data', ColData: [{ value: 'Marketing', id: '62' }, { value: '' }, { value: '4340.00' }, { value: '4340.00' }] },
        ] }, Summary: { ColData: [{ value: 'Total Expenses' }, { value: '' }, { value: '11340.00' }, { value: '11340.00' }] } },
        { type: 'Section', group: 'NetIncome', Summary: { ColData: [{ value: 'Net Income' }, { value: '12000.00' }, { value: '30760.00' }, { value: '42760.00' }] } },
      ] },
    };
    const report = quickbooksReport('profit_and_loss', body);

    expect(report).toMatchObject({ kind: 'profit_and_loss', title: 'Profit and Loss', period: { start: '2026-08-01', end: '2026-09-30' }, basis: 'accrual', currency: 'USD', columns: ['Aug 2026', 'Sep 2026', 'Total'] });
    expect(report.rows[0]).toEqual({ label: 'Income', rows: [{ label: 'Services Revenue', accountId: '79', amounts: [12000, 42100, 54100] }], total: { label: 'Total Income', amounts: [12000, 42100, 54100] } });
    expect(report.rows[2]!.rows![0]).toMatchObject({ label: 'Facilities', rows: [{ label: 'Rent and Facilities', amounts: [null, 7000, 7000] }] });
    expect(report.totals.map(t => t.label)).toEqual(['Total Income', 'Gross Profit', 'Total Expenses', 'Net Income']);
    expect(report.totals.at(-1)!.amounts).toEqual([12000, 30760, 42760]);
    expect(quickbooksReportParams('balance_sheet', { end: '2026-09-30', basis: 'cash' })).toMatchObject({ start_date: '2026-09-30', end_date: '2026-09-30', summarize_column_by: 'Total', accounting_method: 'Cash' });
    expect(quickbooksReportParams('profit_and_loss', { end: '2026-09-30', summarizeBy: 'class' })).toMatchObject({ start_date: '2026-01-01', summarize_column_by: 'Classes' });
  });

  it('runs a live statement on the reports endpoint', async () => {
    const seen: Seen[] = [];
    const p = await provider(LOGIN, {}, fakeFetch({ Header: { ReportName: 'BalanceSheet', EndPeriod: '2026-09-30', Currency: 'USD' }, Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Total' }] }, Rows: { Row: [] } }, seen));
    const report = await p.report!('balance_sheet', { end: '2026-09-30' });

    expect(report).toMatchObject({ kind: 'balance_sheet', period: { start: null, end: '2026-09-30' }, columns: ['Total'] });
    expect(seen[0]!.url).toContain('/v3/company/9130350000000001/reports/BalanceSheet?end_date=2026-09-30');
  });

  it('sums the sample company\'s statements from its own rows, so they agree with what it lists', async () => {
    const p = await provider({}, { sample: true });
    const pnl = await p.report!('profit_and_loss', { start: '2026-09-01', end: '2026-09-30' });
    const total = (label: string) => pnl.totals.find(t => t.label === label)!.amounts.at(-1);

    // September: invoices 1042 to 1044 and the accrued workshop; bills, card charges and depreciation.
    expect(total('Total Income')).toBe(44_600);
    expect(total('Total Expenses')).toBe(20_789);
    expect(total('Net Income')).toBe(23_811);
    expect(pnl.rows[2]!.rows!.find(r => r.label === 'Software and Subscriptions')).toMatchObject({ accountId: '66', amounts: [900] });

    const byMonth = await p.report!('profit_and_loss', { start: '2026-08-01', end: '2026-10-31', summarizeBy: 'month' });

    expect(byMonth.columns).toEqual(['2026-08', '2026-09', '2026-10', 'Total']);
    expect(byMonth.totals.find(t => t.label === 'Total Income')!.amounts).toEqual([12_000, 44_600, 12_000, 68_600]);

    const sheet = await p.report!('balance_sheet', { end: '2026-09-30', summarizeBy: 'month' });

    expect(sheet.totals).toEqual([{ label: 'Total Assets', amounts: [226_350.4] }, { label: 'Total Liabilities and Equity', amounts: [226_350.4] }]);
    expect(sheet.notes).toEqual([
      'The sample company splits a balance sheet by total only, so this is the total.',
      'The sample company\'s balances stand at 2026-10-01 whatever date is asked; its equity is assets less liabilities.',
    ]);
  });

  it('writes nothing to the sample company, and says so', async () => {
    const p = await provider({}, { sample: true });

    expect(p.recategorizeExpense).toBeUndefined();
    expect(p.postJournalEntry).toBeUndefined();
    expect(p.readOnlyReason).toMatch(/sample company is read-only/);
  });
});

type Call = { url: string; method: string; body: unknown };

/**
 * A QuickBooks stub that answers reads from `rows` (by entity and id) and
 * records every write, answering it with `writeAnswer`.
 * @param rows - `purchase/601` to the row.
 * @param writeAnswer - What a write returns: the body, or a status and body.
 */
function booksFetch(rows: Record<string, Record<string, unknown>>, writeAnswer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (method === 'POST') {
      const answer = writeAnswer({ url, method, body });
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
    }
    const [, entity, id] = /\/company\/\d+\/(\w+)\/(\d+)/.exec(url) ?? [];
    const row = rows[`${entity}/${id}`];
    return row ? new Response(JSON.stringify(row), { status: 200 }) : new Response('{}', { status: 404 });
  };
  return { calls, fetchImpl };
}

const CHARGE = {
  Id: '603',
  SyncToken: '3',
  TxnDate: '2026-09-12',
  PaymentType: 'CreditCard',
  AccountRef: { value: '41', name: 'Company Card' },
  EntityRef: { value: '33', name: 'Tern Electronics' },
  TotalAmt: 1_499,
  Line: [
    { Id: '1', Amount: 1_299, Description: 'Laptop', DetailType: 'AccountBasedExpenseLineDetail', AccountBasedExpenseLineDetail: { AccountRef: { value: '62', name: 'Marketing' }, BillableStatus: 'NotBillable' } },
    { Id: '2', Amount: 200, Description: 'Dock', DetailType: 'ItemBasedExpenseLineDetail', ItemBasedExpenseLineDetail: { ItemRef: { value: '9', name: 'Accessories' } } },
  ],
};

describe('quickbooks writes', () => {
  it('moves one expense line with a sparse update at the current SyncToken, sending every line back', async () => {
    const { calls, fetchImpl } = booksFetch({ 'purchase/603': { Purchase: CHARGE } }, ({ body }) => ({ body: { Purchase: { ...(body as object), SyncToken: '4' } } }));
    const p = await provider(LOGIN, {}, fetchImpl as never);
    const moved = await p.recategorizeExpense!({ expenseId: '603', lineId: '1', toAccountId: '68', toAccountName: 'Office Supplies and Equipment' });

    expect(moved).toEqual({ expenseId: '603', lineId: '1', amount: 1_299, party: 'Tern Electronics', from: { id: '62', name: 'Marketing' }, to: { id: '68', name: 'Office Supplies and Equipment' }, url: 'https://app.sandbox.qbo.intuit.com/app/expense?txnId=603' });

    const post = calls.find(c => c.method === 'POST')!;

    expect(post.url).toBe('https://sandbox-quickbooks.api.intuit.com/v3/company/9130350000000001/purchase?minorversion=75');
    expect(post.body).toEqual({
      Id: '603',
      SyncToken: '3',
      sparse: true,
      PaymentType: 'CreditCard',
      AccountRef: { value: '41', name: 'Company Card' },
      Line: [
        { ...CHARGE.Line[0], AccountBasedExpenseLineDetail: { AccountRef: { value: '68', name: 'Office Supplies and Equipment' }, BillableStatus: 'NotBillable' } },
        CHARGE.Line[1],
      ],
    });
  });

  it('refuses a line not coded to an account, and a line someone moved since, without writing', async () => {
    const { calls, fetchImpl } = booksFetch({ 'purchase/603': { Purchase: CHARGE } }, () => ({ body: {} }));
    const p = await provider(LOGIN, {}, fetchImpl as never);

    await expect(p.recategorizeExpense!({ expenseId: '603', lineId: '2', toAccountId: '68' })).rejects.toThrow(/not coded to an account \(it is ItemBasedExpenseLineDetail\)/);
    await expect(p.recategorizeExpense!({ expenseId: '603', lineId: '1', toAccountId: '62', expectFromAccountId: '68' })).rejects.toThrow(/coded to Marketing now, not the account this change expected/);
    await expect(p.recategorizeExpense!({ expenseId: '603', lineId: '7', toAccountId: '68' })).rejects.toThrow(/has no line 7\. Its lines: 1, 2/);
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('posts a balanced journal entry, and deletes it at its current SyncToken', async () => {
    const { calls, fetchImpl } = booksFetch({ 'journalentry/880': { JournalEntry: { Id: '880', SyncToken: '1' } } }, ({ url }) => ({ body: url.includes('operation=delete') ? { JournalEntry: { Id: '880', status: 'Deleted' } } : { JournalEntry: { Id: '880', SyncToken: '0', DocNumber: 'JE-17', TotalAmt: 2_500, CurrencyRef: { value: 'USD' } } } }));
    const p = await provider(LOGIN, {}, fetchImpl as never);
    const posted = await p.postJournalEntry!({
      date: '2026-09-30',
      memo: 'Accrue September workshop revenue.',
      lines: [
        { accountId: '90', accountName: 'Unbilled Receivables', debit: 2_500, customerId: '11' },
        { accountId: '79', credit: 2_500, description: 'Workshop delivered 2026-09-29' },
      ],
    });

    expect(posted).toEqual({ id: '880', number: 'JE-17', url: 'https://app.sandbox.qbo.intuit.com/app/journal?txnId=880', total: 2_500, currency: 'USD' });
    expect(calls[0]!.url).toBe('https://sandbox-quickbooks.api.intuit.com/v3/company/9130350000000001/journalentry?minorversion=75');
    expect(calls[0]!.body).toEqual({
      TxnDate: '2026-09-30',
      PrivateNote: 'Accrue September workshop revenue.',
      Line: [
        { DetailType: 'JournalEntryLineDetail', Amount: 2_500, JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '90', name: 'Unbilled Receivables' }, Entity: { Type: 'Customer', EntityRef: { value: '11' } } } },
        { DetailType: 'JournalEntryLineDetail', Amount: 2_500, Description: 'Workshop delivered 2026-09-29', JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '79' } } },
      ],
    });

    await p.deleteJournalEntry!('880');
    const del = calls.at(-1)!;

    expect(del.url).toBe('https://sandbox-quickbooks.api.intuit.com/v3/company/9130350000000001/journalentry?minorversion=75&operation=delete');
    expect(del.body).toEqual({ Id: '880', SyncToken: '1' });
  });

  it('refuses an unbalanced entry before calling QuickBooks, and passes on Intuit\'s reason for a refused write', async () => {
    const { calls, fetchImpl } = booksFetch({ 'purchase/603': { Purchase: CHARGE } }, () => ({ status: 400, body: { Fault: { Error: [{ Message: 'Stale Object Error', Detail: 'Stale Object Error : You and Avery were working on this at the same time.', code: '5010' }] } } }));
    const p = await provider(LOGIN, {}, fetchImpl as never);

    await expect(p.postJournalEntry!({ date: '2026-09-30', memo: 'x', lines: [{ accountId: '1', debit: 100 }, { accountId: '2', credit: 99.99 }] })).rejects.toThrow('Debits (100.00) and credits (99.99) differ by 0.01');
    expect(calls).toHaveLength(0);
    await expect(p.recategorizeExpense!({ expenseId: '603', lineId: '1', toAccountId: '68' })).rejects.toThrow('QuickBooks refused the Purchase change (400); nothing was written. QuickBooks said: Stale Object Error : You and Avery were working on this at the same time.');
  });
});
