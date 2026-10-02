import { describe, expect, it } from 'vitest';
import { reportedRunCents, runCostCents } from './runCost';

describe('what a worker run cost', () => {
  it('is the worker\'s final account when it sent one, else the heartbeats\' sum', () => {
    expect(reportedRunCents({ token_usage: { cost_usd: 3.52 } })).toBe(352);
    expect(reportedRunCents({ status: 'failed', cost_usd: 1.894 })).toBe(189);
    expect(reportedRunCents({ token_usage: { cost_usd: 'x' } })).toBeNull();
    expect(reportedRunCents(null)).toBeNull();
    expect(runCostCents({ cents: 704, result: { token_usage: { cost_usd: 3.52 } } })).toBe(352);
    expect(runCostCents({ cents: 704, result: null })).toBe(704);
    expect(runCostCents({ cents: null })).toBeNull();
  });
});
