/**
 * RIPPLING — HR, as a provider of the people family (`../types.ts`).
 *
 * Read live with the workspace's Rippling API token: employees,
 * departments, leave requests and pay runs. The token's own field grants
 * decide what Rippling sends; whatever it sends, only the work fields named
 * below are copied out: a social security number, date of birth, home
 * address, personal email or phone, compensation or bank account the token
 * was granted never reaches an agent.
 *
 * A pay run comes back as company-wide totals by category. Rippling answers
 * one payroll record per worker; those are summed here (`payRunTally`) and
 * only the sums leave this file, so no worker's id, earnings, taxes or
 * deductions reach an agent.
 *
 * Rippling Platform API facts this file depends on: Bearer auth on
 * `https://api.rippling.com/platform/api`; `/employees` (active) and
 * `/employees/include_terminated` page by `limit` (≤100) and `offset`;
 * an employee names its department and manager by id; `/departments` and
 * `/leave_requests` (filters `startDate`, `endDate`, `status`) are unpaged.
 *
 * Rippling REST API facts the pay runs depend on, taken from its published
 * reference and not yet checked against a live payroll company: the same
 * Bearer token on `https://rest.ripplingapis.com`; `/payroll-runs/` and
 * `/payroll-runs/{id}/` give a run's state, type, check date and pay period;
 * `/payroll-runs/{id}/worker-payroll-records/` gives one record per worker
 * with `gross_pay`, `net_pay`, `currency`, a `summary` of taxes, deductions
 * and contributions, and `earnings`, `taxes` (`paid_by` EMPLOYEE or
 * EMPLOYER), `deductions` (`employee_amount`, `employer_amount`) and
 * `garnishments` arrays; amounts are decimal strings; lists page by
 * `next_link`.
 */

import type { PeopleListQuery, PeoplePage, PeopleProvider, PeopleProviderInput, PeopleRecord, PeopleRecordKind } from '../types';
import { sameHost, vendorJson } from '@/libs/connectors/vendorHttp';
import { payRunTally } from '../payRun';
import { blankPeopleRecord } from '../types';
import { isoDay, matches, num, pageInMemory, str } from './shared';

const API = 'https://api.rippling.com/platform/api';
const REST_API = 'https://rest.ripplingapis.com';
const VENDOR = 'Rippling';
const KINDS: readonly PeopleRecordKind[] = ['worker', 'department', 'time_off', 'pay_run'];
/** Pay runs summed per list page: each one reads every worker's record. */
const RUN_PAGE = 10;
/** The most pages read from one Rippling list, of runs or of a run's worker records. */
const MAX_PAGES = 100;
/** The most employees read while filtering by text or status in memory. */
const SCAN_LIMIT = 2000;
const PAGE = 100;

type Json = Record<string, unknown>;

/**
 * Rippling's employment type code, in words.
 * @param code - e.g. `SALARIED_FT`.
 */
function employmentType(code: unknown): string | null {
  const s = str(code);
  if (!s) {
    return null;
  }
  const words: Record<string, string> = { SALARIED_FT: 'full-time', HOURLY_FT: 'full-time', SALARIED_PT: 'part-time', HOURLY_PT: 'part-time', CONTRACTOR: 'contractor', TEMP: 'temporary', INTERN: 'intern' };
  return words[s] ?? s.toLowerCase().replaceAll('_', ' ');
}

/**
 * A Rippling employee as a worker. Only the work fields are read.
 * @param e - The employee.
 * @param departments - Department id → name, when the caller read them.
 */
export function ripplingWorker(e: Json, departments: ReadonlyMap<string, string> = new Map()): PeopleRecord {
  const name = str(e.name) ?? ([str(e.preferredFirstName) ?? str(e.firstName), str(e.lastName)].filter(Boolean).join(' ') || str(e.id) || 'Employee');
  const departmentId = str(e.department);
  const location = e.workLocation && typeof e.workLocation === 'object' ? (e.workLocation as Json) : null;
  return {
    ...blankPeopleRecord('worker', String(e.id ?? ''), name),
    status: str(e.roleState)?.toLowerCase() ?? null,
    title: str(e.title),
    department: departmentId ? (departments.get(departmentId) ?? departmentId) : null,
    manager: str(e.manager),
    workEmail: str(e.workEmail),
    type: employmentType(e.employmentType),
    location: location ? ([str(location.city), str(location.country)].filter(Boolean).join(', ') || str(location.name)) : null,
    startDate: isoDay(e.startDate),
    endDate: isoDay(e.endDate),
  };
}

