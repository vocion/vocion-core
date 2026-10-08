/**
 * WORKDAY — HR, as a provider of the people family (`../types.ts`), read
 * through Report-as-a-Service with an integration system user.
 *
 * A Workday tenant's data model is its own, so the source names the custom
 * reports to read (`workersReport`, and optionally `timeOffReport`), built
 * in Workday with "Enable as Web Service". Each report is fetched whole as
 * JSON and its columns are read by the names Workday's delivered fields
 * usually carry (`FIELDS` below); filtering and paging happen here.
 *
 * Only those named work columns are ever copied out. A report that also
 * carries a national id, a birth date, a home address, a personal email,
 * pay or bank details has those columns dropped before an agent sees a
 * record — the safest report still holds only work fields, which the guide
 * says.
 *
 * RaaS facts this file depends on: `GET {host}/ccx/service/customreport2/
 * {tenant}/{owner}/{report}?format=json`, HTTP Basic with the integration
 * user; the answer is `{ Report_Entry: [ { <column>: value, … } ] }`.
 */

import type { PeopleListQuery, PeoplePage, PeopleProvider, PeopleProviderInput, PeopleRecord, PeopleRecordKind } from '../types';
import { Buffer } from 'node:buffer';
import { sameHost, vendorJson } from '@/libs/connectors/vendorHttp';
import { blankPeopleRecord } from '../types';
import { isoDay, num, pageInMemory, str } from './shared';

const VENDOR = 'Workday';

type Json = Record<string, unknown>;

/** The report columns read for each field, first match wins. Nothing else is read. */
const FIELDS = {
  id: ['Employee_ID', 'Worker_ID', 'Employee_Id', 'WID', 'ID'],
  name: ['Worker', 'Preferred_Name', 'Legal_Name', 'Name', 'Full_Name'],
  title: ['Business_Title', 'Job_Title', 'Position', 'Job_Profile'],
  department: ['Supervisory_Organization', 'Department', 'Cost_Center', 'Organization'],
  manager: ['Manager', 'Worker_s_Manager', 'Supervisor'],
  workEmail: ['Email_-_Work', 'Work_Email', 'Primary_Work_Email', 'Email_Work'],
  type: ['Worker_Type', 'Employee_Type', 'Time_Type', 'Worker_Sub-Type'],
  location: ['Location', 'Work_Location', 'Business_Site'],
  start: ['Hire_Date', 'Original_Hire_Date', 'Start_Date', 'Continuous_Service_Date'],
  end: ['Termination_Date', 'End_Date'],
  status: ['Worker_Status', 'Status', 'Employment_Status'],
  active: ['Active', 'Is_Active'],
} as const;

const TIME_OFF_FIELDS = {
  id: ['Time_Off_ID', 'Time_Off_Entry_ID', 'Request_ID', 'ID'],
  worker: ['Worker', 'Employee', 'Name'],
  type: ['Time_Off_Type', 'Time_Off_Plan', 'Type', 'Absence_Type'],
  start: ['Start_Date', 'Date', 'From', 'First_Day_of_Leave'],
  end: ['End_Date', 'To', 'Last_Day_of_Leave', 'Date'],
  status: ['Status', 'Approval_Status'],
  amount: ['Units', 'Quantity', 'Hours', 'Total_Units'],
  department: ['Supervisory_Organization', 'Department'],
} as const;

/**
 * The first of the named columns that holds a value. A column can be a
 * plain value, an object with `Descriptor`, or a list of either.
 * @param row - The report entry.
 * @param names - The columns to try.
 */
function pick(row: Json, names: readonly string[]): string | null {
  for (const name of names) {
    let value = row[name];
    if (Array.isArray(value)) {
      value = value[0];
    }
    if (value && typeof value === 'object') {
      value = (value as Json).Descriptor ?? (value as Json).descriptor;
    }
    const s = str(value);
    if (s) {
      return s;
    }
  }
  return null;
}

/**
 * A workers-report entry as a worker. Only the columns in `FIELDS` are read.
 * @param row - The report entry.
 * @param index - Its position, for an id when the report carries none.
 */
export function workdayWorker(row: Json, index: number): PeopleRecord {
  const id = pick(row, FIELDS.id) ?? `row-${index + 1}`;
  const active = pick(row, FIELDS.active);
  const status = pick(row, FIELDS.status)?.toLowerCase() ?? (active === null ? null : ['1', 'true', 'yes'].includes(active.toLowerCase()) ? 'active' : 'inactive');
  return {
    ...blankPeopleRecord('worker', id, pick(row, FIELDS.name) ?? id),
    status,
    title: pick(row, FIELDS.title),
    department: pick(row, FIELDS.department),
    manager: pick(row, FIELDS.manager),
    workEmail: pick(row, FIELDS.workEmail),
    type: pick(row, FIELDS.type),
    location: pick(row, FIELDS.location),
    startDate: isoDay(pick(row, FIELDS.start)),
    endDate: isoDay(pick(row, FIELDS.end)),
  };
}

