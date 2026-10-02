/**
 * The three templating rules a REST source's paths, queries, bodies and
 * review hints depend on: a lone placeholder keeps its argument's type, an
 * argument that was not supplied drops the entry that named it, and a path
 * with a missing parameter is refused rather than guessed at.
 */
import { describe, expect, it } from 'vitest';
import { builtinPlaceholderProblems, placeholdersIn, placeholdersInTemplate, renderPath, renderQuery, renderString, renderTemplate } from './template';

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

    expect(renderTemplate(body, { name: 'Kickoff', tagB: 'q4' })).toEqual({ data: { name: 'Kickoff', tags: ['q4'] }, fixed: 1 });
  });

  it('prunes an object that became empty, recursively, and keeps a literal {} and an emptied array', () => {
    // `priority: {}` would read as "set priority to nothing"; a template that
    // declared an empty object meant it.
    const body = { data: { priority: { name: '{priority}' }, meta: { nested: { deep: '{x}' } }, literal: {}, tags: ['{tag}'] } };

    expect(renderTemplate(body, {})).toEqual({ data: { literal: {}, tags: [] } });
    expect(renderTemplate({ data: { priority: { name: '{priority}' } } }, {})).toBeUndefined();
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

describe('built-in dates', () => {
  // 2026-09-29 23:30 UTC is 2026-09-30 in Auckland and 2026-09-29 in Los Angeles.
  const now = new Date('2026-09-29T23:30:00Z');
  const la = { now, timeZone: 'America/Los_Angeles' };
  const nz = { now, timeZone: 'Pacific/Auckland' };

  it('resolves today in the clock\'s zone, and falls back to UTC for a zone it does not know', () => {
    expect(renderString('{$today}', {}, la)).toBe('2026-09-29');
    expect(renderString('{$today}', {}, nz)).toBe('2026-09-30');
    expect(renderString('{$today}', {}, { now, timeZone: 'Mars/Olympus' })).toBe('2026-09-29');
    expect(renderString('{$today}', {})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does the arithmetic on the server: today±Nd, month start and end, the Monday of the week', () => {
    expect(renderString('{$today-7d}', {}, la)).toBe('2026-09-22');
    expect(renderString('{$today+30d}', {}, la)).toBe('2026-10-29');
    expect(renderString('{$monthStart}', {}, la)).toBe('2026-09-01');
    expect(renderString('{$monthEnd}', {}, la)).toBe('2026-09-30');
    // 2026-09-29 is a Tuesday; 2026-09-30 a Wednesday; a Monday is its own week start.
    expect(renderString('{$weekStart}', {}, la)).toBe('2026-09-28');
    expect(renderString('{$weekStart}', {}, nz)).toBe('2026-09-28');
    expect(renderString('{$weekStart}', {}, { now: new Date('2026-09-28T12:00:00Z'), timeZone: 'UTC' })).toBe('2026-09-28');
    expect(renderString('{$monthEnd}', {}, { now: new Date('2028-02-10T12:00:00Z'), timeZone: 'UTC' })).toBe('2028-02-29');
  });

  it('works wherever an input placeholder does — beside one, in a query, a path and a body — and is never an input', () => {
    expect(renderString('{$today-7d}..{$today}', {}, la)).toBe('2026-09-22..2026-09-29');
    expect(renderString('{name} due {$monthEnd}', { name: 'Kickoff' }, la)).toBe('Kickoff due 2026-09-30');
    expect(renderQuery({ 'filters[dueDate][$gte]': '{$today}', 'filters[status]': '{status}' }, {}, la)).toEqual({ 'filters[dueDate][$gte]': '2026-09-29' });
    expect(renderPath('/api/reports/{$today}', {}, la)).toEqual({ ok: true, path: '/api/reports/2026-09-29' });
    expect(renderTemplate({ data: { from: '{$weekStart}', to: '{$today}' } }, {}, la)).toEqual({ data: { from: '2026-09-28', to: '2026-09-29' } });
    expect(placeholdersIn('{$today} {name}')).toEqual(['name']);
  });

  it('names any other {$…} at apply time', () => {
    expect(builtinPlaceholderProblems({ q: '{$tomorrow}', p: '/x/{$today}', b: ['{$monthStart+1d}'] })).toEqual([
      expect.stringContaining('{$tomorrow} is not a built-in placeholder'),
      expect.stringContaining('{$monthStart+1d} is not a built-in placeholder'),
    ]);
    expect(builtinPlaceholderProblems({ q: '{$today-7d}', b: '{$weekStart}' })).toEqual([]);
  });
});

describe('placeholders', () => {
  it('lists each placeholder once, in order, across a whole template', () => {
    expect(placeholdersIn('/a/{x}/{y}/{x}')).toEqual(['x', 'y']);
    expect(placeholdersInTemplate({ data: { name: '{name}', tags: ['{tag}'] }, title: 'Update {name}' })).toEqual(['name', 'tag']);
  });
});
