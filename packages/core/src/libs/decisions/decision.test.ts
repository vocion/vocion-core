/**
 * A Decision is the ask, read as one shape. Fixtures are fictional
 * (Northwind, Kestrel Capital).
 */
import type { AskLike } from './decision';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DECIDER } from '@/libs/needsYou/deadlines';
import { answerLine, answerProblem, decisionAnswerWire, decisionForModel, decisionKindOf, decisionOptionsOf, decisionStateOf, decisionViewOf, readDecisionAnswerWire } from './decision';

const repo: AskLike = {
  id: 41,
  kind: 'ruling',
  title: 'Which repo should the factory build in?',
  body: 'Two repos match "Northwind".',
  options: [
    { id: 'portal', label: 'Northwind Portal', description: 'Builds land in the customer portal.' },
    { id: 'api', label: 'Northwind API', description: 'Builds land in the API; CI runs on every push.', recommended: true, action: { id: 'objects.update_meta', input: { objectId: 7 } } },
  ],
  status: 'open',
  agentSlug: 'product-manager',
  ownerUserId: 'usr-dana',
  conversationId: 392,
  allowOther: true,
  multiSelect: false,
  createdAt: new Date('2026-10-08T12:00:00Z'),
};

describe('a Decision read off an ask', () => {
  it('maps the ask\'s kinds onto the five Decision kinds, without a vocabulary of its own', () => {
    expect(decisionKindOf('input')).toBe('question');
    expect(decisionKindOf('credential')).toBe('question');
    expect(decisionKindOf('ruling')).toBe('choice');
    expect(decisionKindOf('recommendation')).toBe('choice');
    expect(decisionKindOf('approval')).toBe('approval');
    expect(decisionKindOf('merge')).toBe('approval');
    expect(decisionKindOf('gate')).toBe('approval');
    expect(decisionKindOf('signoff')).toBe('signoff');
    expect(decisionKindOf('setup')).toBe('setup');
  });

  it('draws the recommended option first, with its consequence and whether it runs an effect', () => {
    expect(decisionOptionsOf(repo)).toEqual([
      { id: 'api', label: 'Northwind API', consequence: 'Builds land in the API; CI runs on every push.', recommended: true, hasEffect: true },
      { id: 'portal', label: 'Northwind Portal', consequence: 'Builds land in the customer portal.' },
    ]);
  });

  it('answers an approval that named no options with Approve or Reject, and a question with words only', () => {
    expect(decisionOptionsOf({ kind: 'approval', options: [] }).map(o => o.id)).toEqual(['approve', 'reject']);
    expect(decisionOptionsOf({ kind: 'input', options: [] })).toEqual([]);
    expect(decisionViewOf({ ...repo, kind: 'input', options: [], allowOther: false }).allowOther).toBe(true);
  });

  it('reads the state off the row: open, answered, skipped, defaulted, withdrawn, expired, undone', () => {
    expect(decisionStateOf({ status: 'open' })).toBe('open');
    expect(decisionStateOf({ status: 'open' }, { clockHeld: true })).toBe('expired');
    expect(decisionStateOf({ status: 'done', decidedBy: 'usr-dana' })).toBe('answered');
    expect(decisionStateOf({ status: 'approved', decidedBy: DEFAULT_DECIDER })).toBe('defaulted');
    expect(decisionStateOf({ status: 'skipped', decidedBy: 'usr-dana' })).toBe('skipped');
    expect(decisionStateOf({ status: 'superseded' })).toBe('withdrawn');
    expect(decisionStateOf({ status: 'done', decidedBy: 'usr-dana' }, { effectUndone: true })).toBe('undone');
  });

  it('carries what was answered, by option id and label, every option chosen', () => {
    const view = decisionViewOf({ ...repo, multiSelect: true, status: 'done', decision: 'api', chosenOptionIds: ['api', 'portal'], decidedBy: 'usr-dana', decidedAt: new Date('2026-10-08T12:05:00Z'), decidedVia: 'card' });

    expect(view.state).toBe('answered');
    expect(view.answer).toEqual({ kind: 'option', optionIds: ['api', 'portal'], labels: ['Northwind API', 'Northwind Portal'], freeText: null, by: 'usr-dana', at: '2026-10-08T12:05:00.000Z', via: 'card' });
  });

  it('reads an "other" answer as their own words', () => {
    const view = decisionViewOf({ ...repo, status: 'done', decision: 'other', decisionNote: 'Neither — Kestrel Capital\'s fork', decidedBy: 'usr-dana', decidedVia: 'composer' });

    expect(view.answer).toMatchObject({ kind: 'free_text', freeText: 'Neither — Kestrel Capital\'s fork', via: 'composer' });
  });
});