/**
 * A Rippling leave request: who, when, what kind, how many hours. The reason
 * for leave is never read.
 * @param l - The leave request.
 */
export function ripplingTimeOff(l: Json): PeopleRecord {
  const who = str(l.roleName) ?? str(l.role);
  return {
    ...blankPeopleRecord('time_off', String(l.id ?? ''), `Time off${who ? ` · ${who}` : ''}`),
    status: str(l.status)?.toLowerCase() ?? null,
    type: str(l.leaveTypeUniqueId) ?? str(l.leavePolicy),
    startDate: isoDay(l.startDate),
    endDate: isoDay(l.endDate),
    amount: num(l.numHours),
  };
}

/**
 * A Rippling department.
 * @param d - The department.
 * @param departments - Department id → name, for the parent.
 */
export function ripplingDepartment(d: Json, departments: ReadonlyMap<string, string> = new Map()): PeopleRecord {
  const parent = str(d.parent);
  return { ...blankPeopleRecord('department', String(d.id ?? ''), str(d.name) ?? 'Department'), manager: parent ? (departments.get(parent) ?? parent) : null };
}

/**
 * A Rippling payroll run as a pay run: its period, check date, state and
 * type. The amounts come from `ripplingPayRunAmounts`.
 * @param r - The payroll run.
 */
export function ripplingPayRun(r: Json): PeopleRecord {
  const period = (r.pay_period ?? {}) as Json;
  const check = isoDay(r.check_date);
  return {
    ...blankPeopleRecord('pay_run', String(r.id ?? ''), str(r.title) ?? `Pay run ${check ?? isoDay(period.end_date) ?? ''}`.trim()),
    status: str(r.run_state)?.toLowerCase() ?? null,
    type: str(r.run_type)?.toLowerCase().replaceAll('_', '-') ?? null,
    startDate: isoDay(period.start_date),
    endDate: isoDay(period.end_date),
    payDate: check,
  };
}

/**
 * Every worker's payroll record in one run, summed into company-wide
 * categories. Only the sums are returned: no worker id, name or amount.
 * A record's itemised earnings, taxes and deductions are used when it has
 * them, else its `gross_pay` and `summary`.
 * @param rows - The run's worker payroll records.
 * @param opts - What to include.
 * @param opts.lines - Whether each category carries its lines.
 */
export function ripplingPayRunAmounts(rows: Json[], opts: { lines: boolean }): Pick<PeopleRecord, 'totals' | 'categories' | 'reconciliation'> {
  const currencies = new Set(rows.map(w => str(w.currency)).filter(Boolean));
  if (currencies.size > 1) {
    // Sums across currencies would book nothing true.
    return { totals: null, categories: null, reconciliation: null };
  }
  const tally = payRunTally();
  const list = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
  for (const w of rows) {
    const summary = (w.summary ?? {}) as Json;
    const earnings = list(w.earnings);
    if (earnings.length > 0) {
      for (const e of earnings) {
        const label = str(e.display_name) ?? str(e.earning_code) ?? 'Earnings';
        const reimbursement = /reimburs/i.test(`${str(e.earning_category) ?? ''} ${str(e.earning_code) ?? ''}`);
        tally.add(reimbursement ? 'reimbursements' : 'gross_wages', label, num(e.amount));
      }
    } else {
      tally.add('gross_wages', 'Gross pay', num(w.gross_pay));
    }
    const taxes = list(w.taxes);
    if (taxes.length > 0) {
      for (const t of taxes) {
        tally.add(str(t.paid_by)?.toUpperCase() === 'EMPLOYER' ? 'employer_taxes' : 'employee_taxes', str(t.display_name) ?? str(t.tax_code) ?? 'Tax', num(t.amount));
      }
    } else {
      tally.add('employee_taxes', 'Employee taxes', num(summary.employee_taxes));
      tally.add('employer_taxes', 'Employer taxes', num(summary.employer_taxes));
    }
    const deductions = list(w.deductions);
    if (deductions.length > 0) {
      for (const d of deductions) {
        const label = str(d.display_name) ?? str(d.deduction_code) ?? 'Deduction';
        tally.add('employee_deductions', label, num(d.employee_amount));
        tally.add('employer_contributions', label, num(d.employer_amount));
      }
    } else {
      tally.add('employee_deductions', 'Employee deductions', num(summary.employee_deductions));
      tally.add('employer_contributions', 'Employer contributions', num(summary.employer_contributions));
    }
    const garnishments = list(w.garnishments);
    if (garnishments.length > 0) {
      for (const g of garnishments) {
        tally.add('employee_deductions', `Garnishment${str(g.garnishment_code) ? ` · ${str(g.garnishment_code)}` : ''}`, num(g.amount));
      }
    } else {
      tally.add('employee_deductions', 'Garnishments', num(summary.total_garnishments));
    }
    tally.add('net_pay', 'Net pay', num(w.net_pay));
  }
  const { categories, reconciliation } = tally.result(opts);
  const amount = (c: string) => categories.find(x => x.category === c)!.amount;
  return {
    totals: { gross: amount('gross_wages'), net: amount('net_pay'), employerTaxes: amount('employer_taxes'), currency: [...currencies][0] ?? null },
    categories,
    reconciliation,
  };
}

