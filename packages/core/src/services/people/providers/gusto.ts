/**
 * GUSTO — payroll and HR, as a provider of the people family (`../types.ts`).
 *
 * Read live with the workspace's Gusto login: employees, departments, pay
 * runs and time off, for the one company the login is on. The login's
 * access token lasts two hours and its refresh token is single use, so an
 * expiring grant is refreshed and the next refresh token saved before any
 * read (`usableLoginGrant`).
 *
 * Work information only. Gusto's employee answer carries a date of birth, a
 * personal email, a phone and pay rates; none of them is copied out — every
 * record is built from `blankPeopleRecord` and the fields named below. A pay
 * run is its company-wide totals by category: the categories are Gusto's own
 * company totals, and on `get` each category's lines are the names in
 * `employee_compensations` summed across everyone here (`payRunTally`), so
 * no one person's pay leaves this file.
 *
 * Gusto API facts this file depends on: Bearer auth with
 * `X-Gusto-API-Version`; lists page by `page` and `per`; employees take
 * `terminated` and `search_term`; payrolls take `processing_statuses`,
 * `start_date`, `end_date` and `include=totals`, with totals as decimal
 * strings in USD (`check_amount` is net pay plus reimbursements); one payroll
 * also takes `include=taxes,benefits,deductions`, itemising each employee
 * compensation; time off requests live under the company.
 */

import type { PeopleListQuery, PeoplePage, PeopleProvider, PeopleProviderInput, PeopleRecord, PeopleRecordKind } from '../types';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { GUSTO_API_BASE, GUSTO_API_VERSION, refreshGustoGrant } from '@/libs/connect/providers/gusto';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { payRunTally } from '../payRun';
import { blankPeopleRecord } from '../types';
import { isoDay, num, pageInMemory, str } from './shared';

const VENDOR = 'Gusto';
const KINDS: readonly PeopleRecordKind[] = ['worker', 'department', 'pay_run', 'time_off'];

type Json = Record<string, unknown>;

/**
 * A Gusto employee as a worker: name, title, department, manager, work
 * email, dates and status. Nothing else is read.
 * @param e - The employee.
 */
export function gustoWorker(e: Json): PeopleRecord {
  const first = str(e.preferred_first_name) ?? str(e.first_name);
  const name = [first, str(e.last_name)].filter(Boolean).join(' ') || str(e.uuid) || 'Employee';
  const jobs = Array.isArray(e.jobs) ? (e.jobs as Json[]) : [];
  const job = jobs.find(j => j.primary === true) ?? jobs[0];
  const terminations = Array.isArray(e.terminations) ? (e.terminations as Json[]) : [];
  const status = e.terminated === true ? 'terminated' : e.onboarded === false ? 'onboarding' : 'active';
  return {
    ...blankPeopleRecord('worker', String(e.uuid ?? ''), name),
    status,
    title: str(job?.title),
    department: str(e.department),
    manager: str(e.manager_uuid),
    workEmail: str(e.work_email),
    startDate: isoDay(job?.hire_date) ?? isoDay(e.date_of_hire),
    endDate: isoDay(terminations[0]?.effective_date),
  };
}

/**
 * A Gusto payroll's company totals as categories. With `lines`, each
 * category also carries the tax, benefit, deduction and earning names from
 * the employee compensations, summed across all employees; the per-employee
 * figures go no further than the tally.
 * @param p - The payroll.
 * @param opts - What to include.
 * @param opts.lines - Whether each category carries its lines.
 */
