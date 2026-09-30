import { describe, expect, it, vi } from 'vitest';
import { closeReason, closeSupersededPulls, taskPullUrl } from './supersededPulls';

const pr = (n: number) => `https://github.com/northwind/app/pull/${n}`;

describe('a replaced attempt closes its pull request (2026-09-30: 30 open, all green)', () => {
  it('closes a superseded attempt naming its replacement, and a closed request\'s attempt, and nothing else', async () => {
    const tasks = [
      { id: 1, status: 'abandoned', meta: { requestId: 10, prUrl: pr(72), supersededBy: 2 } },
      { id: 2, status: 'dispatched', meta: { requestId: 10, prUrl: pr(86) } },
      { id: 3, status: 'accepted', meta: { requestId: 11, prUrl: pr(90) } },
      { id: 4, status: 'accepted', meta: { requestId: 12, prUrl: pr(95) } },
      { id: 5, status: 'abandoned', meta: { requestId: 10, prUrl: pr(60), prClosedAt: '2026-09-29T00:00:00Z' } },
    ];
    const close = vi.fn(async () => ({ closed: true, state: 'closed' }));
    const mark = vi.fn(async () => {});

    const out = await closeSupersededPulls('org_n', { tasks: async () => tasks, requestState: async id => (id === 11 ? 'shipped' : 'building'), close, mark });

    expect(out.closed).toEqual([1, 3]);
    expect(close).toHaveBeenCalledWith(pr(72), expect.stringContaining(`task #2 (${pr(86)})`));
    expect(close).toHaveBeenCalledWith(pr(90), expect.stringContaining('the request is shipped'));
    expect(mark).toHaveBeenCalledTimes(2);
  });

  it('keeps going past one failure, and says which', async () => {
    const tasks = [
      { id: 1, status: 'abandoned', meta: { prUrl: pr(1) } },
      { id: 2, status: 'abandoned', meta: { prUrl: pr(2) } },
    ];
    const close = vi.fn(async (url: string) => {
      if (url === pr(1)) {
        throw new Error('HTTP 403');
      }
      return { closed: true, state: 'closed' };
    });

    const out = await closeSupersededPulls('org_n', { tasks: async () => tasks, requestState: async () => null, close, mark: async () => {} });

    expect(out).toEqual({ closed: [2], failed: [{ taskId: 1, message: 'HTTP 403' }] });
  });

  it('reads only a GitHub pull request url, and leaves a live attempt alone', () => {
    expect(taskPullUrl({ prUrl: 'not a url' })).toBeNull();
    expect(taskPullUrl({ pr_url: pr(3) })).toBe(pr(3));
    expect(closeReason({ id: 9, status: 'dispatched', meta: { prUrl: pr(4) } }, 'building', null)).toBeNull();
  });
});
