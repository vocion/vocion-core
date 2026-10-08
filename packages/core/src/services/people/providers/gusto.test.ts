import type { SeenCall } from './fakeFetch';
/**
 * Gusto as a people provider, against recorded answers. No live calls.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeFetch } from './fakeFetch';
import { GUSTO_EMPLOYEE, GUSTO_PAYROLL, GUSTO_TIME_OFF } from './fixtures';

vi.mock('@/libs/Env', () => ({ Env: {} }));
vi.mock('@/libs/DB');

const { gustoPeopleProvider } = await import('./gusto');

const COMPANY = 'c0c0c0c0-0000-4000-8000-00000000c0de';
const GRANT = { accessToken: 'at-larkfield', refreshToken: 'rt-1', expiresAt: '2999-01-01T00:00:00.000Z', companyUuid: COMPANY, companyName: 'Larkfield Systems' };

function provider(table: Record<string, unknown>, seen: SeenCall[] = [], credentials: Record<string, unknown> = GRANT) {
  return gustoPeopleProvider({ orgId: 'org_a', source: { id: 1, slug: 'gusto', config: {} }, credentials, persistence: { kind: 'never' }, fetch: fakeFetch(table, seen) });
}

describe('gusto people provider', () => {
  it('lists workers with title, department, manager and work email, searching and paging on Gusto', async () => {
    const seen: SeenCall[] = [];
    const p = await provider({ [`GET /v1/companies/${COMPANY}/employees`]: [GUSTO_EMPLOYEE] }, seen);
    const page = await p.list('worker', { limit: 1, query: 'Ellis', status: 'active' });

    expect(page.records[0]).toMatchObject({ kind: 'worker', id: GUSTO_EMPLOYEE.uuid, name: 'Jordan Ellis', status: 'active', title: 'Operations Lead', department: 'Operations', workEmail: 'jordan.ellis@larkfield.example', startDate: '2024-03-04' });
    expect(page.nextCursor).toBe('2');

    const url = new URL(seen[0]!.url);

    expect(url.searchParams.get('search_term')).toBe('Ellis');
    expect(url.searchParams.get('terminated')).toBe('false');
    expect(seen[0]!.auth).toBe('Bearer at-larkfield');
    expect(seen[0]!.headers['x-gusto-api-version']).toBe('2024-04-01');
  });

  it('reads a pay run as its period, check date and company totals', async () => {
    const seen: SeenCall[] = [];
    const p = await provider({ [`GET /v1/companies/${COMPANY}/payrolls`]: [GUSTO_PAYROLL] }, seen);
    const page = await p.list('pay_run', { limit: 10, since: '2026-09-01' });

    expect(page.records[0]).toMatchObject({ kind: 'pay_run', name: 'Pay run 2026-09-30', status: 'processed', startDate: '2026-09-16', endDate: '2026-09-30', payDate: '2026-09-30', totals: { gross: 84250, net: 61200.4, employerTaxes: 6445.13, currency: 'USD' } });
    expect(new URL(seen[0]!.url).searchParams.get('include')).toBe('totals');
    expect(new URL(seen[0]!.url).searchParams.get('start_date')).toBe('2026-09-01');
  });

  it('reads time off as who, which days, what kind and how many hours', async () => {
    const p = await provider({ [`GET /v1/companies/${COMPANY}/time_off_requests`]: [GUSTO_TIME_OFF] });
    const page = await p.list('time_off', { limit: 10 });

    expect(page.records[0]).toMatchObject({ name: 'Time off · Jordan Ellis', status: 'approved', type: 'vacation', startDate: '2026-10-12', endDate: '2026-10-13', amount: 16 });
  });

  it('gets one worker', async () => {
    const p = await provider({ [`GET /v1/employees/${GUSTO_EMPLOYEE.uuid}`]: GUSTO_EMPLOYEE });

    await expect(p.get('worker', GUSTO_EMPLOYEE.uuid)).resolves.toMatchObject({ name: 'Jordan Ellis' });
  });

  it('asks for a login when there is none, and never refreshes a login it could not save', async () => {
    await expect(provider({}, [], { token: 'pasted' })).rejects.toThrow(/Gusto needs a login/);
    await expect(provider({}, [], { ...GRANT, expiresAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow(/only a saved connector can renew it/);
  });
});
