/**
 * THE PEOPLE FAMILY — the HR system of record as an agent reads it, whichever
 * vendor holds it (Gusto, Rippling, Workday; `providers/*.ts`).
 *
 * Who works here, in which team, under whom, since when, who is out, and
 * what a pay run cost in total. The agent's tools are named for those
 * records (`people_list`, `people_get`); the connected source decides which
 * vendor answers.
 *
 * PERSONAL DATA IS NEVER RETURNED, BY CONSTRUCTION. A worker record is built
 * from an allowlist (`PeopleRecord`'s fields): work identity, team, manager,
 * dates, location as a city or a site name. Government ids, dates of birth,
 * home addresses, personal emails and phones, bank accounts and any one
 * person's pay are never copied out of the vendor's answer — there is no
 * field to put them in, and `people.test.ts` feeds every provider a vendor
 * answer that carries them and checks none comes out. A pay run is its
 * company-wide totals by category (`payRun.ts`), summed inside the provider;
 * any one person's pay has no field to land in. Read-only: nothing is ever
 * written to an HR system.
 */

import type { PayRunCategory, PayRunReconciliation } from './payRun';
import type { GrantPersistence } from '@/libs/connect/loginGrant';
import type { FetchLike } from '@/libs/connectors/vendorHttp';

export const PEOPLE_RECORD_KINDS = ['worker', 'department', 'time_off', 'pay_run'] as const;

export type PeopleRecordKind = typeof PEOPLE_RECORD_KINDS[number];

/**
 * One record, the same shape from every vendor. Only work information: see
 * the module comment. A field the vendor does not have is null.
 */
export type PeopleRecord = {
  kind: PeopleRecordKind;
  /** The vendor's id — what `people_get` takes. */
  id: string;
  /** The worker's name, the department's name, "Time off · <worker>", "Pay run 2026-09-30". */
  name: string;
  /** Active, terminated, on leave; approved, pending; processed — the vendor's own word. */
  status: string | null;
  /** Job title (worker). */
  title: string | null;
  /** Department or team (worker, time off). */
  department: string | null;
  /** The manager's name or the vendor's id for them (worker); the parent department (department). */
  manager: string | null;
  /** Work email only (worker). */
  workEmail: string | null;
  /** Full-time, part-time, contractor (worker); vacation, sick (time off). */
  type: string | null;
  /** A city, a country or a site name — never a street address. */
  location: string | null;
  /** Start date (worker), first day off (time off), period start (pay run). */
  startDate: string | null;
  /** End or termination date (worker), last day off (time off), period end (pay run). */
  endDate: string | null;
  /** The check date (pay run). */
  payDate: string | null;
  /** Totals for the whole pay run, in major units of `currency` — never one person's pay. */
  totals: { gross: number | null; net: number | null; employerTaxes: number | null; currency: string | null } | null;
  /** The pay run by category, company-wide (pay run); lines only on `people_get`. Null when the vendor does not break it down. */
  categories: PayRunCategory[] | null;
  /** Whether the categories add up to net pay, within a cent (pay run). */
  reconciliation: PayRunReconciliation | null;
  /** Hours or days off (time off). */
  amount: number | null;
  url: string | null;
};

export type PeopleListQuery = {
  /** A name or work email to look for. */
  query?: string;
  status?: string;
  /** Records dated on or after this ISO date (time off, pay runs). */
  since?: string;
  until?: string;
  limit: number;
  cursor?: string | null;
};

export type PeoplePage = { records: PeopleRecord[]; nextCursor: string | null; ignored?: string[] };

export type PeopleProvider = {
  kind: string;
  vendor: string;
  sourceSlug: string;
  kinds: readonly PeopleRecordKind[];
  list: (kind: PeopleRecordKind, query: PeopleListQuery) => Promise<PeoplePage>;
  get: (kind: PeopleRecordKind, id: string) => Promise<PeopleRecord>;
};

export type PeopleProviderInput = {
  orgId: string;
  source: { id: number; slug: string; config: Record<string, unknown> };
  credentials: Record<string, unknown>;
  persistence: GrantPersistence;
  fetch?: FetchLike;
};

/**
 * An empty record of one kind, for a mapper to fill only the fields it has.
 * @param kind - The record kind.
 * @param id - The vendor's id.
 * @param name - Its name.
 */
export function blankPeopleRecord(kind: PeopleRecordKind, id: string, name: string): PeopleRecord {
  return { kind, id, name, status: null, title: null, department: null, manager: null, workEmail: null, type: null, location: null, startDate: null, endDate: null, payDate: null, totals: null, categories: null, reconciliation: null, amount: null, url: null };
}
