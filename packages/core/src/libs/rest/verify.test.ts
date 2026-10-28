/**
 * `verify` — reads a write declares to make before it becomes a card:
 *
 *   - Apply refuses a check that names an unknown tool, an argument the
 *     action does not take, a non-array `each`, an `each` with no cap, a
 *     tool argument left unpassed, or a refusal placeholder with no source.
 *   - `each` reads once per entry and reports every bad entry together,
 *     naming the entry and what the API said it is.
 *   - `when` skips the check when its argument was not sent; an empty list
 *     makes no reads.
 *   - `sameItemsAs` compares as sets, absent counting as empty.
 *   - A read that fails, or an argument the read needs that is missing,
 *     refuses rather than passing silently.
 */
import type { VerifyRead } from './verify';
import { describe, expect, it, vi } from 'vitest';
import { RestVerifySchema, runVerify, valueAt, verifyProblems } from './verify';

const KIND = RestVerifySchema.parse({
  each: 'keys',
  tool: 'get_issue',
  input: { projectId: '{projectId}', issueKey: '{item}' },
  expect: { path: 'fields.issuetype.name', in: ['Epic'] },
  also: { parent: 'fields.parent.key' },
  refuse: '{item} is a {found}, not an Epic (its parent: {parent}).',
});

const CURRENT = RestVerifySchema.parse({
  when: 'keys',
  tool: 'get_record',
  input: { id: '{id}' },
  expect: { path: '0.keys', sameItemsAs: 'previousKeys' },
  refuse: 'The record currently links {found}; pass exactly that as previousKeys.',
});

const CTX = {
  properties: { id: { array: false }, projectId: { array: false }, keys: { array: true, maxItems: 10 }, previousKeys: { array: true, maxItems: 10 } },
  tools: { get_issue: { declared: ['projectId', 'issueKey'], required: ['projectId', 'issueKey'] }, get_record: { declared: ['id'], required: ['id'] } },
};

/** Issues by key, as a tracker would answer them. */
const ISSUES: Record<string, unknown> = {
  'ACME-1': { fields: { issuetype: { name: 'Epic' } } },
  'ACME-2': { fields: { issuetype: { name: 'epic' } } },
  'ACME-7': { fields: { issuetype: { name: 'Story' }, parent: { key: 'ACME-1' } } },
  'ACME-8': { fields: { issuetype: { name: 'Task' } } },
};

function reader(record: unknown = [{ keys: ['ACME-9'] }]): VerifyRead & ReturnType<typeof vi.fn> {
  return vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool === 'get_record') {
      return { ok: true as const, data: record };
    }
    const issue = ISSUES[String(args.issueKey)];
    return issue ? { ok: true as const, data: issue } : { ok: false as const, message: `Ticket ${String(args.issueKey)} not found` };
  }) as never;
}

describe('verifyProblems', () => {
  it('accepts well-formed checks', () => {
    expect(verifyProblems([KIND, CURRENT], CTX)).toEqual([]);
  });

  it('names every fault', () => {
    const problems = verifyProblems([
      { ...KIND, each: 'id' },
      { ...KIND, tool: 'get_nothing' },
      { ...KIND, input: { projectId: '{projectId}' } },
      { ...KIND, input: { projectId: '{projectId}', issueKey: '{item}', extra: 'x' } },
      { ...KIND, refuse: '{item} is {mystery}' },
      { ...CURRENT, input: { id: '{item}' } },
      { ...CURRENT, when: 'nope', expect: { path: '0.keys', sameItemsAs: 'id' } },
    ], CTX);

    expect(problems.join('\n')).toMatchInlineSnapshot(`
      "verify[0]: each names "id", which is not an array argument of this action
      verify[1]: tool "get_nothing" is not one of this source's tools
      verify[2]: tool get_issue requires "issueKey", which input does not pass
      verify[3]: "extra" is not an argument of tool get_issue
      verify[4]: refuse uses {mystery}, which is not an argument, {found}, {item} or a name under also
      verify[5]: input uses {item}, which is not an argument of this action ({item} needs each)
      verify[6]: when names "nope", which is not an argument of this action
      verify[6]: expect.sameItemsAs names "id", which is not an array argument of this action"
    `);
  });

  it('refuses an each over a list with no cap, so a proposal cannot fan out into unbounded reads', () => {
    expect(verifyProblems([KIND], { ...CTX, properties: { ...CTX.properties, keys: { array: true } } })).toEqual([
      'verify[0]: "keys" needs maxItems of at most 25, so one proposal cannot fan out into unbounded reads',
    ]);
  });
});

describe('runVerify', () => {
  it('passes when every entry is the right kind, case-insensitively', async () => {
    const read = reader();

    await expect(runVerify([KIND], { projectId: 'p1', keys: ['ACME-1', 'ACME-2'] }, read)).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledWith('get_issue', { projectId: 'p1', issueKey: 'ACME-1' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reports every bad entry together, naming it and what it is', async () => {
    const refusal = await runVerify([KIND], { projectId: 'p1', keys: ['ACME-1', 'ACME-7', 'ACME-8', 'ACME-404'] }, reader());

    expect(refusal).toBe(
      'ACME-7 is a Story, not an Epic (its parent: ACME-1). '
      + 'ACME-8 is a Task, not an Epic (its parent: none). '
      + 'ACME-404: could not be checked (get_issue: Ticket ACME-404 not found).',
    );
  });

  it('makes no read for an empty list or an argument that was not sent', async () => {
    const read = reader();

    await expect(runVerify([KIND, CURRENT], { projectId: 'p1', id: 'r1', keys: [], previousKeys: [] }, read)).resolves.toMatch(/currently links ACME-9/);
    expect(read).toHaveBeenCalledTimes(1);
    await expect(runVerify([KIND, CURRENT], { projectId: 'p1', id: 'r1' }, read)).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('refuses when the read needs an argument the proposal left out', async () => {
    await expect(runVerify([KIND], { keys: ['ACME-1'] }, reader())).resolves.toBe('ACME-1: cannot be checked without "projectId" — pass it in input.');
  });

  it('compares a current list as a set, absent counting as empty', async () => {
    await expect(runVerify([CURRENT], { id: 'r1', keys: ['ACME-1'], previousKeys: ['ACME-9'] }, reader())).resolves.toBeUndefined();
    await expect(runVerify([CURRENT], { id: 'r1', keys: ['ACME-1'], previousKeys: ['ACME-9', 'ACME-3'] }, reader())).resolves.toBe('The record currently links ACME-9; pass exactly that as previousKeys.');
    await expect(runVerify([CURRENT], { id: 'r1', keys: ['ACME-1'] }, reader([{ keys: null }]))).resolves.toBeUndefined();
    await expect(runVerify([CURRENT], { id: 'r1', keys: ['ACME-1'], previousKeys: [] }, reader([{}]))).resolves.toBeUndefined();
    await expect(runVerify([CURRENT], { id: 'r1', keys: ['ACME-1'] }, reader([{ keys: ['ACME-9'] }]))).resolves.toBe('The record currently links ACME-9; pass exactly that as previousKeys.');
  });
});

describe('valueAt', () => {
  it('walks properties and array indexes, and is undefined past a missing step', () => {
    expect(valueAt([{ a: { b: 'x' } }], '0.a.b')).toBe('x');
    expect(valueAt({ a: null }, 'a.b')).toBeUndefined();
    expect(valueAt([], '0.a')).toBeUndefined();
  });
});
