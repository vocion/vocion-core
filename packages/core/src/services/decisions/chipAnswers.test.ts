/**
 * A chip that answers an open card decides it: the turn binds each chip that
 * answers the agent's one open Decision to its option, in code.
 */
import type { DecisionView } from '@/libs/decisions/decision';
import { describe, expect, it, vi } from 'vitest';
import { bindChipsToOpenDecision, chipDecisionOf, optionNamedBy } from './chipAnswers';

const plan: DecisionView = {
  id: 371,
  kind: 'signoff',
  question: 'Sign off the keyword plan: Northwind trail shoes',
  options: [{ id: 'approve', label: 'Approve', recommended: true }, { id: 'reject', label: 'Discard' }],
  allowOther: true,
  multiple: false,
  state: 'open',
  agentSlug: 'seo-strategist',
  ownerUserId: 'usr-mara',
  conversationId: 9101,
};
const turn = { orgId: 'org', conversationId: 9101, userId: 'usr-mara', agentSlug: 'seo-strategist' };
const chip = (label: string) => ({ label, prompt: label });

describe('a chip that answers an open card', () => {
  it('is the option it names, by label or id, case aside', () => {
    expect(optionNamedBy(chip('approve'), plan)).toBe('approve');
    expect(optionNamedBy(chip(' Discard '), plan)).toBe('reject');
    expect(optionNamedBy(chip('Show the keyword map'), plan)).toBeNull();
  });

  it('binds only to the agent\'s own one open Decision with options', () => {
    expect(chipDecisionOf([plan], 'seo-strategist')).toBe(plan);
    expect(chipDecisionOf([plan], 'seo-writer')).toBeNull();
    expect(chipDecisionOf([plan, { ...plan, id: 372 }], 'seo-strategist')).toBeNull();
    expect(chipDecisionOf([{ ...plan, subject: 'proposal' }], 'seo-strategist')).toBeNull();
    expect(chipDecisionOf([{ ...plan, options: [] }], 'seo-strategist')).toBeNull();
  });

  it('"Approve the plan" is read against the card and bound to Approve; other chips stay words (2026-10-29)', async () => {
    const read = vi.fn(async ({ message }: { message: string }) => (message === 'Approve the plan'
      ? { kind: 'option' as const, option_ids: ['approve'], free_text: null }
      : { kind: 'none' as const, option_ids: [], free_text: null }));

    const out = await bindChipsToOpenDecision(turn, [chip('Approve the plan'), chip('Show the keyword map'), chip('Discard')], { open: async () => [plan], read });

    expect(out).toEqual([
      { ...chip('Approve the plan'), answers: { id: 371, optionId: 'approve' } },
      chip('Show the keyword map'),
      { ...chip('Discard'), answers: { id: 371, optionId: 'reject' } },
    ]);
    // An option's own label needs no model.
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('binds nothing with no person, no conversation, nothing open, or when the read fails', async () => {
    const read = vi.fn(async () => {
      throw new Error('judge down');
    });
    const items = [chip('Approve the plan')];

    expect(await bindChipsToOpenDecision({ ...turn, userId: null }, items, { open: async () => [plan], read })).toEqual(items);
    expect(await bindChipsToOpenDecision({ ...turn, conversationId: null }, items, { open: async () => [plan], read })).toEqual(items);
    expect(await bindChipsToOpenDecision(turn, items, { open: async () => [], read })).toEqual(items);
    expect(await bindChipsToOpenDecision(turn, items, { open: async () => [plan], read })).toEqual(items);
  });

  it('a free-text reading is not an option: the chip stays words', async () => {
    const read = vi.fn(async () => ({ kind: 'free_text' as const, option_ids: [], free_text: 'add Brookfield' }));

    expect(await bindChipsToOpenDecision(turn, [chip('Add a Brookfield page')], { open: async () => [plan], read })).toEqual([chip('Add a Brookfield page')]);
  });
});
