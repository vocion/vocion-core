/**
 * What prompt caching does to the bill.
 *
 * Prompt caching splits the input side three ways, and each split is a way to
 * get the number wrong:
 *
 * - A cache READ is billed at the discounted rate, so it has to come off the
 *   full-rate input rather than being charged twice.
 * - A cache WRITE is billed at 1.25x input — MORE than a plain token. Before
 *   `cacheWriteTokens` existed, a write was charged as ordinary input, which
 *   undercounted the first turn of every run by about 25%. That is the
 *   regression these tests exist for.
 * - `inputTokens` means the whole input side, cached tokens included. A
 *   provider that reports it some other way must not produce a negative charge.
 *
 * Rates are read off `PRICING` rather than written out, so a price change moves
 * the expectation with it and these stay tests of the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { PRICING, tokenCostMicroCents, totalTokens } from './pricing';

const MODEL = 'claude-sonnet-4-6';
const TIER = PRICING[MODEL]!;

describe('tokenCostMicroCents with a cache read', () => {
  it('charges the cached part at the discount and the rest at full rate', () => {
    // 1M input tokens of which 800k were served from cache.
    const cost = tokenCostMicroCents(MODEL, { inputTokens: 1_000_000, cacheReadTokens: 800_000 });

    expect(cost).toBe(200_000 * TIER.inputCentsPerMillion + 800_000 * TIER.cacheReadCentsPerMillion!);
  });

  it('makes a fully cached turn cost a tenth of an uncached one', () => {
    const uncached = tokenCostMicroCents(MODEL, { inputTokens: 1_000_000 });
    const cached = tokenCostMicroCents(MODEL, { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 });

    expect(cached * 10).toBe(uncached);
  });
});

describe('tokenCostMicroCents with a cache write', () => {
  it('charges a written prefix at 1.25x input, not at plain input', () => {
    const cost = tokenCostMicroCents(MODEL, { inputTokens: 1_000_000, cacheWriteTokens: 1_000_000 });

    expect(cost).toBe(1_000_000 * TIER.inputCentsPerMillion * 1.25);
  });

  it('costs more than the same turn with no cache write — the undercount this fixes', () => {
    const cold = tokenCostMicroCents(MODEL, { inputTokens: 1_000_000, cacheWriteTokens: 1_000_000 });
    const asPlainInput = tokenCostMicroCents(MODEL, { inputTokens: 1_000_000 });

    expect(cold).toBeGreaterThan(asPlainInput);
  });

  it('does not charge the written tokens twice', () => {
    // 1M in, 400k of it the prefix being written: 600k at full rate, 400k at
    // the write rate — not 1M at full rate plus 400k on top.
    const cost = tokenCostMicroCents(MODEL, { inputTokens: 1_000_000, cacheWriteTokens: 400_000 });

    expect(cost).toBe(600_000 * TIER.inputCentsPerMillion + 400_000 * TIER.inputCentsPerMillion * 1.25);
  });

  it('honours a tier that publishes its own cache-write rate', () => {
    const named = Object.entries(PRICING).find(([, tier]) => tier.cacheWriteCentsPerMillion !== undefined);
    if (!named) {
      // No model departs from the 1.25x default today. The branch is still
      // reachable, and the default above is what pins it.
      expect(named).toBeUndefined();

      return;
    }
    const [model, tier] = named;

    expect(tokenCostMicroCents(model, { inputTokens: 1_000, cacheWriteTokens: 1_000 }))
      .toBe(1_000 * tier.cacheWriteCentsPerMillion!);
  });
});

describe('tokenCostMicroCents on a realistic warm run', () => {
  it('prices the cold turn above the warm turns that read the same prefix back', () => {
    // The shape measured on Bedrock: a 3,163-token prefix written once, then
    // read back on every turn after.
    const cold = tokenCostMicroCents(MODEL, { inputTokens: 3_183, cacheWriteTokens: 3_163, outputTokens: 200 });
    const warm = tokenCostMicroCents(MODEL, { inputTokens: 3_184, cacheReadTokens: 3_163, outputTokens: 200 });

    expect(cold).toBeGreaterThan(warm);
    // And the warm turn is nowhere near the uncached price.
    expect(warm).toBeLessThan(tokenCostMicroCents(MODEL, { inputTokens: 3_184, outputTokens: 200 }));
  });
});

describe('tokenCostMicroCents when a provider reports the split oddly', () => {
  it('never charges a negative amount', () => {
    // A provider that reports `inputTokens` as the UNCACHED remainder — what
    // raw Converse does — would make the subtraction go past zero. The charge
    // clamps rather than crediting the account.
    const cost = tokenCostMicroCents(MODEL, { inputTokens: 20, cacheReadTokens: 3_163, cacheWriteTokens: 0 });

    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it('still costs 0 for a model that is not priced', () => {
    expect(tokenCostMicroCents('some-unlisted-model', { inputTokens: 1_000_000, cacheWriteTokens: 500_000 })).toBe(0);
  });
});

describe('totalTokens', () => {
  it('counts cached input once, because inputTokens already includes it', () => {
    // The token cap counts what the call carried, and a cached token is still
    // a token the model read. Adding the cache counts on top would double it.
    expect(totalTokens({ inputTokens: 1_000, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 100 })).toBe(1_100);
  });
});