describe('what an answer may be', () => {
  const view = decisionViewOf(repo);

  it('takes one known option, a non-empty answer in words where words are offered, or a skip', () => {
    expect(answerProblem(view, { kind: 'option', optionIds: ['api'] })).toBeNull();
    expect(answerProblem(view, { kind: 'free_text', text: 'use the fork' })).toBeNull();
    expect(answerProblem(view, { kind: 'skip' })).toBeNull();
  });

  it('refuses two options on a Decision that takes one, an unknown option, empty words, and words where only options are offered', () => {
    expect(answerProblem(view, { kind: 'option', optionIds: ['api', 'portal'] })).toBe('this decision takes one option');
    expect(answerProblem(view, { kind: 'option', optionIds: ['gateway'] })).toBe('no such option: gateway');
    expect(answerProblem(view, { kind: 'free_text', text: '  ' })).toMatch(/cannot be empty/);
    expect(answerProblem({ ...view, allowOther: false }, { kind: 'free_text', text: 'x' })).toMatch(/takes one of its options/);
  });

  it('refuses any answer to a Decision already decided', () => {
    expect(answerProblem({ ...view, state: 'answered' }, { kind: 'option', optionIds: ['api'] })).toBe('it was already decided');
  });

  it('takes several options where several may be chosen', () => {
    expect(answerProblem({ ...view, multiple: true }, { kind: 'option', optionIds: ['api', 'portal'] })).toBeNull();
    expect(answerProblem({ ...view, multiple: true }, { kind: 'option', optionIds: ['api', 'api'] })).toMatch(/twice/);
  });
});

describe('the answer on the wire and to the agent', () => {
  it('reads exactly one of options, words or skip — and nothing else', () => {
    expect(readDecisionAnswerWire({ id: 41, option_ids: ['api'] })).toEqual({ id: 41, answer: { kind: 'option', optionIds: ['api'] } });
    expect(readDecisionAnswerWire({ id: 41, free_text: ' the fork ' })).toEqual({ id: 41, answer: { kind: 'free_text', text: 'the fork' } });
    expect(readDecisionAnswerWire({ id: 41, skip: true })).toEqual({ id: 41, answer: { kind: 'skip' } });
    expect(readDecisionAnswerWire({ id: 41 })).toBeNull();
    expect(readDecisionAnswerWire({ id: 41, skip: true, option_ids: ['api'] })).toBeNull();
    expect(readDecisionAnswerWire({ id: -1, skip: true })).toBeNull();
    expect(readDecisionAnswerWire('approve')).toBeNull();
  });

  it('round-trips through the wire shape the client sends', () => {
    for (const answer of [{ kind: 'option' as const, optionIds: ['api'] }, { kind: 'free_text' as const, text: 'the fork' }, { kind: 'skip' as const }]) {
      expect(readDecisionAnswerWire(decisionAnswerWire(41, answer))).toEqual({ id: 41, answer });
    }
  });

  it('is told to the asking agent as the record of what was chosen, by id — never as their words', () => {
    const view = decisionViewOf(repo);
    const told = decisionForModel(view, { kind: 'option', optionIds: ['api'] });

    expect(told).toContain('[decision #41 answered] Which repo should the factory build in?');
    expect(told).toContain('Chosen: Northwind API (option api) — its action ran as theirs');
    expect(told).toContain('do not ask it again');
    expect(decisionForModel(view, { kind: 'skip' })).toContain('Skipped: the person chose not to answer');
    expect(decisionForModel(view, { kind: 'free_text', text: 'the fork' })).toContain('Answered in their own words: the fork');
  });

  it('says the answer in one line for the transcript\'s receipt', () => {
    const view = decisionViewOf(repo);

    expect(answerLine(view, { kind: 'option', optionIds: ['api', 'portal'] })).toBe('Northwind API, Northwind Portal');
    expect(answerLine(view, { kind: 'skip' })).toBe('Skipped');
  });
});
