/**
 * ONE place a decision sheet's key is made, spelled into a URL, and read back.
 *
 * A decision sheet groups every open proposal about the same record. The list
 * derives the group key, builds the href from it, and the detail route matches
 * rows against the key it reads out of the path — three steps that used to
 * live in three files and diverged, so a sheet whose key held a dot opened a
 * 404:
 *
 *   `/dashboard/inbox/r/email%3Asomeone%40example.com`
 *
 * The path segment carried `example.com`, and the Next proxy's matcher skips
 * any path containing a dot (the asset heuristic: `favicon.ico`, `logo.png`).
 * Skipping the proxy skips next-intl's locale rewrite, so the request never
 * reached `app/[locale]/…/r/[recordKey]` and Next answered 404 before a line
 * of page code ran. `hubspot:deals:7781` has no dot, so the equivalent deal
 * sheet worked and the bug read as "email records are broken".
 *
 * So the param is escaped into an alphabet that cannot contain a dot — and
 * cannot contain a percent either, so no proxy, CDN or framework normalisation
 * step in front of us can rewrite it:
 *
 *   safe      A–Z a–z 0–9 _ -            verbatim
 *   anything  each UTF-8 byte            `~` + two uppercase hex digits
 *
 *   email:someone@example.com  →  email~3Asomeone~40example~2Ecom
 *   hubspot:deals:7781         →  hubspot~3Adeals~3A7781
 *
 * Every character of the output is unreserved per RFC 3986, so Next's own
 * percent-decoding of the route param is a no-op on it and the value the page
 * receives is the value the list wrote. `parseRecordKeyParam` is deliberately
 * lenient about anything that is not a `~XX` escape, so links minted before
 * this module — `hubspot%3Adeals%3A7781`, which arrives already decoded —
 * still resolve.
 */

import type { RecordRef } from './describeActionRun';

/** The least a row must be to have a key: a run id, and what it is about. */
export type RecordKeyed = {
  id: number;
  described: { record: RecordRef | null };
};

/**
 * The key for one row. A row with no record is its own group, keyed on the run
 * id, so it is never lumped in with strangers.
 *
 * This is the only definition. The list groups with it, the href is built from
 * it, the detail route matches with it, and the up-next queue walks it.
 * @param row
 */
export function recordKeyOf(row: RecordKeyed): string {
  return row.described.record?.key ?? `run:${row.id}`;
}

const SAFE = /[\w-]/;

/**
 * A record key as a URL path segment: dot-free, percent-free, decode-stable.
 * @param key
 */
export function recordKeyParam(key: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(key)) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && SAFE.test(ch) ? ch : `~${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

const HEX = /^[0-9a-f]{2}$/i;

/**
 * A path segment read back into a record key. Anything that is not a `~XX`
 * escape passes through unchanged, so a legacy `encodeURIComponent` link still
 * resolves to the same key once Next has decoded it.
 * @param param - The `[recordKey]` route param, as Next hands it over.
 */
export function parseRecordKeyParam(param: string): string {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let i = 0; i < param.length;) {
    const pair = param.slice(i + 1, i + 3);
    if (param[i] === '~' && HEX.test(pair)) {
      bytes.push(Number.parseInt(pair, 16));
      i += 3;
      continue;
    }
    // A lone surrogate would throw; take the code point, not the code unit.
    const cp = String.fromCodePoint(param.codePointAt(i)!);
    for (const b of encoder.encode(cp)) {
      bytes.push(b);
    }
    i += cp.length;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * The URL for one record's decision sheet.
 * @param key
 */
export function recordSheetHref(key: string): string {
  return `/dashboard/inbox/r/${recordKeyParam(key)}`;
}

/**
 * The URL for one ask group's decision sheet.
 * @param groupKey
 */
export function askGroupHref(groupKey: string): string {
  return `/dashboard/inbox/g/${recordKeyParam(groupKey)}`;
}

const HUBSPOT_NOUN: Record<string, string> = { deals: 'Deal', contacts: 'Contact', companies: 'Company' };

/**
 * What to call a record when no row is left to name it — the empty state's
 * heading. Derived from the key alone, because the rows that carried the name
 * are exactly what is missing.
 * @param key
 */
export function recordKeyLabel(key: string): string {
  const email = /^email:(.+)$/i.exec(key);
  if (email) {
    return email[1]!;
  }
  const hubspot = /^hubspot:([a-z]+):(.+)$/i.exec(key);
  if (hubspot) {
    return `${HUBSPOT_NOUN[hubspot[1]!.toLowerCase()] ?? hubspot[1]!} ${hubspot[2]}`;
  }
  const run = /^(?:run|enroll):(\d+)$/i.exec(key);
  if (run) {
    return `Proposal #${run[1]}`;
  }
  return key;
}
