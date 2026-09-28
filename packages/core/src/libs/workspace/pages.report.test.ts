import type { PageRow } from './pages';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { interpolateHref, PageManifestSchema, readWorkspacePages, resolveRowActionHref } from './pages';

// The `report` archetype and the row action that reaches it. What the
// software factory's feature report needed from the page schema, and nothing
// a workspace could not use for any record whose story is worth telling.

function row(id: number, meta: Record<string, unknown>): PageRow {
  return { id, title: `r${id}`, status: null, createdAt: null, meta };
}

describe('the report archetype', () => {
  it('is accepted with a subject, and refused without one', () => {
    const base = { slug: 'feature', title: 'Feature report', archetype: 'report' };

    expect(PageManifestSchema.safeParse({ ...base, report: { subject: 'request' } }).success).toBe(true);
    expect(PageManifestSchema.safeParse(base).success).toBe(false);
    expect(PageManifestSchema.safeParse({ ...base, report: { subject: 'deal' } }).success).toBe(false);
  });

  it('says what a report page is missing, rather than failing silently', () => {
    const result = PageManifestSchema.safeParse({ slug: 'feature', title: 'Feature report', archetype: 'report' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(i => i.message)).toContain('a report page needs report.subject — the record whose story it tells');
  });

  it('takes no rows, so it takes no live interval', () => {
    const base = { slug: 'feature', title: 'Feature report', archetype: 'report', report: { subject: 'request' } };

    expect(PageManifestSchema.safeParse({ ...base, live: { every: 15 } }).success).toBe(false);
  });
});

describe('row actions', () => {
  it('fill their href from the row, by id or by any accessor', () => {
    expect(interpolateHref(row(41, {}), '/dashboard/p/feature/{id}')).toBe('/dashboard/p/feature/41');
    expect(interpolateHref(row(77, { requestId: 41 }), '/dashboard/p/feature/{meta.requestId}')).toBe('/dashboard/p/feature/41');
  });

  it('draw nothing when the row cannot fill the token — a dead link is worse than no link', () => {
    expect(interpolateHref(row(77, {}), '/dashboard/p/feature/{meta.requestId}')).toBeNull();
    expect(interpolateHref(row(77, { requestId: '' }), '/dashboard/p/feature/{meta.requestId}')).toBeNull();
  });

  it('escape the value, so a key with a slash cannot invent a route', () => {
    expect(interpolateHref(row(1, { key: 'a/b' }), '/dashboard/x/{meta.key}')).toBe('/dashboard/x/a%2Fb');
  });

  it('are declared on a list page and default to none', () => {
    const base = { slug: 'backlog', title: 'Backlog', archetype: 'list', source: { kind: 'objects', objectType: 'request' } };

    expect(PageManifestSchema.parse(base).rowActions).toEqual([]);
    expect(PageManifestSchema.safeParse({ ...base, rowActions: [{ label: 'Report', href: '/dashboard/p/feature/{id}' }] }).success).toBe(true);
    expect(PageManifestSchema.safeParse({ ...base, rowActions: [{ label: 'Report' }] }).success).toBe(false);
  });

  it('take an ordered fallback chain of hrefs, not just one', () => {
    const base = { slug: 'activity', title: 'Activity', archetype: 'list', source: { kind: 'workerRuns' } };
    const withChain = PageManifestSchema.safeParse({
      ...base,
      rowActions: [{ label: 'Outcome', href: ['/dashboard/p/feature/{meta.requestId}', '/dashboard/objects/{meta.taskRecordId}'] }],
    });

    expect(withChain.success).toBe(true);
    expect(withChain.success && withChain.data.rowActions).toEqual([
      { label: 'Outcome', href: ['/dashboard/p/feature/{meta.requestId}', '/dashboard/objects/{meta.taskRecordId}'] },
    ]);
    expect(PageManifestSchema.safeParse({ ...base, rowActions: [{ label: 'Outcome', href: [] }] }).success).toBe(false);
  });

  it('resolve to the first candidate every token of which the row can fill, the run -> task -> request chain', () => {
    const chain = ['/dashboard/p/feature/{meta.requestId}', '/dashboard/objects/{meta.taskRecordId}'];

    // The run named its request: land on the feature report.
    expect(resolveRowActionHref(row(354, { requestId: 40, taskRecordId: 100 }), chain)).toBe('/dashboard/p/feature/40');
    // The run named only a task with no request of its own (a probe): land
    // on the task record instead of a report about nothing.
    expect(resolveRowActionHref(row(354, { requestId: null, taskRecordId: 100 }), chain)).toBe('/dashboard/objects/100');
    // The run named neither (no `input.record` at all): no candidate
    // resolves, so nothing is drawn: a dead link is worse than no link.
    expect(resolveRowActionHref(row(349, {}), chain)).toBeNull();
  });
});

describe('the software factory declares the page rather than core hard-coding it', () => {
  const dirs: string[] = [];
  const prevPath = process.env.WORKSPACE_PATH;

  afterEach(() => {
    if (prevPath === undefined) {
      delete process.env.WORKSPACE_PATH;
    } else {
      process.env.WORKSPACE_PATH = prevPath;
    }
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it('ships a feature report over the request noun, off the nav', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pages-report-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: t\nname: t\nplugins: [software-factory]\n');
    process.env.WORKSPACE_PATH = dir;

    const { pages, issues } = readWorkspacePages();
    const feature = pages.find(p => p.slug === 'feature');
    const work = pages.find(p => p.slug === 'work');

    expect(issues).toEqual([]);
    expect(feature?.origin).toBe('plugin:software-factory');
    expect(feature?.archetype).toBe('report');
    expect(feature?.report).toEqual({ subject: 'request' });
    // A report is about one record, so it is reached from a row, not the nav.
    expect(feature?.nav.hidden).toBe(true);
    // Work reaches the report by the request's own id. The ROW is the drill
    // target, because the thing it opens is the outcome the row names, and a
    // second affordance beside it was never a second meaning. Work is the
    // one list of requests left (Performance went on 2026-09-24), so it is
    // the one place a report is reached from.
    expect(work?.rowLink).toBe('/dashboard/p/feature/{id}');
    expect(work?.rowActions).toEqual([]);
  });
});
