import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimPageReread, onPageReread, requestPageReread, REREAD_MIN_GAP_MS, resetPageRereadForTests } from './pageReread';

describe('the page\'s one re-read (#269)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPageRereadForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gathers a burst of asks from every follower into one re-read, run by the page\'s owner', () => {
    const owner = vi.fn();
    const chip = vi.fn();
    const heard = vi.fn();
    claimPageReread({ reread: owner });
    onPageReread(heard);

    // The record, its body artifact and the run that wrote it, in one breath.
    requestPageReread(chip);
    requestPageReread(chip);
    requestPageReread(chip);
    vi.advanceTimersByTime(0);

    expect(owner).toHaveBeenCalledTimes(1);
    expect(chip).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);

    // Right after one, the next ask waits out the window, and rides one re-read.
    requestPageReread(chip);
    requestPageReread(chip);
    vi.advanceTimersByTime(REREAD_MIN_GAP_MS - 1);

    expect(owner).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);

    expect(owner).toHaveBeenCalledTimes(2);
  });

  it('uses the asker\'s own re-read when nothing owns the page, and the newest owner when several do', () => {
    const own = vi.fn();
    requestPageReread(own);
    vi.advanceTimersByTime(REREAD_MIN_GAP_MS);

    expect(own).toHaveBeenCalledTimes(1);

    const first = vi.fn();
    const second = vi.fn();
    claimPageReread({ reread: first });
    const release = claimPageReread({ reread: second });
    requestPageReread(own);
    vi.advanceTimersByTime(REREAD_MIN_GAP_MS);

    expect(second).toHaveBeenCalledTimes(1);

    release();
    requestPageReread(own);
    vi.advanceTimersByTime(REREAD_MIN_GAP_MS);

    expect(first).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('reads at once for a tap or the page\'s own poll, taking the gathered asks with it', () => {
    const owner = vi.fn();
    claimPageReread({ reread: owner });
    requestPageReread(vi.fn());
    requestPageReread(vi.fn(), { now: true });

    expect(owner).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REREAD_MIN_GAP_MS);

    expect(owner).toHaveBeenCalledTimes(1);
  });
});
