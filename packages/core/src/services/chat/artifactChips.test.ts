import { describe, expect, it } from 'vitest';
import { artifactChipsByMessage } from './artifactChips';

const t = (s: number) => new Date(2026, 8, 18, 12, 0, s);
const messages = [
  { id: 1, role: 'user', createdAt: t(0) },
  { id: 2, role: 'assistant', createdAt: t(10) },
  { id: 3, role: 'user', createdAt: t(20) },
  { id: 4, role: 'assistant', createdAt: t(30) },
];

describe('artifactChipsByMessage', () => {
  it('hangs a stamped artifact under its own turn', () => {
    const chips = artifactChipsByMessage(messages, [{ id: 9, title: 'Brief', kind: 'markdown', currentVersion: 2, messageId: 2, createdAt: t(9) }]);

    expect(chips.get(2)).toEqual([{ id: 9, title: 'Brief', kind: 'markdown', version: 2 }]);
    expect(chips.get(4)).toBeUndefined();
  });

  it('an unstamped artifact lands on the first assistant turn written after it — the one that made it', () => {
    const chips = artifactChipsByMessage(messages, [{ id: 9, title: 'Chart', kind: 'chart', currentVersion: 1, messageId: null, createdAt: t(25) }]);

    expect([...chips.keys()]).toEqual([4]);
  });

  it('skips system exhaust and never doubles a chip', () => {
    const chips = artifactChipsByMessage(messages, [
      { id: 9, title: 'Check #12', kind: 'markdown', currentVersion: 1, messageId: 2, createdAt: t(9), visibility: 'system' },
      { id: 10, title: 'Brief', kind: 'markdown', currentVersion: 1, messageId: 2, createdAt: t(9) },
      { id: 10, title: 'Brief', kind: 'markdown', currentVersion: 1, messageId: 2, createdAt: t(9) },
    ]);

    expect(chips.get(2)).toHaveLength(1);
  });
});
