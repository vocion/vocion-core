/**
 * What an embedding and a generated image cost.
 *
 * Both were missing from the price list until #279, which mattered twice over:
 * an unpriced model costs 0, so charging these calls would have recorded
 * tokens and no money — a budget page that says $0.00 next to a four-figure
 * vendor bill is worse than one that says nothing.
 *
 * Figures are OpenAI's list prices, read from
 * developers.openai.com/api/docs/pricing on 2026-09-21. These tests exist to
 * catch a typo in a zero, which is the failure nobody notices: the number is
 * plausible either way and only the bill disagrees.
 */
import { describe, expect, it } from 'vitest';
import { knownModels, tokenCostCents, tokenCostMicroCents } from './pricing';

const ONE_M_INPUT = { inputTokens: 1_000_000 };
const ONE_M_OUTPUT = { outputTokens: 1_000_000 };

describe('embedding pricing', () => {
  it('prices the two OpenAI embedding models at their list rates (cents per 1M)', () => {
    expect(tokenCostCents('text-embedding-3-small', ONE_M_INPUT)).toBe(2);
    expect(tokenCostCents('text-embedding-3-large', ONE_M_INPUT)).toBe(13);
  });

  it('charges nothing for output, because an embedding returns no completion', () => {
    expect(tokenCostCents('text-embedding-3-small', ONE_M_OUTPUT)).toBe(0);
    expect(tokenCostCents('text-embedding-3-large', ONE_M_OUTPUT)).toBe(0);
  });

  it('prices a realistic sync at a realistic number rather than a round-up', () => {
    // 20,000 chunks of roughly 500 tokens each — a mid-sized document library.
    // Under a cent per batch, and the whole sync is 20 cents. The bug this
    // guards against charged a cent per batch and reported $2.00.
    expect(tokenCostCents('text-embedding-3-small', { inputTokens: 10_000_000 })).toBe(20);
  });

  it('leaves the Bedrock embedding default unpriced rather than guessing at it', () => {
    // Deliberate, and documented in pricing.ts: AWS's figure was not readable
    // off one page on 2026-09-21. Tokens are still recorded, so a token cap
    // works; a cents cap visibly does not, which is the honest state.
    expect(tokenCostCents('amazon.titan-embed-text-v1', ONE_M_INPUT)).toBe(0);
  });
});

describe('image pricing', () => {
  it('prices gpt-image-1 per token, at its text-input and output rates', () => {
    expect(tokenCostCents('gpt-image-1', ONE_M_INPUT)).toBe(500);
    expect(tokenCostCents('gpt-image-1', ONE_M_OUTPUT)).toBe(4000);
  });

  it('costs a multiple of an ordinary completion, which is why a cap may refuse it', () => {
    const image = tokenCostCents('gpt-image-1', ONE_M_OUTPUT);
    const haiku = tokenCostCents('claude-haiku-4-5-20251001', ONE_M_OUTPUT);

    expect(image).toBeGreaterThan(haiku * 5);
  });
});

describe('exact arithmetic', () => {
  it('costs a batch in whole micro-cents, with no floating-point residue', () => {
    // A rate is cents per 1M tokens and a micro-cent is a cent over 1M, so the
    // cost of n tokens is n * rate exactly. The budget adds one of these up per
    // embedding batch for a whole period, and a float division by 1e6 would put
    // an unrepresentable value into every one of them.
    const microCents = tokenCostMicroCents('text-embedding-3-small', { inputTokens: 50_000 });

    expect(microCents).toBe(100_000);
    expect(Number.isInteger(microCents)).toBe(true);
  });

  it('is exact for a token count that has no exact answer in cents', () => {
    // 3 tokens at 2 cents/1M is 0.000006 cents — a number float64 cannot hold.
    // In micro-cents it is the integer 6.
    expect(tokenCostMicroCents('text-embedding-3-small', { inputTokens: 3 })).toBe(6);
  });

  it('agrees with the cents reading it is derived from', () => {
    const usage = { inputTokens: 1_234_567, outputTokens: 7_654, cacheReadTokens: 200_000 };

    expect(tokenCostCents('claude-haiku-4-5-20251001', usage))
      .toBe(tokenCostMicroCents('claude-haiku-4-5-20251001', usage) / 1_000_000);
  });

  it('costs an unpriced model nothing in either unit', () => {
    expect(tokenCostMicroCents('amazon.titan-embed-text-v1', ONE_M_INPUT)).toBe(0);
    expect(tokenCostCents('amazon.titan-embed-text-v1', ONE_M_INPUT)).toBe(0);
  });
});

describe('the Langfuse bootstrap', () => {
  it('sees the new ids, so traces price the same way budgets do', () => {
    const known = knownModels();
    for (const id of ['text-embedding-3-small', 'text-embedding-3-large', 'gpt-image-1']) {
      expect(known).toContain(id);
    }
  });
});

describe('accumulating over many calls', () => {
  /**
   * The rule the budget counter and `runAgentDeep`'s per-run total both rely
   * on: a long period is thousands of small charges, and adding them up as
   * cents drifts because most of those fractions are not values a
   * floating-point number holds exactly. Adding whole micro-cents cannot.
   */
  it('is exact over ten thousand batches, where summing cents is not', () => {
    const usage = { inputTokens: 12_345, outputTokens: 0 };
    const batches = 10_000;

    let microCents = 0;
    let cents = 0;
    for (let batch = 0; batch < batches; batch++) {
      microCents += tokenCostMicroCents('text-embedding-3-small', usage);
      cents += tokenCostCents('text-embedding-3-small', usage);
    }

    // 12,345 tokens x 2 cents per million = 24,690 micro-cents a batch.
    expect(microCents).toBe(246_900_000);
    expect(microCents / 1_000_000).toBe(246.9);
    // The same sum taken in cents lands near it, but not on it.
    expect(cents).not.toBe(246.9);
    expect(Math.abs(cents - 246.9)).toBeLessThan(0.000_001);
  });
});
