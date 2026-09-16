import type { ReviewRow } from './reviewRows';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeActionRun } from './describeActionRun';
import { askGroupHref, parseRecordKeyParam, recordKeyLabel, recordKeyOf, recordKeyParam, recordSheetHref } from './recordKey';
import { groupByRecord } from './reviewRows';

/**
 * The 404 this module exists to stop: a decision sheet whose record key held a
 * dot never reached the page at all. Everything here is fixture data.
 */

/** Every record key an inbox row can carry, one of each shape. */
const KEYS = [
  'email:someone@example.com',
  'email:first.last+tag@mail.example.co.uk',
  'email:SOMEONE@EXAMPLE.COM',
  'hubspot:deals:7781',
  'hubspot:contacts:88201',
  'hubspot:companies:4410',
  'run:42',
  'enroll:9',
  'email:someone@example.com?x=1&y=2',
  'email:100% owner@example.com',
  'email:tilde~user@example.com',
  'email:ünïcode@exämple.test',
  'hubspot:deals:a/b c',
];

function row(id: number, actionId: string, input: Record<string, unknown>): ReviewRow {
  return {
    id,
    actionId,
    status: 'pending',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
    decidedBy: null,
    snoozedUntil: null,
    note: null,
    assignedTo: null,
    input,
    proposal: null,
    described: describeActionRun({ id, actionId, input, proposal: null, invokedBy: 'agent:fixture-agent' }),
  };
}

describe('recordKeyOf', () => {
  it('is the key the describer produced', () => {
    const r = row(1, 'gmail.send', { to: 'someone@example.com', subject: 'Fixture' });

    expect(recordKeyOf(r)).toBe('email:someone@example.com');
  });

  it('falls back to the run id when the row is about nothing', () => {
    const r = row(77, 'unknown.action', {});

    expect(r.described.record).toBeNull();
    expect(recordKeyOf(r)).toBe('run:77');
  });
});

describe('recordKeyParam round-trip', () => {
  it.each(KEYS)('survives href → route param → matcher: %s', (key) => {
    const param = recordKeyParam(key);

    // Next percent-decodes the route param before the page sees it. The
    // escaping is decode-stable, so that step must be a no-op.
    expect(decodeURIComponent(param)).toBe(param);
    expect(parseRecordKeyParam(param)).toBe(key);
  });

  it.each(KEYS)('never puts a dot or a percent in the path: %s', (key) => {
    const param = recordKeyParam(key);

    expect(param).not.toContain('.');
    expect(param).not.toContain('%');
    expect(param).toMatch(/^[\w~-]*$/);
  });

  it('still resolves a link minted before the escaping existed', () => {
    // An old href used encodeURIComponent; Next hands the page the decoded value.
    const legacy = decodeURIComponent(encodeURIComponent('hubspot:deals:7781'));

    expect(parseRecordKeyParam(legacy)).toBe('hubspot:deals:7781');
  });

  it('reads a key the list grouped straight back out of its own href', () => {
    const rows = [
      row(1, 'gmail.send', { to: 'someone@example.com', subject: 'First' }),
      row(2, 'gmail.send', { to: 'someone@example.com', subject: 'Second' }),
    ];
    const [group] = groupByRecord(rows);
    const href = recordSheetHref(group!.key);
    const param = href.slice('/dashboard/inbox/r/'.length);
    const recordKey = parseRecordKeyParam(param);

    expect(group!.rows).toHaveLength(2);
    expect(rows.filter(r => recordKeyOf(r) === recordKey)).toHaveLength(2);
  });
});

describe('the proxy matcher', () => {
  // The actual cause: `src/proxy.ts` skips any path containing a dot, so the
  // locale rewrite never ran and Next 404ed before the page did. Read the
  // matcher out of the file rather than restating it, so the two cannot drift.
  const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
  // The file holds a TypeScript string literal, so `\\.` on disk is one `\.`.
  const matcher = /matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/.exec(source)?.[1]?.replaceAll('\\\\', '\\');
  const re = new RegExp(`^${matcher}$`);

  it('reads the live matcher', () => {
    expect(matcher).toBeTruthy();
  });

  it.each(KEYS)('lets every decision-sheet URL through: %s', (key) => {
    expect(re.test(recordSheetHref(key))).toBe(true);
  });

  it.each(['group.key:example.com', 'plain-group'])('lets every ask-group URL through: %s', (key) => {
    expect(re.test(askGroupHref(key))).toBe(true);
  });

  it('would have skipped the old href shape, which is the 404', () => {
    expect(re.test(`/dashboard/inbox/r/${encodeURIComponent('email:someone@example.com')}`)).toBe(false);
    expect(re.test(`/dashboard/inbox/r/${encodeURIComponent('hubspot:deals:7781')}`)).toBe(true);
  });

  it('still skips static assets', () => {
    expect(re.test('/favicon.ico')).toBe(false);
  });
});

describe('recordKeyLabel', () => {
  it.each([
    ['email:someone@example.com', 'someone@example.com'],
    ['hubspot:deals:7781', 'Deal 7781'],
    ['hubspot:contacts:88201', 'Contact 88201'],
    ['hubspot:companies:4410', 'Company 4410'],
    ['run:42', 'Proposal #42'],
    ['something:else', 'something:else'],
  ])('%s reads as %s', (key, label) => {
    expect(recordKeyLabel(key)).toBe(label);
  });
});
