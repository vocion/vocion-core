import { describe, expect, it } from 'vitest';
import { PageManifestSchema, resolveField } from './pages';

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
