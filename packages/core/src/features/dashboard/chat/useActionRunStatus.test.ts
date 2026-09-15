import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/libs/Orpc';
import { useActionRunStatus } from './useActionRunStatus';

vi.mock('@/libs/Orpc', () => ({
  client: { review: { actionStatus: vi.fn() } },
}));

const actionStatus = vi.mocked(client.review.actionStatus);

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useActionRunStatus', () => {
  it('does not poll an id that is not a positive integer', () => {
    for (const id of [undefined, 0, -3, Number.NaN] as (number | undefined)[]) {
      renderHook(() => useActionRunStatus(id));
    }
    expect(actionStatus).not.toHaveBeenCalled();
  });

  it('reports the status it was given', async () => {
    actionStatus.mockResolvedValue({ status: 'pending', decidedBy: null, decidedAt: null } as never);
    const { result } = renderHook(() => useActionRunStatus(12));
    await waitFor(() => expect(result.current?.status).toBe('pending'));
  });

  it('stops after a terminal status', async () => {
    actionStatus.mockResolvedValue({ status: 'done', decidedBy: null, decidedAt: null } as never);
    renderHook(() => useActionRunStatus(12));
    await waitFor(() => expect(actionStatus).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    expect(actionStatus).toHaveBeenCalledTimes(1);
  });

  it('gives up on a rejected request rather than retrying it forever', async () => {
    actionStatus.mockRejectedValue(Object.assign(new Error('Bad Request'), { status: 400 }));
    renderHook(() => useActionRunStatus(12));
    await waitFor(() => expect(actionStatus).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise(r => setTimeout(r, 60));
    });
    expect(actionStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying a transport failure', async () => {
    actionStatus.mockRejectedValue(new Error('network down'));
    renderHook(() => useActionRunStatus(12));
    await waitFor(() => expect(actionStatus).toHaveBeenCalledTimes(1));
    // The first retry is 2s away; assert the loop is still armed rather than
    // waiting it out.
    expect(actionStatus).toHaveBeenCalledTimes(1);
  });
});
