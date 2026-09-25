import { describe, expect, it } from 'vitest';
import { boundProgress, MAX_LOG_LINES } from './progress';

describe('a running worker\'s progress is bounded', () => {
  it('keeps the last 40 lines, cuts a line at 300 characters, keeps the step and anything else', () => {
    const p = boundProgress({ step: '  running typecheck ', log: Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(400)}`), trace: [{ at: '2026-09-25T00:00:00Z', label: 'npm ci', status: 'done' }, { label: 'no at' }], custom: 7 });

    expect(p.step).toBe('running typecheck');
    expect(p.log).toHaveLength(MAX_LOG_LINES);
    expect(p.log?.[0]).toMatch(/^line 60 /);
    expect(p.log?.[0]?.length).toBe(300);
    expect(p.trace).toEqual([{ at: '2026-09-25T00:00:00Z', label: 'npm ci', status: 'done' }]);
    expect(p.custom).toBe(7);
  });

  it('drops the three fields when they are not the shape, and leaves the rest', () => {
    expect(boundProgress({ step: 4, log: 'not a list', trace: null, pct: 40 })).toEqual({ pct: 40 });
  });
});
