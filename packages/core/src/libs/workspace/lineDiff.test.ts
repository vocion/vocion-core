import { describe, expect, it } from 'vitest';
import { diffCounts, lineDiff, unifiedLineDiff } from './lineDiff';

describe('lineDiff', () => {
  it('marks a changed line as a removal and an addition, keeping the rest', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc');

    expect(d).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'B' },
      { op: ' ', text: 'c' },
    ]);
  });

  it('treats an empty before as all additions', () => {
    expect(lineDiff('', 'x\ny')).toEqual([{ op: '+', text: 'x' }, { op: '+', text: 'y' }]);
    expect(diffCounts('', 'x\ny')).toEqual({ removed: 0, added: 2 });
  });

  it('folds unchanged runs and says where lines were skipped', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line ten');
    const u = unifiedLineDiff(before, after, { context: 1 });

    expect(u).toBe('…\n  line 9\n- line 10\n+ line ten\n  line 11\n…');
    expect(unifiedLineDiff(before, before)).toBe('');
  });

  it('caps the output', () => {
    const before = 'a';
    const after = Array.from({ length: 500 }, (_, i) => `added ${i}`).join('\n');

    expect(unifiedLineDiff(before, after, { maxChars: 200 })).toMatch(/diff truncated\)$/);
  });
});
