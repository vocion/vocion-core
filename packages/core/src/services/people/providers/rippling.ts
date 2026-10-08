/**
 * RIPPLING — HR, as a provider of the people family (`../types.ts`).
 *
 * Read live with the workspace's Rippling API token: employees,
 * departments and leave requests. The token's own field grants decide what
 * Rippling sends; whatever it sends, only the work fields named below are
 * copied out — a social security number, date of birth, home address,
 * personal email or phone, compensation or bank account the token was
 * granted never reaches an agent.
 *
 * Rippling Platform API facts this file depends on: Bearer auth on
 * `https://api.rippling.com/platform/api`; `/employees` (active) and
 * `/employees/include_terminated` page by `limit` (≤100) and `offset`;
 * an employee names its department and manager by id; `/departments` and
 * `/leave_requests` (filters `startDate`, `endDate`, `status`) are unpaged.
 */

import type { PeopleListQuery, PeoplePage, PeopleProvider, PeopleProviderInput, PeopleRecord, PeopleRecordKind } from '../types';
import { vendorJson } from '@/libs/connectors/vendorHttp';
import { blankPeopleRecord } from '../types';
import { isoDay, matches, num, pageInMemory, str } from './shared';

const API = 'https://api.rippling.com/platform/api';
const VENDOR = 'Rippling';
const KINDS: readonly PeopleRecordKind[] = ['worker', 'department', 'time_off'];
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
      default:
        throw new Error(`${VENDOR} holds no ${String(kind).replace('_', ' ')} records here. It holds: ${KINDS.join(', ')}.`);
    }
  }

  return { kind: 'rippling', vendor: VENDOR, sourceSlug: input.source.slug, kinds: KINDS, list, get };
}
