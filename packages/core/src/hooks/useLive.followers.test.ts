import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

/**
 * The chat's followers on the live stream (backlog 050): a card decided
 * somewhere else flips in the transcript the moment the stream says so, with
 * no polling while the stream is up; a turn's chips re-read when what they
 * follow moves; and both fall back to the poll they had before the stream
 * existed while it is down. The stream itself is a switch and a doorbell
 * here — `libs/live/client.test.ts` covers the connection.
 */

const stream = vi.hoisted(() => ({ live: true, topics: [] as string[][], rings: [] as Array<() => void> }));
vi.mock('@/hooks/useLive', () => ({
  useLive: (topics: readonly string[], onNotice: (n: unknown) => void) => {
    stream.topics.push([...topics]);
    stream.rings.push(() => onNotice({ id: 1, topics, ref: topics[0], kind: 'changed', at: new Date().toISOString() }));
    return { live: stream.live && topics.length > 0, state: stream.live ? 'open' : 'down' };
  },
}));

vi.mock('@/libs/Orpc', () => ({
  client: {
    review: { actionStatus: vi.fn() },
    preview: { status: vi.fn() },
  },
}));

const { client } = await import('@/libs/Orpc');
const { useActionRunStatus } = await import('@/features/dashboard/chat/useActionRunStatus');
const { useFollowStatus } = await import('@/features/dashboard/chat/useFollowStatus');

const actionStatus = vi.mocked(client.review.actionStatus);
const previewStatus = vi.mocked(client.preview.status);
const ring = () => stream.rings.at(-1)!();

beforeEach(() => {
  stream.live = true;
  stream.topics = [];
  stream.rings = [];
  actionStatus.mockReset();
  previewStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a chat card', () => {
  it('follows its run, reads once, and flips when it is decided elsewhere — without polling', async () => {
    actionStatus.mockResolvedValue({ status: 'pending', decidedBy: null, decidedAt: null } as never);
    const { result } = await renderHook(() => useActionRunStatus(42));

    await vi.waitFor(() => expect(result.current?.status).toBe('pending'));

    expect(stream.topics.at(-1)).toEqual(['card:42']);

    // Longer than the fastest poll: nothing asks again while the stream is up.
    await new Promise(r => setTimeout(r, 2_300));

    expect(actionStatus).toHaveBeenCalledTimes(1);

    // Approved on Review, in another tab.
    actionStatus.mockResolvedValue({ status: 'done', decidedBy: 'user_grace', decidedAt: '2026-09-30T12:00:00.000Z' } as never);
    ring();

    await vi.waitFor(() => expect(result.current?.status).toBe('done'));

    expect(result.current?.decidedBy).toBe('user_grace');
  });

  it('keeps following after it is done, so an undo made elsewhere flips it back', async () => {
    actionStatus.mockResolvedValue({ status: 'done', decidedBy: 'user_ada', decidedAt: null } as never);
    const { result } = await renderHook(() => useActionRunStatus(43));
    await vi.waitFor(() => expect(result.current?.status).toBe('done'));

    actionStatus.mockResolvedValue({ status: 'undone', decidedBy: 'user_ada', decidedAt: null } as never);
    ring();

    await vi.waitFor(() => expect(result.current?.status).toBe('undone'));
  });

  it('polls as it did before the stream existed while the stream is down', async () => {
    stream.live = false;
    actionStatus.mockResolvedValue({ status: 'pending', decidedBy: null, decidedAt: null } as never);
    await renderHook(() => useActionRunStatus(44));

    await vi.waitFor(() => expect(actionStatus.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 3_000 });
  });
});

describe('a turn\'s chips', () => {
  const follow = [
    { ref: { type: 'worker_run', id: '9' } },
    { ref: { type: 'object', id: '12' } },
  ] as never;

  it('follow what is still moving, and re-read when it moves', async () => {
    previewStatus.mockResolvedValue({ 'worker_run:9': { state: 'running' }, 'object:12': { state: 'done' } } as never);
    const { result } = await renderHook(() => useFollowStatus(follow, 60));

    await vi.waitFor(() => expect(result.current['worker_run:9']).toEqual({ state: 'running' }));

    // The settled record is no longer followed; the run is.
    await vi.waitFor(() => expect(stream.topics.at(-1)).toEqual(['run:9']));
    await new Promise(r => setTimeout(r, 300));

    expect(previewStatus).toHaveBeenCalledTimes(1);

    previewStatus.mockResolvedValue({ 'worker_run:9': { state: 'done' }, 'object:12': { state: 'done' } } as never);
    ring();

    await vi.waitFor(() => expect(result.current['worker_run:9']).toEqual({ state: 'done' }));
  });

  it('poll while the stream is down', async () => {
    stream.live = false;
    previewStatus.mockResolvedValue({ 'worker_run:9': { state: 'running' }, 'object:12': { state: 'running' } } as never);
    await renderHook(() => useFollowStatus(follow, 60));

    await vi.waitFor(() => expect(previewStatus.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2_000 });
  });
});
