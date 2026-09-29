import { describe, expect, it } from 'vitest';
import { checksAllowMerge } from './githubMerge';

describe('a merge waits for green checks', () => {
  it('lets through only finished, passing checks', () => {
    expect(checksAllowMerge([{ name: 'lint', status: 'completed', conclusion: 'success' }, { name: 'e2e', status: 'completed', conclusion: 'skipped' }])).toEqual({ ok: true });
    expect(checksAllowMerge([{ name: 'test', status: 'in_progress', conclusion: null }])).toEqual({ ok: false, why: '1 check is still running (test)' });
    expect(checksAllowMerge([{ name: 'build', status: 'completed', conclusion: 'failure' }])).toEqual({ ok: false, why: '1 check failed (build)' });
  });
});
