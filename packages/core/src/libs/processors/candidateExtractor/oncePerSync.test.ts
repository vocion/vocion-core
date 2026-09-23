import { describe, expect, it, vi } from 'vitest';
import { oncePerSync } from './oncePerSync';

describe('a value built once per sync', () => {
  it('builds once when two documents ask for a cold key together', async () => {
    const cache = new Map<string, unknown>();
    const build = vi.fn(async () => 'rules for the lead');

    const answers = await Promise.all([
      oncePerSync(cache, 'rules:lead', build),
      oncePerSync(cache, 'rules:lead', build),
    ]);

    expect(build).toHaveBeenCalledTimes(1);
    expect(answers).toEqual(['rules for the lead', 'rules for the lead']);
  });

  it('evicts a build that failed, so the next call builds again', async () => {
    const cache = new Map<string, unknown>();
    const build = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce('rules for the lead');

    await expect(oncePerSync(cache, 'rules:lead', build)).rejects.toThrow('database unavailable');

    expect(cache.has('rules:lead')).toBe(false);
    await expect(oncePerSync(cache, 'rules:lead', build)).resolves.toBe('rules for the lead');
    expect(build).toHaveBeenCalledTimes(2);
  });
});