export function gustoPayRunAmounts(p: Json, opts: { lines: boolean }): Pick<PeopleRecord, 'categories' | 'reconciliation'> {
  const totals = (p.totals ?? null) as Json | null;
  if (!totals) {
    return { categories: null, reconciliation: null };
  }
  const tally = payRunTally();
  const sum = (...values: unknown[]) => (values.some(v => num(v) !== null) ? values.reduce<number>((s, v) => s + (num(v) ?? 0), 0) : null);
  tally.total('gross_wages', num(totals.gross_pay));
  tally.total('employee_taxes', num(totals.employee_taxes));
  tally.total('employer_taxes', num(totals.employer_taxes));
  tally.total('employee_deductions', sum(totals.employee_benefits_deductions, totals.other_deductions));
  tally.total('employer_contributions', num(totals.benefits));
  tally.total('reimbursements', num(totals.reimbursements));
  tally.total('net_pay', num(totals.check_amount) ?? sum(totals.net_pay, totals.reimbursements));
  const list = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
  for (const c of opts.lines ? list(p.employee_compensations) : []) {
    for (const e of [...list(c.fixed_compensations), ...list(c.hourly_compensations)]) {
      const label = str(e.name) ?? 'Earnings';
      tally.add(/reimburs/i.test(label) ? 'reimbursements' : 'gross_wages', label, num(e.amount));
    }
    for (const t of list(c.taxes)) {
      tally.add(t.employer === true ? 'employer_taxes' : 'employee_taxes', str(t.name) ?? 'Tax', num(t.amount));
    }
    for (const b of list(c.benefits)) {
      tally.add('employee_deductions', str(b.name) ?? 'Benefit', num(b.employee_deduction));
      tally.add('employer_contributions', str(b.name) ?? 'Benefit', num(b.company_contribution));
    }
    for (const d of list(c.deductions)) {
      tally.add('employee_deductions', str(d.name) ?? 'Deduction', num(d.amount));
    }
  }
  return tally.result(opts);
}

/**
 * A Gusto payroll as a pay run: its period, check date, status, the
 * company's totals and its categories.
 * @param p - The payroll.
 * @param opts - What to include.
 * @param opts.lines - Whether each category carries its lines.
 */
export function gustoPayRun(p: Json, opts: { lines: boolean } = { lines: false }): PeopleRecord {
  const period = (p.pay_period ?? {}) as Json;
  const totals = (p.totals ?? null) as Json | null;
  const check = isoDay(p.check_date);
  return {
    ...blankPeopleRecord('pay_run', String(p.payroll_uuid ?? p.uuid ?? ''), `Pay run ${check ?? isoDay(period.end_date) ?? ''}`.trim()),
    status: p.processed === true ? 'processed' : 'unprocessed',
    type: p.off_cycle === true ? 'off-cycle' : 'regular',
    startDate: isoDay(period.start_date),
    endDate: isoDay(period.end_date),
    payDate: check,
    totals: totals ? { gross: num(totals.gross_pay), net: num(totals.net_pay), employerTaxes: num(totals.employer_taxes), currency: 'USD' } : null,
    ...gustoPayRunAmounts(p, opts),
  };
}

/**
 * A Gusto time-off request: who, which days, what kind, how many hours.
 * The employee's note is never read.
 * @param t - The request.
 */
export function gustoTimeOff(t: Json): PeopleRecord {
  const employee = (t.employee ?? {}) as Json;
  const days = t.days && typeof t.days === 'object' ? Object.keys(t.days as Json).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  const hours = days.reduce((sum, d) => sum + (num((t.days as Json)[d]) ?? 0), 0);
  const who = str(employee.full_name) ?? str(employee.uuid);
  return {
    ...blankPeopleRecord('time_off', String(t.uuid ?? t.id ?? ''), `Time off${who ? ` · ${who}` : ''}`),
    status: str(t.status),
    type: str(t.request_type),
    startDate: days[0] ?? isoDay(t.start_date),
    endDate: days.at(-1) ?? isoDay(t.end_date),
    amount: days.length > 0 ? hours : null,
  };
}

/**
 * A Gusto department.
 * @param d - The department.
 */
export function gustoDepartment(d: Json): PeopleRecord {
  return blankPeopleRecord('department', String(d.uuid ?? ''), str(d.title) ?? 'Department');
}

/**
 * The provider, over one workspace's Gusto login. Built per call.
 * @param input - The source and its credential.
 */
