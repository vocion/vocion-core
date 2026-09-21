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
import { knownModels, tokenCostCents } from './pricing';

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

describe('the Langfuse bootstrap', () => {
  it('sees the new ids, so traces price the same way budgets do', () => {
    const known = knownModels();
    for (const id of ['text-embedding-3-small', 'text-embedding-3-large', 'gpt-image-1']) {
      expect(known).toContain(id);
    }
  });
});
