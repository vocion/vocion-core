/**
 * What a run's usage total does with the cache numbers.
 *
 * `addTurnToRunUsage` is the arithmetic behind the cost shown on a finished
 * run and behind the budget it charges. Prompt caching split the input side
 * three ways, and every way of folding it up wrong is silent:
 *
 *   - A cache read that is not summed makes the saving invisible — the run
 *     looks the same price whether caching worked or never engaged.
 *   - A cache write that is not summed undercharges the first turn of every
 *     run by about a quarter, because a written prefix costs 1.25x plain input.
 *   - `cents` accumulated turn by turn drifts, because most cent amounts are
 *     not values a floating-point number holds exactly.
 *
 * Costs are compared against `tokenCostMicroCents` rather than written out, so
 * a price change moves the expectation and these stay tests of the folding.
 */
import type { RunUsage } from './AgentService';
import { describe, expect, it } from 'vitest';
import { tokenCostMicroCents } from '@/libs/pricing';
import { addTurnToRunUsage } from './AgentService';

const MODEL = 'claude-sonnet-4-6';

/** A run that has had no turns yet. */
function emptyRun(): RunUsage {
  return { model: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, microCents: 0, cents: 0, turns: 0 };
}

describe('addTurnToRunUsage', () => {
  it('carries the cache counts onto the run, not just the plain tokens', async () => {
    const usage = emptyRun();

    addTurnToRunUsage(usage, { model: MODEL, inputTokens: 3_184, outputTokens: 200, cacheReadTokens: 3_163, cacheWriteTokens: 0 });

    expect(usage).toMatchObject({
      model: MODEL,
      turns: 1,
      inputTokens: 3_184,
      outputTokens: 200,
      cacheReadTokens: 3_163,
      cacheWriteTokens: 0,
    });
  });

  it('charges a cold turn more than the warm turn that reads the same prefix back', () => {
    // The shape of a real run: turn one writes the prefix at 1.25x, every turn
    // after reads it at a tenth. Before `cacheWriteTokens` was summed here, the
    // cold turn was billed as ordinary input and came out CHEAPER than it is.
    const cold = emptyRun();
    addTurnToRunUsage(cold, { model: MODEL, inputTokens: 3_183, outputTokens: 200, cacheWriteTokens: 3_163 });
    const warm = emptyRun();
    addTurnToRunUsage(warm, { model: MODEL, inputTokens: 3_184, outputTokens: 200, cacheReadTokens: 3_163 });

    expect(cold.microCents).toBeGreaterThan(warm.microCents);
  });

  it('prices a warm turn well below the same turn with no cache at all', () => {
    const warm = emptyRun();
    addTurnToRunUsage(warm, { model: MODEL, inputTokens: 3_184, outputTokens: 200, cacheReadTokens: 3_163 });
    const uncached = emptyRun();
    addTurnToRunUsage(uncached, { model: MODEL, inputTokens: 3_184, outputTokens: 200 });

    expect(warm.microCents).toBeLessThan(uncached.microCents);
  });

  it('sums a multi-turn run rather than keeping only the last turn', () => {
    const usage = emptyRun();
    addTurnToRunUsage(usage, { model: MODEL, inputTokens: 3_183, outputTokens: 200, cacheWriteTokens: 3_163 });
    addTurnToRunUsage(usage, { model: MODEL, inputTokens: 3_400, outputTokens: 150, cacheReadTokens: 3_163 });
    addTurnToRunUsage(usage, { model: MODEL, inputTokens: 3_600, outputTokens: 90, cacheReadTokens: 3_163 });

    expect(usage.turns).toBe(3);
    expect(usage.inputTokens).toBe(10_183);
    expect(usage.outputTokens).toBe(440);
    expect(usage.cacheReadTokens).toBe(6_326);
    expect(usage.cacheWriteTokens).toBe(3_163);
  });

  it('prices each turn on its own model when a run switches mid-way', () => {
    // A delegation can answer on a different model than the parent. Pricing the
    // whole run at the last turn's rate would misprice everything before it.
    const usage = emptyRun();
    addTurnToRunUsage(usage, { model: 'claude-haiku-4-5', inputTokens: 1_000, outputTokens: 50 });
    addTurnToRunUsage(usage, { model: MODEL, inputTokens: 1_000, outputTokens: 50 });

    const expected = tokenCostMicroCents('claude-haiku-4-5', { inputTokens: 1_000, outputTokens: 50 })
      + tokenCostMicroCents(MODEL, { inputTokens: 1_000, outputTokens: 50 });

    expect(usage.microCents).toBe(expected);
    // And the run is named after the model that answered last.
    expect(usage.model).toBe(MODEL);
  });

  it('keeps cents derived from the exact micro-cent total, not added up per turn', () => {
    // Ten turns whose individual cent values are not exactly representable.
    const usage = emptyRun();
    for (let turn = 0; turn < 10; turn += 1) {
      addTurnToRunUsage(usage, { model: MODEL, inputTokens: 333, outputTokens: 77 });
    }

    expect(usage.cents).toBe(usage.microCents / 1_000_000);
    expect(Number.isInteger(usage.microCents)).toBe(true);
  });

  it('treats a turn that reported no counts as zero cost rather than NaN', () => {
    // A provider that reports nothing is a real case; NaN would poison the
    // run's total for every turn after it.
    const usage = emptyRun();
    addTurnToRunUsage(usage, { model: MODEL });
    addTurnToRunUsage(usage, { model: MODEL, inputTokens: 100, outputTokens: 10 });

    expect(Number.isNaN(usage.microCents)).toBe(false);
    expect(usage.microCents).toBe(tokenCostMicroCents(MODEL, { inputTokens: 100, outputTokens: 10 }));
  });
});
