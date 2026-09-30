/**
 * What an override is measured against. The Configure page says an override
 * is "behind the plugin" when the plugin's copy changed after the override
 * was last edited — which only works if the apply keeps the base the
 * override was written against, instead of re-reading it every time.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { overrideBaseSha } = await import('./applier');

describe('an override keeps the base it was written against', () => {
  const override = { origin: 'override' as const, contentSha: 'ours-v1', baseSha: 'plugin-v2' };

  it('a new override takes the plugin copy as it stands', () => {
    expect(overrideBaseSha(null, override)).toBe('plugin-v2');
  });

  it('an unchanged override keeps its base while the plugin moves on', () => {
    const stored = { origin: 'override', contentSha: 'ours-v1', frontmatter: { baseSha: 'plugin-v1' } };

    expect(overrideBaseSha(stored, override)).toBe('plugin-v1');
  });

  it('editing the override re-bases it on the plugin copy the editor saw', () => {
    const stored = { origin: 'override', contentSha: 'ours-v0', frontmatter: { baseSha: 'plugin-v1' } };

    expect(overrideBaseSha(stored, override)).toBe('plugin-v2');
  });

  it('a row applied before bases were kept takes one on its next apply', () => {
    expect(overrideBaseSha({ origin: 'override', contentSha: 'ours-v1', frontmatter: {} }, override)).toBe('plugin-v2');
  });

  it('what is not an override has no base', () => {
    expect(overrideBaseSha(null, { origin: 'core', contentSha: 'x', baseSha: undefined })).toBeUndefined();
    expect(overrideBaseSha(null, { origin: 'workspace', contentSha: 'x' })).toBeUndefined();
  });
});
