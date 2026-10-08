/**
 * What the HR providers share: reading a vendor's loose JSON safely, and
 * filtering and paging a list in memory for a vendor whose API cannot.
 */

import type { PeopleListQuery, PeoplePage, PeopleRecord } from '../types';

/**
 * A non-empty trimmed string, or null.
 * @param value - Anything a vendor sent.
 */
export function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A number from a number or a numeric string, or null.
 * @param value - Anything a vendor sent.
 */
export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * The date part of an ISO date or timestamp, or null.
 * @param value - Anything a vendor sent.
 */
export function isoDay(value: unknown): string | null {
  const s = str(value);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Whether a record passes the query's text, status and date filters. Text
 * matches the name or work email; dates compare against the record's start.
 * @param record - The record.
 * @param q - The query.
 */
export function matches(record: PeopleRecord, q: Pick<PeopleListQuery, 'query' | 'status' | 'since' | 'until'>): boolean {
  if (q.query) {
    const needle = q.query.toLowerCase();
    if (!record.name.toLowerCase().includes(needle) && !(record.workEmail ?? '').toLowerCase().includes(needle)) {
      return false;
    }
  }
  if (q.status && (record.status ?? '').toLowerCase() !== q.status.toLowerCase()) {
    return false;
  }
  const day = record.startDate ?? record.payDate;
  if (q.since && (!day || day < q.since.slice(0, 10))) {
    return false;
  }
  if (q.until && (!day || day > q.until.slice(0, 10))) {
    return false;
  }
  return true;
}

/**
 * Filter and page records already in memory. The cursor is an offset.
 * @param records - Every record of the kind.
 * @param q - The query.
 */
export function pageInMemory(records: PeopleRecord[], q: PeopleListQuery): PeoplePage {
  const filtered = records.filter(r => matches(r, q));
  const start = Math.max(0, Number.parseInt(q.cursor ?? '0', 10) || 0);
  const end = start + Math.max(1, q.limit);
  return { records: filtered.slice(start, end), nextCursor: end < filtered.length ? String(end) : null };
}
