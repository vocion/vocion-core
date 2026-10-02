import { describe, expect, it } from 'vitest';
import { bookkeepingPaths, changedFields, withoutBookkeeping } from './bookkeeping';

describe('what a type keeps for itself (x-bookkeeping)', () => {
  const schema = { 'type': 'object', 'x-bookkeeping': ['visuals.mockupDraw', 'rollupsUpdatedAt', '', 7] };

  it('reads the paths off the schema, and none when it declares none', () => {
    expect(bookkeepingPaths(schema)).toEqual(['visuals.mockupDraw', 'rollupsUpdatedAt']);
    expect(bookkeepingPaths({ type: 'object' })).toEqual([]);
    expect(bookkeepingPaths(null)).toEqual([]);
  });

  it('takes the paths out without touching the record', () => {
    const meta = { state: 'building', rollupsUpdatedAt: 'x', visuals: { surfaceUrl: 'https://fabrikam.example', mockupDraw: { state: 'drawing' } } };

    expect(withoutBookkeeping(meta, bookkeepingPaths(schema))).toEqual({ state: 'building', visuals: { surfaceUrl: 'https://fabrikam.example' } });
    expect(meta.visuals.mockupDraw).toEqual({ state: 'drawing' });
  });

  it('names the fields whose value changed once bookkeeping is out — none for a quiet write', () => {
    const paths = bookkeepingPaths(schema);
    const before = { state: 'building', visuals: { surfaceUrl: 'u', mockupDraw: { attempt: 1 } } };

    expect(changedFields(before, { state: 'building', visuals: { mockupDraw: { attempt: 2 }, surfaceUrl: 'u' } }, paths)).toEqual([]);
    expect(changedFields(before, { ...before, rollupsUpdatedAt: 'now' }, paths)).toEqual([]);
    expect(changedFields(before, { state: 'shipped', visuals: { surfaceUrl: 'v', mockupDraw: { attempt: 2 } } }, paths)).toEqual(['state', 'visuals']);
    // Limited to the keys a write named.
    expect(changedFields(before, { state: 'shipped', visuals: { surfaceUrl: 'v' } }, paths, ['visuals'])).toEqual(['visuals']);
    // A cleared field is a change.
    expect(changedFields(before, { visuals: before.visuals }, paths)).toEqual(['state']);
  });
});
