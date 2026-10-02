/**
 * Reading an edited body back into fields — the half of the artifact path
 * that makes `update_artifact` on a record a record write (backlog 035).
 * Tested against the software factory's real `request` type and a type that
 * annotates nothing; every name is fictional.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { recordFields, renderRecordBody } from './recordBodyFormat';
import { parseRecordBody, setBetween } from './recordBodyParse';

const REQUEST = parse(readFileSync(join(__dirname, '../../../templates/plugins/software-factory/objects/request/type.yaml'), 'utf8')) as { schema: Record<string, unknown> };

const META = {
  kind: 'gap',
  state: 'triaged',
  priority: 70,
  outcome: 'Finance at Northwind closes the month without retyping the ledger.',
  story: 'Every month end someone copies **the ledger** into a sheet by hand.',
  acceptance: [
    { id: 'a1', statement: 'A CSV of the ledger downloads from the ledger page', met: false },
    { id: 'a2', statement: 'Existing exports keep working' },
  ],
};

function body() {
  const fields = recordFields(META, REQUEST.schema);
  return { fields, md: renderRecordBody({ title: 'Export the ledger as CSV', schema: REQUEST.schema, fields }) };
}

describe('parseRecordBody', () => {
  it('reads an unedited body back to exactly the fields it was rendered from', () => {
    const { fields, md } = body();
    const parsed = parseRecordBody(md, REQUEST.schema, fields);

    expect(parsed.whole).toBe(true);
    expect(parsed.title).toBe('Export the ledger as CSV');
    expect(setBetween(fields, parsed.fields)).toEqual({});
  });

  it('a reworded acceptance line keeps its id; a new line is a new item; a ticked box is met', () => {
    const { fields, md } = body();
    const edited = md
      .replace('- [ ] A CSV of the ledger downloads from the ledger page', '- [x] A CSV named after the ledger and today\'s date downloads from the ledger page')
      .replace('- Existing exports keep working', '- Existing exports keep working\n- The CSV opens in a spreadsheet without an import step');
    const set = setBetween(fields, parseRecordBody(edited, REQUEST.schema, fields).fields);

    expect(Object.keys(set)).toEqual(['acceptance']);
    expect(set.acceptance).toEqual([
      { id: 'a1', statement: 'A CSV named after the ledger and today\'s date downloads from the ledger page', met: true },
      { id: 'a2', statement: 'Existing exports keep working' },
      { statement: 'The CSV opens in a spreadsheet without an import step' },
    ]);
  });

  it('a headmatter edit writes the fact; the prose is untouched', () => {
    const { fields, md } = body();
    const set = setBetween(fields, parseRecordBody(md.replace('priority: 70', 'priority: 85'), REQUEST.schema, fields).fields);

    expect(set).toEqual({ priority: 85 });
  });

  it('a whole body that drops a section clears that field', () => {
    const { fields, md } = body();
    const edited = md.replace(/## The story\n\n[^\n]+\n\n/, '');
    const set = setBetween(fields, parseRecordBody(edited, REQUEST.schema, fields).fields);

    expect(set).toEqual({ story: null });
  });

  it('prose alone (no headmatter) changes only the section it carries', () => {
    const { fields } = body();
    const set = setBetween(fields, parseRecordBody('## The story\n\nNorthwind\'s controller rebuilds the ledger in a sheet every month.', REQUEST.schema, fields).fields);

    expect(set).toEqual({ story: 'Northwind\'s controller rebuilds the ledger in a sheet every month.' });
  });

  it('refuses headmatter that is not key: value', () => {
    const { fields } = body();

    expect(() => parseRecordBody('---\n- just\n- a list\n---\n# X\n', REQUEST.schema, fields)).toThrow(/key: value/);
  });

  it('reads a type that annotates nothing through its named prose keys', () => {
    const schema = { properties: { notes: { type: 'string' }, amount: { type: 'integer' } } };
    const current = { notes: 'Net 30.', amount: 4 };
    const md = renderRecordBody({ title: 'Contoso Supply', schema, fields: current });
    const set = setBetween(current, parseRecordBody(md.replace('Net 30.', 'Net 45 from October.').replace('amount: 4', 'amount: 5'), schema, current).fields);

    expect(set).toEqual({ amount: 5, notes: 'Net 45 from October.' });
  });
});

describe('setBetween', () => {
  it('never writes the row\'s own columns', () => {
    expect(setBetween({ state: 'new' }, { state: 'triaged', title: 'Renamed', status: 'done' })).toEqual({ state: 'triaged' });
  });
});
