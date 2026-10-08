/**
 * The people family's two promises, held for every provider:
 *
 * 1. Personal data never comes out. Each provider is fed a recorded vendor
 *    answer that also carries a government id, a birth date, a home address,
 *    a personal email and phone, bank details, individual pay and a private
 *    note — and nothing any list or get returns contains one of them.
 * 2. Each org spends its own credential, resolved per call, in sequence.
 */
import type { PeopleProvider } from './types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeFetch } from './providers/fakeFetch';
import { GUSTO_EMPLOYEE, GUSTO_PAYROLL, GUSTO_TIME_OFF, PERSONAL_VALUES, RIPPLING_DEPARTMENT, RIPPLING_EMPLOYEE, RIPPLING_LEAVE, WORKDAY_TIME_OFF, WORKDAY_WORKER } from './providers/fixtures';

type Row = { id: number; slug: string; kind: string; config: Record<string, unknown>; apiTokenId: string | null };

const state = vi.hoisted(() => ({ sources: {} as Record<string, Row[]>, credentials: {} as Record<string, Record<string, unknown>> }));

vi.mock('@/libs/Env', () => ({ Env: {} }));
vi.mock('@/libs/DB');
vi.mock('@/libs/Logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));
vi.mock('@/libs/connectors/families', () => {
  const FAMILY_KINDS = { finance: ['stripe', 'quickbooks', 'xero', 'netsuite', 'ramp', 'bill'], people: ['gusto', 'rippling', 'workday'] };
  return { FAMILY_KINDS, familySourcesForOrg: async (orgId: string, family: 'finance' | 'people') => (state.sources[orgId] ?? []).filter(s => FAMILY_KINDS[family].includes(s.kind)) };
});
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async ({ orgId, apiTokenId }: { orgId: string; apiTokenId: string | null }) => (apiTokenId ? state.credentials[`${orgId}:${apiTokenId}`] : undefined),
}));

const { gustoPeopleProvider } = await import('./providers/gusto');
const { ripplingPeopleProvider } = await import('./providers/rippling');
const { workdayPeopleProvider } = await import('./providers/workday');
const { peopleProviderFor } = await import('./provider');

const COMPANY = 'c0c0c0c0-0000-4000-8000-00000000c0de';
const never = { kind: 'never' } as const;

/**
 * Every list and get the provider serves, as one string.
 * @param provider - The provider under test.
 * @param ids - An id per kind, for `get`.
 */
async function everything(provider: PeopleProvider, ids: Partial<Record<string, string>>): Promise<string> {
  const out: unknown[] = [];
  for (const kind of provider.kinds) {
    out.push(await provider.list(kind, { limit: 50 }));
    if (ids[kind]) {
      out.push(await provider.get(kind, ids[kind]!));
    }
  }
  return JSON.stringify(out);
}

