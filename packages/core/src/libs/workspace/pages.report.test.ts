import type { PageRow } from './pages';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { interpolateHref, PageManifestSchema, readWorkspacePages } from './pages';

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
    const performance = pages.find(p => p.slug === 'performance');

    expect(issues).toEqual([]);
    expect(feature?.origin).toBe('plugin:software-factory');
    expect(feature?.archetype).toBe('report');
    expect(feature?.report).toEqual({ subject: 'request' });
    // A report is about one record, so it is reached from a row, not the nav.
    expect(feature?.nav.hidden).toBe(true);
    // Work and Performance are both lists of requests, so both reach the
    // same report by the request's own id. On Work the ROW is the drill
    // target, because the thing it opens is the outcome the row names, and a
    // second affordance beside it was never a second meaning.
    expect(work?.rowLink).toBe('/dashboard/p/feature/{id}');
    expect(work?.rowActions).toEqual([]);
    expect(performance?.rowActions).toEqual([{ label: 'Report', href: '/dashboard/p/feature/{id}' }]);
  });
});
