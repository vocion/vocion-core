/**
 * Workday (Report-as-a-Service) as a people provider, against recorded answers.
 */
import type { SeenCall } from './fakeFetch';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from './fakeFetch';
import { WORKDAY_TIME_OFF, WORKDAY_WORKER } from './fixtures';
import { workdayPeopleProvider, workdayReportUrl } from './workday';

const HOST = 'https://wd2-impl-services1.workday.example';
const CREDS = { host: HOST, tenant: 'larkfield1', username: 'ISU_Vocion', password: 'fixture-password' };

function provider(table: Record<string, unknown>, config: Record<string, unknown>, seen: SeenCall[] = []) {
  return workdayPeopleProvider({ orgId: 'org_a', source: { id: 1, slug: 'workday', config }, credentials: CREDS, persistence: { kind: 'never' }, fetch: fakeFetch(table, seen) });
}

describe('workday people provider', () => {
  it('builds the report URL under the tenant, and refuses one on another host', () => {
    expect(workdayReportUrl(HOST, 'larkfield1', 'ISU_Vocion/Vocion_Workers')).toBe(`${HOST}/ccx/service/customreport2/larkfield1/ISU_Vocion/Vocion_Workers?format=json`);
    expect(workdayReportUrl(HOST, 'larkfield1', `${HOST}/ccx/service/customreport2/larkfield1/ISU_Vocion/Vocion_Workers?format=csv`)).toContain('format=json');
    expect(() => workdayReportUrl(HOST, 'larkfield1', 'https://elsewhere.example/x')).toThrow(/not on/);
    expect(() => workdayReportUrl(HOST, 'larkfield1', 'just-a-name')).toThrow(/<owner>\/<report name>/);
  });

  it('reads workers from the report by Workday\'s usual column names, with Basic auth', async () => {
    const seen: SeenCall[] = [];
    const p = provider({ 'GET /ccx/service/customreport2/larkfield1/ISU_Vocion/Vocion_Workers': { Report_Entry: [WORKDAY_WORKER] } }, { workersReport: 'ISU_Vocion/Vocion_Workers' }, seen);
    const page = await p.list('worker', { limit: 10, query: 'priya' });

    expect(p.kinds).toEqual(['worker']);
    expect(page.records[0]).toMatchObject({ id: '21001', name: 'Priya Natarajan', status: 'active', title: 'Operations Manager', department: 'Larkfield Systems — Operations', manager: 'Lee Hart', workEmail: 'priya.natarajan@larkfield.example', type: 'Regular', location: 'Larkfield HQ', startDate: '2022-07-11' });
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from('ISU_Vocion:fixture-password').toString('base64')}`);
  });

  it('serves time off only when a time off report is named', async () => {
    const p = provider({ 'GET /ccx/service/customreport2/larkfield1/ISU_Vocion/Vocion_Time_Off': { Report_Entry: [WORKDAY_TIME_OFF] } }, { workersReport: 'ISU_Vocion/Vocion_Workers', timeOffReport: 'ISU_Vocion/Vocion_Time_Off' });

    expect(p.kinds).toEqual(['worker', 'time_off']);
    await expect(p.list('time_off', { limit: 5, since: '2026-12-01' })).resolves.toMatchObject({ records: [{ name: 'Time off · Priya Natarajan', type: 'Vacation', status: 'approved', startDate: '2026-12-21', endDate: '2026-12-24', amount: 32 }] });
  });

  it('gets one worker by id, and says when the report has none', async () => {
    const p = provider({ 'GET /ccx/service/customreport2/larkfield1/ISU_Vocion/Vocion_Workers': { Report_Entry: [WORKDAY_WORKER] } }, { workersReport: 'ISU_Vocion/Vocion_Workers' });

    await expect(p.get('worker', '21001')).resolves.toMatchObject({ name: 'Priya Natarajan' });
    await expect(p.get('worker', '99999')).rejects.toThrow(/has no entry 99999/);
  });
});
