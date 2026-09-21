import { describe, expect, it } from 'vitest';
import { formatProgress, PageManifestSchema, toDate } from './pages';

// A list page can stay current while someone looks at it (`live`), and two
// formats make a worker's heartbeat legible in a row: `relative` for the
// heartbeat and the lease, `progress` for the `{phase, note}` it reports.

const list = (extra: Record<string, unknown>) => PageManifestSchema.safeParse({ slug: 'log', title: 'Log', archetype: 'list', source: { kind: 'workerRuns' }, ...extra });

describe('live', () => {
  it('is an interval in seconds, bounded 5–120, whole', () => {
    expect(list({ live: { every: 15 } }).success).toBe(true);
    expect(list({ live: { every: 5 } }).success).toBe(true);
    expect(list({ live: { every: 120 } }).success).toBe(true);
    expect(list({ live: { every: 4 } }).success).toBe(false);
    expect(list({ live: { every: 121 } }).success).toBe(false);
    expect(list({ live: { every: 7.5 } }).success).toBe(false);
    expect(list({ live: {} }).success).toBe(false);
  });

  it('is off unless asked for', () => {
    const page = list({});

    expect(page.success && page.data.live).toBeUndefined();
  });

  it('belongs to pages with rows — list and queue, not markdown or link', () => {
    expect(PageManifestSchema.safeParse({ slug: 'q', title: 'Q', archetype: 'queue', source: { kind: 'skillRuns' }, live: { every: 30 } }).success).toBe(true);

    const md = PageManifestSchema.safeParse({ slug: 'm', title: 'M', archetype: 'markdown', live: { every: 30 } });

    expect(md.success).toBe(false);
    expect(!md.success && md.error.issues[0]?.path).toEqual(['live']);
    expect(PageManifestSchema.safeParse({ slug: 'l', title: 'L', archetype: 'link', href: '/dashboard/x', live: { every: 30 } }).success).toBe(false);
  });
});

describe('the relative and progress formats', () => {
  it('are accepted on a field', () => {
    const page = list({ fields: [
      { key: 'heartbeat', from: 'meta.heartbeatAt', format: 'relative' },
      { key: 'progress', from: 'meta.progress', format: 'progress' },
    ] });

    expect(page.success).toBe(true);
  });

  it('progress reads phase · note, falls back to primitive entries, and is silent on nothing', () => {
    expect(formatProgress({ phase: 'lint', note: 'eslint --fix on 12 files' })).toBe('lint · eslint --fix on 12 files');
    expect(formatProgress({ phase: 'plan' })).toBe('plan');
    expect(formatProgress({ note: 'waiting on CI' })).toBe('waiting on CI');
    expect(formatProgress({ files: 12, step: 'lint', nested: { a: 1 } })).toBe('files: 12 · step: lint');
    expect(formatProgress('halfway')).toBe('halfway');
    expect(formatProgress({})).toBeNull();
    expect(formatProgress(null)).toBeNull();
    expect(formatProgress(undefined)).toBeNull();
  });

  it('a relative column reads Dates from the database and ISO strings from JSON alike', () => {
    const d = new Date('2026-09-20T12:00:00Z');

    expect(toDate(d)).toBe(d);
    expect(toDate('2026-09-20T12:00:00Z')?.getTime()).toBe(d.getTime());
    expect(toDate(d.getTime())?.getTime()).toBe(d.getTime());
    expect(toDate('not a date')).toBeNull();
    expect(toDate(new Date('garbage'))).toBeNull();
    expect(toDate({ at: 1 })).toBeNull();
    expect(toDate(null)).toBeNull();
  });
});