function expectNoPersonalData(text: string): void {
  for (const value of PERSONAL_VALUES) {
    expect(text, value).not.toContain(value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('personal data never leaves a people provider', () => {
  it('gusto', async () => {
    const p = await gustoPeopleProvider({
      orgId: 'o',
      source: { id: 1, slug: 'gusto', config: {} },
      credentials: { accessToken: 'at', refreshToken: 'rt', expiresAt: '2999-01-01T00:00:00.000Z', companyUuid: COMPANY },
      persistence: never,
      fetch: fakeFetch({
        [`GET /v1/companies/${COMPANY}/employees`]: [GUSTO_EMPLOYEE],
        [`GET /v1/employees/${GUSTO_EMPLOYEE.uuid}`]: GUSTO_EMPLOYEE,
        [`GET /v1/companies/${COMPANY}/departments`]: [{ uuid: 'd1', title: 'Operations', employees: [{ uuid: GUSTO_EMPLOYEE.uuid }] }],
        [`GET /v1/companies/${COMPANY}/payrolls`]: [GUSTO_PAYROLL],
        [`GET /v1/companies/${COMPANY}/payrolls/${GUSTO_PAYROLL.payroll_uuid}`]: GUSTO_PAYROLL,
        [`GET /v1/companies/${COMPANY}/time_off_requests`]: [GUSTO_TIME_OFF],
      }),
    });
    const text = await everything(p, { worker: GUSTO_EMPLOYEE.uuid, pay_run: GUSTO_PAYROLL.payroll_uuid });

    expect(text).toContain('Jordan Ellis');

    expectNoPersonalData(text);
  });

  it('rippling', async () => {
    const p = ripplingPeopleProvider({
      orgId: 'o',
      source: { id: 1, slug: 'rippling', config: {} },
      credentials: { apiKey: 'rippling_fixture_token_0001' },
      persistence: never,
      fetch: fakeFetch({
        'GET /platform/api/employees': [RIPPLING_EMPLOYEE],
        [`GET /platform/api/employees/${RIPPLING_EMPLOYEE.id}`]: RIPPLING_EMPLOYEE,
        'GET /platform/api/departments': [RIPPLING_DEPARTMENT],
        'GET /platform/api/leave_requests': [RIPPLING_LEAVE],
      }),
    });
    const text = await everything(p, { worker: RIPPLING_EMPLOYEE.id });

    expect(text).toContain('Sam Okafor');

    expectNoPersonalData(text);
  });

  it('workday', async () => {
    const p = workdayPeopleProvider({
      orgId: 'o',
      source: { id: 1, slug: 'workday', config: { workersReport: 'ISU_Vocion/Workers', timeOffReport: 'ISU_Vocion/Time_Off' } },
      credentials: { host: 'https://wd2-impl-services1.workday.example', tenant: 'larkfield1', username: 'ISU_Vocion', password: 'fixture-password' },
      persistence: never,
      fetch: fakeFetch({
        'GET /ccx/service/customreport2/larkfield1/ISU_Vocion/Workers': { Report_Entry: [WORKDAY_WORKER] },
        'GET /ccx/service/customreport2/larkfield1/ISU_Vocion/Time_Off': { Report_Entry: [WORKDAY_TIME_OFF] },
      }),
    });
    const text = await everything(p, { worker: '21001' });

    expect(text).toContain('Priya Natarajan');

    expectNoPersonalData(text);
  });
});

describe('peopleProviderFor', () => {
  it('spends each org\'s own Rippling token, in sequence, with nothing carried between them', async () => {
    state.sources = {
      org_a: [{ id: 1, slug: 'rippling', kind: 'rippling', config: {}, apiTokenId: 'tok_a' }],
      org_b: [{ id: 2, slug: 'hr', kind: 'rippling', config: {}, apiTokenId: 'tok_b' }],
    };
    state.credentials = { 'org_a:tok_a': { apiKey: 'rippling_fixture_token_orgA' }, 'org_b:tok_b': { apiKey: 'rippling_fixture_token_orgB' } };
    const auths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      auths.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response('[]', { status: 200 });
    }));

    await (await peopleProviderFor('org_a')).list('department', { limit: 1 });
    await (await peopleProviderFor('org_b')).list('department', { limit: 1 });
    await (await peopleProviderFor('org_a')).list('department', { limit: 1 });

    expect(auths).toEqual(['Bearer rippling_fixture_token_orgA', 'Bearer rippling_fixture_token_orgB', 'Bearer rippling_fixture_token_orgA']);
  });

  it('answers with the only HR source, or names what is connected', async () => {
    state.sources = { org_a: [{ id: 1, slug: 'rippling', kind: 'rippling', config: {}, apiTokenId: 'tok_a' }, { id: 3, slug: 'stripe', kind: 'stripe', config: {}, apiTokenId: null }] };

    await expect(peopleProviderFor('org_a')).resolves.toMatchObject({ kind: 'rippling' });
    await expect(peopleProviderFor('org_a', { sourceSlug: 'payroll' })).rejects.toThrow(/No HR source named payroll\. Connected: rippling \(rippling\)/);
    await expect(peopleProviderFor('org_a', { allowed: [] })).rejects.toThrow(/No HR system is connected for this agent\. Connect one \(gusto, rippling, workday\)/);
  });
});