/**
 * The provider, over one workspace's Rippling token. Built per call.
 * @param input - The source and its credential.
 */
export function ripplingPeopleProvider(input: PeopleProviderInput): PeopleProvider {
  const token = typeof input.credentials.apiKey === 'string' ? input.credentials.apiKey.trim() : '';
  if (!token) {
    throw new Error('No Rippling API token is stored for this source. An admin pastes one on the Connectors page.');
  }
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  const call = <T>(path: string, what: string) => vendorJson<T>({ vendor: VENDOR, what, url: `${API}${path}`, fetch: input.fetch, init: { headers } });

  /**
   * Every page of a REST list, following `next_link` only on Rippling's own
   * host. Too many pages is an error, never a partial sum.
   * @param path - The list's path on the REST API.
   * @param what - What it lists, for an error.
   */
  async function restAll(path: string, what: string): Promise<Json[]> {
    const rows: Json[] = [];
    let url: string | null = `${REST_API}${path}`;
    for (let page = 0; url; page += 1) {
      if (page === MAX_PAGES) {
        throw new Error(`${VENDOR} sent more than ${MAX_PAGES} pages of ${what}; nothing was summed.`);
      }
      const body: Json[] | { results?: Json[]; next_link?: unknown } = await vendorJson({ vendor: VENDOR, what, url, fetch: input.fetch, init: { headers } });
      if (Array.isArray(body)) {
        rows.push(...body);
        break;
      }
      rows.push(...(body?.results ?? []));
      const next = str(body?.next_link);
      url = next && sameHost(next, REST_API) ? next : null;
    }
    return rows;
  }

  async function payRunWithAmounts(record: PeopleRecord, lines: boolean): Promise<PeopleRecord> {
    const rows = await restAll(`/payroll-runs/${encodeURIComponent(record.id)}/worker-payroll-records/`, 'payroll records');
    return { ...record, ...ripplingPayRunAmounts(rows, { lines }) };
  }

  async function departmentRows(): Promise<Json[]> {
    const rows = await call<Json[] | { results?: Json[] }>('/departments', 'departments');
    return Array.isArray(rows) ? rows : (rows?.results ?? []);
  }

  async function departmentNames(): Promise<Map<string, string>> {
    // A token without department access still lists workers, by department id.
    const rows = await departmentRows().catch(() => [] as Json[]);
    return new Map(rows.map(d => [String(d.id ?? ''), str(d.name) ?? String(d.id ?? '')]));
  }

  async function employeesPage(path: string, offset: number, limit: number): Promise<Json[]> {
    const rows = await call<Json[] | { results?: Json[] }>(`${path}?limit=${limit}&offset=${offset}`, 'employees');
    return Array.isArray(rows) ? rows : (rows?.results ?? []);
  }

  async function list(kind: PeopleRecordKind, q: PeopleListQuery): Promise<PeoplePage> {
    switch (kind) {
      case 'worker': {
        const names = await departmentNames();
        // Active people by default; a status asked for reads everyone and filters.
        const path = q.status ? '/employees/include_terminated' : '/employees';
        const limit = Math.max(1, Math.min(q.limit, PAGE));
        const offset = Math.max(0, Number.parseInt(q.cursor ?? '0', 10) || 0);
        const ignored = q.since || q.until ? ['since/until'] : [];
        if (!q.query && !q.status) {
          const rows = await employeesPage(path, offset, limit);
          return { records: rows.map(e => ripplingWorker(e, names)), nextCursor: rows.length === limit ? String(offset + limit) : null, ...(ignored.length ? { ignored } : {}) };
        }
        // Rippling has no search: read pages and filter, up to a ceiling.
        const found: PeopleRecord[] = [];
        let at = offset;
        while (found.length < limit && at < offset + SCAN_LIMIT) {
          const rows = await employeesPage(path, at, PAGE);
          for (const [i, e] of rows.entries()) {
            const record = ripplingWorker(e, names);
            if (matches(record, { query: q.query, status: q.status })) {
              found.push(record);
              if (found.length === limit) {
                return { records: found, nextCursor: String(at + i + 1), ...(ignored.length ? { ignored } : {}) };
              }
            }
          }
          if (rows.length < PAGE) {
            return { records: found, nextCursor: null, ...(ignored.length ? { ignored } : {}) };
          }
          at += PAGE;
        }
        return { records: found, nextCursor: String(at), ...(ignored.length ? { ignored } : {}) };
      }
      case 'department': {
        const rows = await departmentRows();
        const names = new Map(rows.map(d => [String(d.id ?? ''), str(d.name) ?? '']));
        return pageInMemory(rows.map(d => ripplingDepartment(d, names)), q);
      }
      case 'time_off': {
        const params = new URLSearchParams();
        if (q.since) {
          params.set('startDate', q.since.slice(0, 10));
        }
        if (q.until) {
          params.set('endDate', q.until.slice(0, 10));
        }
        if (q.status) {
          params.set('status', q.status.toUpperCase());
        }
        const rows = await call<Json[] | { results?: Json[] }>(`/leave_requests${params.size ? `?${params.toString()}` : ''}`, 'leave requests');
        const list = Array.isArray(rows) ? rows : (rows?.results ?? []);
        return pageInMemory(list.map(ripplingTimeOff), { ...q, since: undefined, until: undefined });
      }
      case 'pay_run': {
        const runs = (await restAll('/payroll-runs/', 'payroll runs')).map(ripplingPayRun).sort((a, b) => (b.payDate ?? '').localeCompare(a.payDate ?? ''));
        const page = pageInMemory(runs, { ...q, limit: Math.min(q.limit, RUN_PAGE) });
        const records: PeopleRecord[] = [];
        for (const run of page.records) {
          records.push(await payRunWithAmounts(run, false));
        }
        return { ...page, records };
      }
      default:
        throw new Error(`${VENDOR} holds no ${String(kind).replace('_', ' ')} records here. It holds: ${KINDS.join(', ')}.`);
    }
  }

  async function get(kind: PeopleRecordKind, id: string): Promise<PeopleRecord> {
    const ref = encodeURIComponent(id);
    switch (kind) {
      case 'worker':
        return ripplingWorker(await call<Json>(`/employees/${ref}`, 'that employee'), await departmentNames());
      case 'department': {
        const rows = await departmentRows();
        const found = rows.find(d => String(d.id) === id);
        if (!found) {
          throw new Error(`${VENDOR} has no department ${id}.`);
        }
        return ripplingDepartment(found, new Map(rows.map(d => [String(d.id ?? ''), str(d.name) ?? ''])));
      }
      case 'time_off':
        return ripplingTimeOff(await call<Json>(`/leave_requests/${ref}`, 'that leave request'));
      case 'pay_run':
        return payRunWithAmounts(ripplingPayRun(await vendorJson<Json>({ vendor: VENDOR, what: 'that payroll run', url: `${REST_API}/payroll-runs/${ref}/`, fetch: input.fetch, init: { headers } })), true);
      default:
        throw new Error(`${VENDOR} holds no ${String(kind).replace('_', ' ')} records here. It holds: ${KINDS.join(', ')}.`);
    }
  }

  return { kind: 'rippling', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get };
}
