import type { PageField, PageRow } from './pages';
import { describe, expect, it } from 'vitest';
import { computeStat, formatDuration, isZeroFigure, PageManifestSchema, resolveField, tableLayout } from './pages';

// Two small additions to the page manifest, both for a plugin that wants its
// run log and a core surface in its own nav section: the `workerRuns` list
// source over worker_run rows, and the `link` archetype that pins a core
// route under the plugin's own label.

describe('the workerRuns list source', () => {
  it('validates its narrowing and defaults the limit', () => {
    const ok = PageManifestSchema.safeParse({ slug: 'log', title: 'Log', archetype: 'list', source: { kind: 'workerRuns', kinds: ['worker', 'lead'], status: ['completed'], agentSlugs: ['task-engineer'] } });

    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.source).toMatchObject({ kind: 'workerRuns', limit: 100 });
    expect(PageManifestSchema.safeParse({ slug: 'log', title: 'Log', archetype: 'list', source: { kind: 'workerRuns', limit: 0 } }).success).toBe(false);
    expect(PageManifestSchema.safeParse({ slug: 'log', title: 'Log', archetype: 'list', source: { kind: 'workerRuns', agentSlugs: ['Not A Slug'] } }).success).toBe(false);
  });

  it('a field reaches into result and input by dot path, the way artifact fields reach meta', () => {
    const row = { id: 7, title: 'run', status: 'completed', createdAt: null, meta: { cents: 13, result: { pr_url: 'https://example.test/pr/1', branch: 'sf/task-9' }, input: { task: { task_id: 9 } } } };

    expect(resolveField(row, 'meta.result.pr_url')).toBe('https://example.test/pr/1');
    expect(resolveField(row, 'meta.result.branch')).toBe('sf/task-9');
    expect(resolveField(row, 'meta.input.task.task_id')).toBe(9);
    expect(resolveField(row, 'meta.cents')).toBe(13);
  });

  it('accepts the money and link formats', () => {
    const page = PageManifestSchema.safeParse({ slug: 'log', title: 'Log', archetype: 'list', source: { kind: 'workerRuns' }, fields: [{ key: 'cents', from: 'meta.cents', format: 'money' }, { key: 'pr', from: 'meta.result.pr_url', format: 'link' }] });

    expect(page.success).toBe(true);
  });
});

describe('the link archetype', () => {
  it('needs an href, and nothing else', () => {
    const ok = PageManifestSchema.safeParse({ slug: 'team-report', title: 'Team report', archetype: 'link', href: '/dashboard/team-report', nav: { section: 'Software factory' } });
    const missing = PageManifestSchema.safeParse({ slug: 'team-report', title: 'Team report', archetype: 'link' });

    expect(ok.success).toBe(true);
    expect(missing.success).toBe(false);
    expect(!missing.success && missing.error.issues[0]?.path).toEqual(['href']);
  });
});

// Three additions Activity needed and every list page now has: views, a stat
// that disappears when it is zero, and a field that is evidence rather than a
// column.

describe('views', () => {
  const base = { slug: 'activity', title: 'Activity', archetype: 'list' as const, source: { kind: 'workerRuns' as const } };

  it('takes filters or an href, never both, and the first is the default', () => {
    const ok = PageManifestSchema.safeParse({
      ...base,
      views: [
        { key: 'all', label: 'All' },
        { key: 'runs', label: 'Runs', filters: [{ field: 'meta.kind', op: 'eq', value: 'worker' }] },
        { key: 'releases', label: 'Releases', href: '/dashboard/p/releases' },
      ],
    });

    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.views?.[0]).toMatchObject({ key: 'all' });
    expect(PageManifestSchema.safeParse({
      ...base,
      views: [{ key: 'all', label: 'All' }, { key: 'x', label: 'X', href: '/a', filters: [{ field: 'status', op: 'exists' }] }],
    }).success).toBe(false);
  });

  it('refuses a default that is a link away from the page, and a duplicate key', () => {
    expect(PageManifestSchema.safeParse({
      ...base,
      views: [{ key: 'releases', label: 'Releases', href: '/dashboard/p/releases' }, { key: 'all', label: 'All' }],
    }).success).toBe(false);
    expect(PageManifestSchema.safeParse({
      ...base,
      views: [{ key: 'all', label: 'All' }, { key: 'all', label: 'Again' }],
    }).success).toBe(false);
  });

  it('belongs to the archetypes that have rows to narrow', () => {
    const views = [{ key: 'all', label: 'All' }, { key: 'runs', label: 'Runs', filters: [{ field: 'status', op: 'exists' }] }];

    expect(PageManifestSchema.safeParse({ slug: 'notes', title: 'Notes', archetype: 'markdown', views }).success).toBe(false);
  });
});

describe('a stat that is only worth a tile when it happened', () => {
  it('is left off the page at zero and drawn otherwise', () => {
    const lost: PageRow[] = [];
    const stat = { label: 'Lost', kind: 'count' as const, threshold: undefined, where: undefined, suffix: undefined, format: 'number' as const, hideWhenZero: true, field: undefined };

    expect(isZeroFigure(computeStat(lost, stat))).toBe(true);
    expect(isZeroFigure(computeStat([{ id: 1, title: 'a', status: 'lost', createdAt: null, meta: {} }], stat))).toBe(false);
    expect(isZeroFigure('$0.00')).toBe(true);
    expect(isZeroFigure('0%')).toBe(true);
    expect(isZeroFigure('$12.34')).toBe(false);
  });
});

describe('a field that is evidence rather than a column', () => {
  const f = (over: Partial<PageField> & Pick<PageField, 'key'>): PageField => ({ label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true, ...over });

  it('is kept out of the table and handed to the row', () => {
    const fields = [f({ key: 'headline' }), f({ key: 'cost', format: 'money' }), f({ key: 'tokens', detail: true }), f({ key: 'lease', detail: true })];
    const rows: PageRow[] = [{ id: 1, title: 't', status: null, createdAt: null, meta: {} }];
    const layout = tableLayout(rows, fields, { field: 'headline', subtitle: [] });

    expect(layout.columns.map(c => c.key)).toEqual(['cost']);
    expect(layout.details.map(c => c.key)).toEqual(['tokens', 'lease']);
  });

  it('is not smuggled back in through the subtitle', () => {
    const fields = [f({ key: 'headline' }), f({ key: 'lease', detail: true })];
    const layout = tableLayout([{ id: 1, title: 't', status: null, createdAt: null, meta: {} }], fields, { field: 'headline', subtitle: ['lease'] });

    expect(layout.subtitle).toEqual([]);
    expect(layout.details.map(c => c.key)).toEqual(['lease']);
  });
});

describe('a duration', () => {
  it('reads as the length a person compares runs by', () => {
    expect(formatDuration(43)).toBe('43s');
    expect(formatDuration(116)).toBe('1m 56s');
    expect(formatDuration(1105)).toBe('18m 25s');
    expect(formatDuration(7440)).toBe('2h 4m');
    expect(formatDuration(0)).toBe('0s');
  });
});