export async function gustoPeopleProvider(input: PeopleProviderInput): Promise<PeopleProvider> {
  const credentials = input.credentials;
  if (!isLoginGrant(credentials) || typeof credentials.companyUuid !== 'string' || !credentials.companyUuid) {
    throw new Error('Gusto needs a login: an admin logs in with Gusto on the Connectors page.');
  }
  const grant = await usableLoginGrant({ vendor: VENDOR, provider: 'gusto', connectorSlug: 'gusto', grant: credentials, persistence: input.persistence, refresh: refreshGustoGrant });
  const company = encodeURIComponent(String(grant.companyUuid));
  const headers = { 'accept': 'application/json', 'authorization': `Bearer ${grant.accessToken}`, 'x-gusto-api-version': GUSTO_API_VERSION };
  const call = <T>(path: string, what: string) => vendorJson<T>({ vendor: VENDOR, what, url: `${GUSTO_API_BASE}${path}`, fetch: input.fetch, init: { headers } });

  async function list(kind: PeopleRecordKind, q: PeopleListQuery): Promise<PeoplePage> {
    const per = Math.max(1, Math.min(q.limit, 100));
    const page = Math.max(1, Number.parseInt(q.cursor ?? '1', 10) || 1);
    const ignored: string[] = [];
    switch (kind) {
      case 'worker': {
        const params = new URLSearchParams({ page: String(page), per: String(per) });
        if (q.query) {
          params.set('search_term', q.query);
        }
        const status = q.status?.toLowerCase();
        if (status === 'terminated' || status === 'active') {
          params.set('terminated', String(status === 'terminated'));
        } else if (q.status) {
          ignored.push('status');
        }
        if (q.since || q.until) {
          ignored.push('since/until');
        }
        const rows = await call<Json[]>(`/v1/companies/${company}/employees?${params.toString()}`, 'employees');
        const records = (Array.isArray(rows) ? rows : []).map(gustoWorker);
        return { records, nextCursor: records.length === per ? String(page + 1) : null, ...(ignored.length ? { ignored } : {}) };
      }
      case 'department': {
        const rows = await call<Json[]>(`/v1/companies/${company}/departments`, 'departments');
        return pageInMemory((Array.isArray(rows) ? rows : []).map(gustoDepartment), q);
      }
      case 'pay_run': {
        const params = new URLSearchParams({ include: 'totals' });
        params.set('processing_statuses', q.status?.toLowerCase() === 'unprocessed' ? 'unprocessed' : 'processed');
        if (q.since) {
          params.set('start_date', q.since.slice(0, 10));
        }
        if (q.until) {
          params.set('end_date', q.until.slice(0, 10));
        }
        const rows = await call<Json[]>(`/v1/companies/${company}/payrolls?${params.toString()}`, 'payrolls');
        const records = (Array.isArray(rows) ? rows : []).map(p => gustoPayRun(p)).sort((a, b) => (b.payDate ?? '').localeCompare(a.payDate ?? ''));
        return pageInMemory(records, { ...q, status: undefined, since: undefined, until: undefined });
      }
      case 'time_off': {
        const params = new URLSearchParams();
        if (q.since) {
          params.set('start_date', q.since.slice(0, 10));
        }
        if (q.until) {
          params.set('end_date', q.until.slice(0, 10));
        }
        const rows = await call<Json[]>(`/v1/companies/${company}/time_off_requests${params.size ? `?${params.toString()}` : ''}`, 'time off requests');
        return pageInMemory((Array.isArray(rows) ? rows : []).map(gustoTimeOff), q);
      }
      default:
        throw new Error(`${VENDOR} holds no ${String(kind).replace('_', ' ')} records here. It holds: ${KINDS.join(', ')}.`);
    }
  }

  async function get(kind: PeopleRecordKind, id: string): Promise<PeopleRecord> {
    const ref = encodeURIComponent(id);
    switch (kind) {
      case 'worker':
        return gustoWorker(await call<Json>(`/v1/employees/${ref}`, 'that employee'));
      case 'department':
        return gustoDepartment(await call<Json>(`/v1/departments/${ref}`, 'that department'));
      case 'pay_run':
        return gustoPayRun(await call<Json>(`/v1/companies/${company}/payrolls/${ref}?include=totals,taxes,benefits,deductions`, 'that payroll'), { lines: true });
      case 'time_off':
        return gustoTimeOff(await call<Json>(`/v1/companies/${company}/time_off_requests/${ref}`, 'that time off request'));
      default:
        throw new Error(`${VENDOR} holds no ${String(kind).replace('_', ' ')} records here. It holds: ${KINDS.join(', ')}.`);
    }
  }

  return { kind: 'gusto', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get };
}
