import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

type Job = { value: number; delayMs: number };

/** Shared counters so a worker can report how many ran at once. */
type Meter = { inFlight: number; peak: number };

const meter: Meter = { inFlight: 0, peak: 0 };

async function slowDouble(job: Job): Promise<number> {
  meter.inFlight += 1;
  meter.peak = Math.max(meter.peak, meter.inFlight);
  await new Promise(resolve => setTimeout(resolve, job.delayMs));
  meter.inFlight -= 1;
  return job.value * 2;
}

function jobs(delays: number[]): Job[] {
  return delays.map((delayMs, index) => ({ value: index, delayMs }));
}

describe('mapWithConcurrency', () => {
  it('never runs more than the limit at once', async () => {
    meter.inFlight = 0;
    meter.peak = 0;

    await mapWithConcurrency(jobs([5, 5, 5, 5, 5, 5, 5]), 2, slowDouble);

    // Without a bound this would peak at 7, and a rate-limited API would
    // start refusing calls.
    expect(meter.peak).toBe(2);
  });

  it('returns results in input order even when later jobs finish first', async () => {
    meter.inFlight = 0;
    meter.peak = 0;

    // The first job is the slowest, so completion order is the reverse of
    // input order. A naive push-as-they-finish implementation scrambles the
    // results here, which for evals would file each score against the wrong
    // test case.
    const results = await mapWithConcurrency(jobs([30, 20, 1]), 3, slowDouble);

    expect(results).toEqual([0, 2, 4]);
  });

  it('treats a limit above the item count as "run them all"', async () => {
    meter.inFlight = 0;
    meter.peak = 0;

    const results = await mapWithConcurrency(jobs([1, 1]), 99, slowDouble);

    expect(results).toEqual([0, 2]);
    expect(meter.peak).toBe(2);
  });

  it('runs one at a time when the limit is zero or negative', async () => {
    meter.inFlight = 0;
    meter.peak = 0;

    // A misconfigured limit must not mean "no workers", which would hang
    // forever, nor "unbounded", which is the thing the limit exists to stop.
    await mapWithConcurrency(jobs([1, 1, 1]), 0, slowDouble);

    expect(meter.peak).toBe(1);
  });

  it('returns an empty array without calling the worker', async () => {
    meter.inFlight = 0;
    meter.peak = 0;

    const results = await mapWithConcurrency([], 4, slowDouble);

    expect(results).toEqual([]);
    expect(meter.peak).toBe(0);
  });
});
