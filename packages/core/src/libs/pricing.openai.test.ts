/**
 * What the GPT-6 / GPT-5.6 generation and the Claude 5 generation cost.
 *
 * The model-upgrade test (`services/evals/modelUpgradeTest.ts`) answers "does
 * the new model lower the cost per completed job even though its price per
 * token is higher?" — and that question is only answerable when both sides
 * of the comparison are priced. An unpriced model costs 0, which would make
 * any candidate look free. These tests pin that the four OpenAI ids added on
 * 2026-09-15 price at the list rates they were entered from, that cached
 * input is billed below the full input rate, and that the rows agree with
 * the per-token ordering on OpenAI's page (Astra > Sol > Terra > Luna).
 *
 * Kept in its own file rather than `pricing.test.ts` because PR #317 creates
 * that file for the Bedrock canonicaliser; the two must merge cleanly.
 */
import { describe, expect, it } from 'vitest';
import { knownModels, tokenCostCents } from './pricing';

const ONE_M_INPUT = { inputTokens: 1_000_000 };
const ONE_M_OUTPUT = { outputTokens: 1_000_000 };

describe('GPT-6 / GPT-5.6 and Claude 5 pricing', () => {
  it('prices the four ids at the list rates they were entered from (cents per 1M)', () => {
    expect(tokenCostCents('gpt-6-astra', ONE_M_INPUT)).toBe(1000);
    expect(tokenCostCents('gpt-6-astra', ONE_M_OUTPUT)).toBe(5000);
    expect(tokenCostCents('gpt-5.6-sol', ONE_M_INPUT)).toBe(400);
    expect(tokenCostCents('gpt-5.6-sol', ONE_M_OUTPUT)).toBe(2000);
    expect(tokenCostCents('gpt-5.6-terra', ONE_M_INPUT)).toBe(200);
    expect(tokenCostCents('gpt-5.6-terra', ONE_M_OUTPUT)).toBe(1200);
    expect(tokenCostCents('gpt-5.6-luna', ONE_M_INPUT)).toBe(20);
    expect(tokenCostCents('gpt-5.6-luna', ONE_M_OUTPUT)).toBe(120);
  });

  it('bills cached input at the cached rate, one tenth of the full input rate', () => {
    // A fully cached million costs the cached rate alone: the full-rate
    // input is `inputTokens - cacheReadTokens` = 0.
    expect(tokenCostCents('gpt-6-astra', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 })).toBe(100);
    expect(tokenCostCents('gpt-5.6-sol', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 })).toBe(40);
  });

  it('keeps the per-token ordering of the pricing page', () => {
    const perM = (m: string) => tokenCostCents(m, ONE_M_INPUT) + tokenCostCents(m, ONE_M_OUTPUT);

    expect(perM('gpt-6-astra')).toBeGreaterThan(perM('gpt-5.6-sol'));
    expect(perM('gpt-5.6-sol')).toBeGreaterThan(perM('gpt-5.6-terra'));
    expect(perM('gpt-5.6-terra')).toBeGreaterThan(perM('gpt-5.6-luna'));
  });

  it('leaves gpt-5.4-mini unpriced on purpose — no guessed price', () => {
    expect(knownModels()).not.toContain('gpt-5.4-mini');
    expect(tokenCostCents('gpt-5.4-mini', ONE_M_INPUT)).toBe(0);
  });

  it('prices the Claude 5 generation the workforce runs on, instead of 0', () => {
    // cycles.jsonl `by_model` names exactly these ids; an unpriced model here
    // meant a $0 board cycle in every budget row.
    expect(tokenCostCents('claude-fable-5-1', ONE_M_INPUT)).toBe(1000);
    expect(tokenCostCents('claude-fable-5-1', ONE_M_OUTPUT)).toBe(5000);
    expect(tokenCostCents('claude-fable-5-1', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 })).toBe(25);
    expect(tokenCostCents('claude-fable-5', ONE_M_INPUT)).toBe(1000);
    expect(tokenCostCents('claude-opus-5', ONE_M_INPUT)).toBe(500);
    expect(tokenCostCents('claude-opus-5', ONE_M_OUTPUT)).toBe(2500);
    expect(tokenCostCents('claude-opus-4-8', ONE_M_INPUT)).toBe(500);
    expect(tokenCostCents('claude-sonnet-5', ONE_M_INPUT)).toBe(200);
    expect(tokenCostCents('claude-sonnet-5', ONE_M_OUTPUT)).toBe(1000);
    // The undated Haiku alias prices exactly like the dated row.
    expect(tokenCostCents('claude-haiku-4-5', ONE_M_INPUT)).toBe(tokenCostCents('claude-haiku-4-5-20251001', ONE_M_INPUT));
    expect(tokenCostCents('claude-haiku-4-5', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 })).toBe(10);
  });

  it('registers the four ids with knownModels() so the Langfuse bootstrap sees them', () => {
    const known = knownModels();
    for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(known).toContain(id);
    }
  });
});
