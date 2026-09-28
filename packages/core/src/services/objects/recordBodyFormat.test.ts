/**
 * The body/headmatter split is read off the type's schema, never a list of
 * keys — so it is tested against the software factory's real `request`
 * type, and against a type that annotates nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { bodyFields, fieldDiff, locateChange, recordBodyEnabled, recordFields, renderRecordBody, replaceQuote, restoreSet } from './recordBodyFormat';

const REQUEST = parse(readFileSync(join(__dirname, '../../../templates/plugins/software-factory/objects/request/type.yaml'), 'utf8')) as { schema: Record<string, unknown> };

describe('what is body and what is headmatter', () => {
  it('reads the request type: its prose strings and its acceptance list are body, facts are not', () => {
    const keys = bodyFields(REQUEST.schema).map(f => f.key);

    expect(keys).toEqual(expect.arrayContaining(['outcome', 'body', 'story', 'acceptance', 'priorityReason', 'decisionReason']));
    expect(keys).not.toContain('state');
    expect(keys).not.toContain('tags');
    expect(keys).not.toContain('title');
    // Structured prose (evidence links, the visuals block) is data, not text.
    expect(keys).not.toContain('evidence');
    expect(keys).not.toContain('visuals');
    expect(bodyFields(REQUEST.schema).find(f => f.key === 'acceptance')).toMatchObject({ shape: 'statements', statementKey: 'statement' });
    // Reading order is the type's own.
    expect(keys.indexOf('outcome')).toBeLessThan(keys.indexOf('story'));
    expect(keys.indexOf('story')).toBeLessThan(keys.indexOf('acceptance'));
  });

  it('defaults a type that annotates nothing through the named prose keys', () => {
    const schema = { properties: { notes: { type: 'string' }, amount: { type: 'integer' } } };

    expect(bodyFields(schema).map(f => f.key)).toEqual(['notes']);
  });

  it('turns on for request by default and for any type that says so', () => {
    expect(recordBodyEnabled('request', REQUEST.schema)).toBe(true);
    expect(recordBodyEnabled('product', {})).toBe(false);
    expect(recordBodyEnabled('product', { 'x-record-body': true })).toBe(true);
    expect(recordBodyEnabled('request', { 'x-record-body': false })).toBe(false);
  });
});

describe('rendering', () => {
  it('puts facts in YAML headmatter and prose in sections, the row\'s columns in neither', () => {
    const fields = recordFields({ title: 'Kestrel sign-in', kind: 'bug', state: 'new', story: 'People at Kestrel Capital cannot sign in.', acceptance: [{ statement: 'Sign-in works', met: true }, 'A plain line'] }, REQUEST.schema);
    const md = renderRecordBody({ title: 'Kestrel sign-in', schema: REQUEST.schema, fields });

    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toMatch(/\nkind: bug\n/);
    expect(md).not.toMatch(/^title:/m);
    expect(md).toContain('# Kestrel sign-in');
    expect(md).toContain('## The story\n\nPeople at Kestrel Capital cannot sign in.');
    expect(md).toContain('- [x] Sign-in works\n- A plain line');
    expect(md.indexOf('The story')).toBeLessThan(md.indexOf('Acceptance criteria'));
  });
});

describe('diff and restore', () => {
  it('diffs values, not key order', () => {
    expect(fieldDiff(REQUEST.schema, { askedBy: { name: 'Ana', email: 'ana@northwind.example' } }, { askedBy: { email: 'ana@northwind.example', name: 'Ana' } })).toEqual([]);
    expect(fieldDiff(REQUEST.schema, { priority: 1 }, { priority: 2, state: 'new' }).map(c => c.key)).toEqual(['state', 'priority']);
  });

  it('writes only what differs, and clears what the target did not have', () => {
    expect(restoreSet({ priority: 90, state: 'in_scope' }, { state: 'in_scope' }, ['priority', 'state'])).toEqual({ priority: null });
    expect(restoreSet({ priority: 90 }, { priority: 90 }, ['priority'])).toEqual({});
    expect(restoreSet({ title: 'x' }, { title: 'y' }, ['title'])).toEqual({});
  });
});

describe('change — finding the selected words', () => {
  it('replaces words as written, or as they read on screen', () => {
    expect(replaceQuote('A **bold** claim', 'A bold claim', 'A plain claim')).toBe('A plain claim');
    expect(replaceQuote('See [the docs](https://docs.example/x) for more', 'the docs for', 'the guide for')).toBe('See the guide for more');
    expect(replaceQuote('one\ntwo', 'one two', 'three')).toBe('three');
    expect(replaceQuote('snake_case stays', 'snake_case', 'kebab-case')).toBe('kebab-case stays');
    expect(replaceQuote('nothing here', 'absent', 'x')).toBeNull();
  });

  it('prefers the field the page named, then the body in reading order', () => {
    const fields = { outcome: 'Faster close', story: 'Faster close is the point.' };

    expect(locateChange(REQUEST.schema, fields, 'Faster close', 'Quicker close')!.key).toBe('outcome');
    expect(locateChange(REQUEST.schema, fields, 'Faster close', 'Quicker close', 'The story')!.key).toBe('story');
  });
});
