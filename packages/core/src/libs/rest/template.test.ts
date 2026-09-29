/**
 * The three templating rules a REST source's paths, queries, bodies and
 * review hints depend on: a lone placeholder keeps its argument's type, an
 * argument that was not supplied drops the entry that named it, and a path
 * with a missing parameter is refused rather than guessed at.
 */
import { describe, expect, it } from 'vitest';
import { placeholdersIn, placeholdersInTemplate, renderPath, renderQuery, renderString, renderTemplate } from './template';

describe('renderString', () => {
  it('keeps the argument\'s own type for a string that is exactly one placeholder', () => {
    expect(renderString('{count}', { count: 3 })).toBe(3);
    expect(renderString('{archived}', { archived: false })).toBe(false);
    expect(renderString('{tags}', { tags: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(renderString('{name}', { name: 'Kestrel' })).toBe('Kestrel');
  });

  it('resolves a lone placeholder for an argument that was not supplied to undefined, null included', () => {
    expect(renderString('{search}', {})).toBeUndefined();
    expect(renderString('{search}', { search: null })).toBeUndefined();
  });

  it('renders a mixed string as text, with a missing argument as empty and every argument missing as nothing', () => {
    expect(renderString('Update milestone {documentId}', { documentId: 'm-12' })).toBe('Update milestone m-12');
    expect(renderString('{first} {last}', { first: 'Ada' })).toBe('Ada ');
    expect(renderString('Due: {dueDate}', {})).toBeUndefined();
    expect(renderString('no placeholders here', {})).toBe('no placeholders here');
  });

  it('writes a number, a boolean and a list into text', () => {
    expect(renderString('page {page} of {pages}', { page: 2, pages: 10 })).toBe('page 2 of 10');
    expect(renderString('archived={archived}', { archived: true })).toBe('archived=true');
    expect(renderString('ids={ids}', { ids: [1, 2] })).toBe('ids=1,2');
  });
});

describe('renderTemplate', () => {
  it('drops object keys and array entries that resolved to nothing, at any depth', () => {
    const body = { data: { name: '{name}', dueDate: '{dueDate}', owner: { id: '{ownerId}' }, tags: ['{tagA}', '{tagB}'] }, fixed: 1 };

    expect(renderTemplate(body, { name: 'Kickoff', tagB: 'q4' })).toEqual({ data: { name: 'Kickoff', owner: {}, tags: ['q4'] }, fixed: 1 });
  });

  it('keeps JSON types through a body — a number stays a number', () => {
    expect(renderTemplate({ data: { hours: '{hours}', done: '{done}' } }, { hours: 12.5, done: true })).toEqual({ data: { hours: 12.5, done: true } });
  });
});

describe('renderQuery', () => {
  it('appends only the parameters that resolved, as strings, and keeps literals', () => {
    const query = { 'filters[status][$eq]': '{status}', 'filters[name][$containsi]': '{search}', 'pagination[pageSize]': '100' };

    expect(renderQuery(query, { status: 'active' })).toEqual({ 'filters[status][$eq]': 'active', 'pagination[pageSize]': '100' });
    expect(renderQuery({ limit: '{limit}' }, { limit: 25 })).toEqual({ limit: '25' });
  });
});

describe('renderPath', () => {
  it('substitutes and URL-encodes path parameters', () => {
    expect(renderPath('/api/projects/{documentId}', { documentId: 'a b/c' })).toEqual({ ok: true, path: '/api/projects/a%20b%2Fc' });
    expect(renderPath('/api/projects', {})).toEqual({ ok: true, path: '/api/projects' });
  });

  it('refuses a path whose parameter was not supplied, naming it', () => {
    expect(renderPath('/api/projects/{documentId}/milestones/{milestoneId}', { documentId: 'p1' })).toEqual({ ok: false, missing: ['milestoneId'] });
  });
});

describe('placeholders', () => {
  it('lists each placeholder once, in order, across a whole template', () => {
    expect(placeholdersIn('/a/{x}/{y}/{x}')).toEqual(['x', 'y']);
    expect(placeholdersInTemplate({ data: { name: '{name}', tags: ['{tag}'] }, title: 'Update {name}' })).toEqual(['name', 'tag']);
  });
});
