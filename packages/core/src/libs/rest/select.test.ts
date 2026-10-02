/**
 * `response.select`: only the leaves a contract names reach the model, in
 * their original nesting, whatever the API served beside them.
 */
import { describe, expect, it } from 'vitest';
import { selectPathProblem, selectPaths } from './select';

/** A Strapi-shaped list page: rows with large JSON fields the contract never wants. */
const PROJECTS = {
  data: [
    { documentId: 'p1', name: 'Kestrel rollout', status: 'active', company: { name: 'Kestrel Capital', notes: { pages: ['…'] } }, brief: { blocks: Array.from({ length: 50 }, (_, i) => ({ i })) } },
    { documentId: 'p2', name: 'Bellwater refit', status: 'archived', company: { name: 'Bellwater Hall' }, brief: null },
    { documentId: 'p3', name: 'No company yet' },
  ],
  meta: { pagination: { page: 1, pageSize: 25, total: 3 } },
};

describe('selectPaths', () => {
  it('keeps the selected leaves in their nesting and drops everything else, meta included', () => {
    expect(selectPaths(PROJECTS, ['data[].documentId', 'data[].name', 'data[].company.name'])).toEqual({
      data: [
        { documentId: 'p1', name: 'Kestrel rollout', company: { name: 'Kestrel Capital' } },
        { documentId: 'p2', name: 'Bellwater refit', company: { name: 'Bellwater Hall' } },
        { documentId: 'p3', name: 'No company yet' },
      ],
    });
  });

  it('keeps meta only when it is selected', () => {
    expect(selectPaths(PROJECTS, ['data[].documentId', 'meta.pagination.total'])).toEqual({
      data: [{ documentId: 'p1' }, { documentId: 'p2' }, { documentId: 'p3' }],
      meta: { pagination: { total: 3 } },
    });
  });

  it('leaves a path that resolves to nothing absent — no error, no null', () => {
    expect(selectPaths(PROJECTS, ['data[].owner.email', 'meta.nope'])).toEqual({ data: [{}, {}, {}] });
    expect(selectPaths({ a: 1 }, ['b'])).toEqual({});
    expect(selectPaths(null, ['a'])).toEqual({});
    expect(selectPaths('text', ['a'])).toEqual({});
  });

  it('selects on an array itself when pick already landed on one', () => {
    expect(selectPaths(PROJECTS.data, ['[].documentId', '[].status'])).toEqual([
      { documentId: 'p1', status: 'active' },
      { documentId: 'p2', status: 'archived' },
      { documentId: 'p3' },
    ]);
  });

  it('walks nested arrays, keeps a whole subtree when a path ends on it, and lets a leaf win over a deeper path', () => {
    const doc = { rows: [{ tags: [{ id: 1, label: 'a', extra: true }, { id: 2, label: 'b' }] }, { tags: [] }] };

    expect(selectPaths(doc, ['rows[].tags[].id'])).toEqual({ rows: [{ tags: [{ id: 1 }, { id: 2 }] }, { tags: [] }] });
    expect(selectPaths(doc, ['rows[].tags'])).toEqual({ rows: [{ tags: [{ id: 1, label: 'a', extra: true }, { id: 2, label: 'b' }] }, { tags: [] }] });
    expect(selectPaths(doc, ['rows[].tags', 'rows[].tags[].id'])).toEqual(selectPaths(doc, ['rows[].tags']));
  });

  it('keeps a primitive array element only when it matches, and an object element as {} when nothing in it does', () => {
    expect(selectPaths({ ids: [1, 2, 3] }, ['ids[]'])).toEqual({ ids: [1, 2, 3] });
    expect(selectPaths({ ids: [1, { x: 1 }, 'three'] }, ['ids[].x'])).toEqual({ ids: [{ x: 1 }] });
    expect(selectPaths({ rows: [{ a: 1 }, { b: 2 }] }, ['rows[].a'])).toEqual({ rows: [{ a: 1 }, {}] });
  });

  it('does not map an array a path treats as an object, nor an object a path treats as an array', () => {
    expect(selectPaths({ data: [{ id: 1 }] }, ['data.id'])).toEqual({});
    expect(selectPaths({ data: { id: 1 } }, ['data[].id'])).toEqual({});
  });

  it('keeps falsy leaves that exist: null, 0, false, ""', () => {
    expect(selectPaths({ a: null, b: 0, c: false, d: '' }, ['a', 'b', 'c', 'd'])).toEqual({ a: null, b: 0, c: false, d: '' });
  });

  it('is the identity without paths', () => {
    expect(selectPaths(PROJECTS, undefined)).toBe(PROJECTS);
    expect(selectPaths(PROJECTS, [])).toBe(PROJECTS);
  });
});

describe('selectPathProblem', () => {
  it('accepts dotted paths, [] on a key, [] alone, dashes and digits', () => {
    for (const ok of ['name', 'company.name', 'data[].documentId', 'data[].company.name', '[].name', 'rows[][].id', 'first-name', 'x2']) {
      expect(selectPathProblem(ok)).toBeNull();
    }
  });

  it('refuses a non-string, an empty path and characters outside the set', () => {
    expect(selectPathProblem(42)).toMatch(/must be a string path/);
    expect(selectPathProblem(null)).toMatch(/must be a string path/);
    expect(selectPathProblem('')).toBe('must not be empty');
    expect(selectPathProblem('data[*]')).toMatch(/may only use/);
    expect(selectPathProblem('data[].*')).toMatch(/may only use/);
    expect(selectPathProblem('data.$id')).toMatch(/may only use/);
    expect(selectPathProblem('data name')).toMatch(/may only use/);
  });

  it('refuses a malformed segment: a bare bracket, an index, an empty segment', () => {
    expect(selectPathProblem('data[')).toMatch(/not a key optionally followed by \[\]/);
    expect(selectPathProblem('data[0]')).toMatch(/not a key optionally followed by \[\]/);
    expect(selectPathProblem('data..id')).toMatch(/empty segment/);
    expect(selectPathProblem('data.')).toMatch(/empty segment/);
    expect(selectPathProblem('.data')).toMatch(/empty segment/);
  });
});
