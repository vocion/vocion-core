/**
 * Rippling as a people provider, against recorded answers. No live calls.
 */
import type { SeenCall } from './fakeFetch';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from './fakeFetch';
import { RIPPLING_DEPARTMENT, RIPPLING_EMPLOYEE, RIPPLING_LEAVE } from './fixtures';
import { ripplingPeopleProvider } from './rippling';

const API = '/platform/api';

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

  it('turns a refused token into a sentence that says who fixes it', async () => {
    const p = provider({ [`GET ${API}/departments`]: { status: 401, body: { detail: 'Invalid token.' } } });

    await expect(p.list('department', { limit: 1 })).rejects.toThrow(/Rippling refused the credential \(401\)/);
  });
});