/**
 * A time-off-report entry. Only the columns in `TIME_OFF_FIELDS` are read.
 * @param row - The report entry.
 * @param index - Its position, for an id when the report carries none.
 */
export function workdayTimeOff(row: Json, index: number): PeopleRecord {
  const who = pick(row, TIME_OFF_FIELDS.worker);
  const start = isoDay(pick(row, TIME_OFF_FIELDS.start));
  const id = pick(row, TIME_OFF_FIELDS.id) ?? `${who ?? 'row'}:${start ?? index + 1}`;
  return {
    ...blankPeopleRecord('time_off', id, `Time off${who ? ` · ${who}` : ''}`),
    status: pick(row, TIME_OFF_FIELDS.status)?.toLowerCase() ?? null,
    type: pick(row, TIME_OFF_FIELDS.type),
    department: pick(row, TIME_OFF_FIELDS.department),
    startDate: start,
    endDate: isoDay(pick(row, TIME_OFF_FIELDS.end)),
    amount: num(pick(row, TIME_OFF_FIELDS.amount)),
  };
}

/**
 * The RaaS URL for a configured report: `<owner>/<report>` under the
 * tenant, or a whole URL on the credential's own host.
 * @param host - The services host from the credential.
 * @param tenant - The tenant.
 * @param report - The configured report.
 * @throws {Error} For a URL on another host, which would carry the password elsewhere.
 */
export function workdayReportUrl(host: string, tenant: string, report: string): string {
  const base = host.replace(/\/+$/, '');
  let url: URL;
  if (/^https?:\/\//i.test(report)) {
    if (!sameHost(report, base)) {
      throw new Error(`The Workday report ${report} is not on ${base}, the host this credential is for, so it was not read.`);
    }
    url = new URL(report);
  } else {
    const path = report.replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/');
    if (!/^[^/]+\/[^/]+$/.test(path)) {
      throw new Error(`The Workday report "${report}" should be <owner>/<report name>, as in its web service URL.`);
    }
    url = new URL(`${base}/ccx/service/customreport2/${encodeURIComponent(tenant)}/${path}`);
  }
  url.searchParams.set('format', 'json');
  return url.toString();
}

/**
 * The provider, over one workspace's integration user. Built per call.
 * @param input - The source and its credential.
 */
export function workdayPeopleProvider(input: PeopleProviderInput): PeopleProvider {
  const c = input.credentials;
  const host = str(c.host);
  const tenant = str(c.tenant);
  const username = str(c.username);
  const password = typeof c.password === 'string' ? c.password : '';
  if (!host || !tenant || !username || !password) {
    throw new Error('No Workday integration user is stored for this source. An admin adds the host, tenant, user and password on the Connectors page.');
  }
  const workersReport = str(input.source.config.workersReport);
  const timeOffReport = str(input.source.config.timeOffReport);
  const kinds: PeopleRecordKind[] = ['worker', ...(timeOffReport ? ['time_off' as const] : [])];
  const headers = { accept: 'application/json', authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };

  async function report(which: string | null, what: string): Promise<Json[]> {
    if (!which) {
      throw new Error(`This Workday source names no ${what} report. Add it in the source's settings.`);
    }
    const body = await vendorJson<{ Report_Entry?: unknown }>({ vendor: VENDOR, what: `the ${what} report`, url: workdayReportUrl(host!, tenant!, which), fetch: input.fetch, init: { headers } });
    return Array.isArray(body?.Report_Entry) ? (body.Report_Entry as unknown[]).filter((r): r is Json => Boolean(r) && typeof r === 'object') : [];
  }

  async function all(kind: PeopleRecordKind): Promise<PeopleRecord[]> {
    if (kind === 'worker') {
      return (await report(workersReport, 'workers')).map(workdayWorker);
    }
    if (kind === 'time_off' && timeOffReport) {
      return (await report(timeOffReport, 'time off')).map(workdayTimeOff);
    }
    throw new Error(`${VENDOR} holds no ${String(kind).replace('_', ' ')} records here. It holds: ${kinds.join(', ')}.`);
  }

  async function list(kind: PeopleRecordKind, q: PeopleListQuery): Promise<PeoplePage> {
    const records = await all(kind);
    // A worker's dates are a hire date, not what since/until ask about.
    return kind === 'worker' && (q.since || q.until)
      ? { ...pageInMemory(records, { ...q, since: undefined, until: undefined }), ignored: ['since/until'] }
      : pageInMemory(records, q);
  }

  async function get(kind: PeopleRecordKind, id: string): Promise<PeopleRecord> {
    const found = (await all(kind)).find(r => r.id === id);
    if (!found) {
      throw new Error(`The Workday ${kind === 'worker' ? 'workers' : 'time off'} report has no entry ${id}.`);
    }
    return found;
  }

  return { kind: 'workday', vendor: VENDOR, sourceSlug: input.source.slug, kinds, list, get };
}
