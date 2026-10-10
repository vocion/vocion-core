/**
 * Rippling as a people provider, against recorded answers. No live calls.
 */
import type { SeenCall } from './fakeFetch';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from './fakeFetch';
import { RIPPLING_DEPARTMENT, RIPPLING_EMPLOYEE, RIPPLING_LEAVE, RIPPLING_PAY_RECORDS, RIPPLING_PAY_RUN } from './fixtures';
import { ripplingPeopleProvider } from './rippling';

const API = '/platform/api';
const RUN = `/payroll-runs/${RIPPLING_PAY_RUN.id}`;

function provider(table: Record<string, unknown>, seen: SeenCall[] = []) {
  return ripplingPeopleProvider({ orgId: 'org_a', source: { id: 1, slug: 'rippling', config: {} }, credentials: { apiKey: 'rippling_fixture_token_0001' }, persistence: { kind: 'never' }, fetch: fakeFetch(table, seen) });
}

describe('rippling people provider', () => {
  it('lists workers with their department by name, paging by offset', async () => {
    const seen: SeenCall[] = [];
    const p = provider({ [`GET ${API}/employees`]: [RIPPLING_EMPLOYEE], [`GET ${API}/departments`]: [RIPPLING_DEPARTMENT] }, seen);
    const page = await p.list('worker', { limit: 1 });

    expect(page.records[0]).toMatchObject({ name: 'Sam Okafor', status: 'active', title: 'Support Engineer', department: 'Customer Success', workEmail: 'sam.okafor@larkfield.example', type: 'full-time', location: 'Boston, US', startDate: '2025-01-06' });
    expect(page.nextCursor).toBe('1');
    expect(seen.find(s => s.url.includes('/employees'))!.auth).toBe('Bearer rippling_fixture_token_0001');
  });

  it('filters by text in memory over everyone when asked, since Rippling has no search', async () => {
    const seen: SeenCall[] = [];
    const p = provider({ [`GET ${API}/employees/include_terminated`]: [RIPPLING_EMPLOYEE, { ...RIPPLING_EMPLOYEE, id: 'x2', name: 'Avery Lind', roleState: 'TERMINATED' }], [`GET ${API}/departments`]: [] }, seen);
    const page = await p.list('worker', { limit: 10, status: 'terminated' });

    expect(page.records.map(r => r.name)).toEqual(['Avery Lind']);
    expect(page.nextCursor).toBeNull();
  });

  it('lists leave requests as time off', async () => {
    const p = provider({ [`GET ${API}/leave_requests`]: [RIPPLING_LEAVE] });

    await expect(p.list('time_off', { limit: 5 })).resolves.toMatchObject({ records: [{ name: 'Time off · Sam Okafor', status: 'approved', startDate: '2026-11-02', amount: 16 }] });
  });

  it('gets a pay run by category, each summed across every worker, and checks it reconciles', async () => {
    const seen: SeenCall[] = [];
    const p = provider({ [`GET ${RUN}/`]: RIPPLING_PAY_RUN, [`GET ${RUN}/worker-payroll-records/`]: { results: RIPPLING_PAY_RECORDS, next_link: null } }, seen);
    const run = await p.get('pay_run', RIPPLING_PAY_RUN.id);

    expect(run).toMatchObject({ kind: 'pay_run', name: 'Pay run 2026-09-30', status: 'paid', type: 'regular', startDate: '2026-09-16', endDate: '2026-09-30', payDate: '2026-09-30', totals: { gross: 9999.46, net: 7247.55, employerTaxes: 650.96, currency: 'USD' } });
    expect(run.categories).toEqual([
      { category: 'gross_wages', label: 'Gross wages', amount: 9999.46, lines: [{ label: 'Salary', amount: 9999.46 }] },
      { category: 'employee_taxes', label: 'Employee taxes withheld', amount: 1964.69, lines: [{ label: 'Federal income tax', amount: 1313.73 }, { label: 'Social Security', amount: 650.96 }] },
      { category: 'employer_taxes', label: 'Employer taxes', amount: 650.96, lines: [{ label: 'Social Security', amount: 650.96 }] },
      { category: 'employee_deductions', label: 'Employee deductions', amount: 894.72, lines: [{ label: '401(k)', amount: 525.17 }, { label: 'Garnishment · CS', amount: 190 }, { label: 'Medical', amount: 179.55 }] },
      { category: 'employer_contributions', label: 'Employer contributions', amount: 920.11, lines: [{ label: 'Medical', amount: 605 }, { label: '401(k)', amount: 315.11 }] },
      { category: 'reimbursements', label: 'Reimbursements', amount: 107.5, lines: [{ label: 'Expense reimbursement', amount: 107.5 }] },
      { category: 'net_pay', label: 'Net pay', amount: 7247.55, lines: [{ label: 'Net pay', amount: 7247.55 }] },
    ]);
    expect(run.reconciliation).toEqual({ reconciles: true, difference: 0 });
    expect(seen.every(s => s.url.startsWith('https://rest.ripplingapis.com/') && s.auth === 'Bearer rippling_fixture_token_0001')).toBe(true);
  });

  it('lists pay runs newest first with a summary, follows next_link on Rippling only, and says when a run does not reconcile', async () => {
    const seen: SeenCall[] = [];
    const older = { ...RIPPLING_PAY_RUN, id: 'r0', check_date: '2026-09-15' };
    const short = { ...RIPPLING_PAY_RECORDS[0]!, net_pay: '3270.00' };
    const p = provider({
      'GET /payroll-runs/': { results: [older], next_link: 'https://rest.ripplingapis.com/payroll-runs/page2' },
      'GET /payroll-runs/page2': { results: [RIPPLING_PAY_RUN], next_link: 'https://elsewhere.example/steal' },
      [`GET ${RUN}/worker-payroll-records/`]: { results: RIPPLING_PAY_RECORDS, next_link: null },
      'GET /payroll-runs/r0/worker-payroll-records/': { results: [short], next_link: null },
    }, seen);
    const page = await p.list('pay_run', { limit: 5 });

    expect(page.records.map(r => r.payDate)).toEqual(['2026-09-30', '2026-09-15']);
    expect(page.records[0]!.categories!.map(c => [c.category, c.amount, 'lines' in c])).toContainEqual(['net_pay', 7247.55, false]);
    expect(page.records[1]!.reconciliation).toEqual({ reconciles: false, difference: 1.6 });
    expect(seen.some(s => s.url.includes('elsewhere.example'))).toBe(false);
  });

  it('leaves a pay run uncategorised rather than adding across currencies', async () => {
    const p = provider({ [`GET ${RUN}/`]: RIPPLING_PAY_RUN, [`GET ${RUN}/worker-payroll-records/`]: { results: [RIPPLING_PAY_RECORDS[0], { ...RIPPLING_PAY_RECORDS[1], currency: 'CAD' }] } });

    await expect(p.get('pay_run', RIPPLING_PAY_RUN.id)).resolves.toMatchObject({ totals: null, categories: null, reconciliation: null });
  });

  it('turns a refused token into a sentence that says who fixes it', async () => {
    const p = provider({ [`GET ${API}/departments`]: { status: 401, body: { detail: 'Invalid token.' } } });

    await expect(p.list('department', { limit: 1 })).rejects.toThrow(/Rippling refused the credential \(401\)/);
  });
});
