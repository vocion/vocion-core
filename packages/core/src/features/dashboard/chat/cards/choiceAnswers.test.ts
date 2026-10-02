import type { ChatMessage } from '../types';
import { describe, expect, it } from 'vitest';
import { refusalSentence, withCardAnswer, withRefusedAnswer, withServerCard } from './choiceAnswers';

const card = { id: 'card_c', kind: 'choice', actionId: '', input: {}, label: 'Q?', state: 'proposed' as const };
const rows: ChatMessage[] = [
  { role: 'assistant', content: '', recommendations: [card, { ...card, id: 'card_other' }] },
  { role: 'user', content: 'later' },
];

describe('the optimistic answer on a choice card', () => {
  it('marks only the answered card decided, in whichever earlier message holds it', () => {
    const out = withCardAnswer(rows, 'card_c', { optionId: 'B', text: 'Reports', at: '2026-10-02T10:00:00.000Z' });

    expect(out[0]!.recommendations![0]).toMatchObject({ state: 'decided', answer: { optionId: 'B', text: 'Reports' } });
    expect(out[0]!.recommendations![1]).toEqual({ ...card, id: 'card_other' });
  });

  it('a refusal takes the answer back off and keeps the server sentence on the card', () => {
    const answered = withCardAnswer(rows, 'card_c', { optionId: 'B', text: 'Reports', at: '2026-10-02T10:00:00.000Z' });
    const out = withRefusedAnswer(answered, 'card_c', 'That option does not exist.', 5);
    const rec = out[0]!.recommendations![0]!;

    expect(rec.answer).toBeUndefined();
    expect(rec.state).toBe('proposed');
    expect(rec.answerRefused).toEqual({ error: 'That option does not exist.', at: 5 });
  });
});

describe('the sentence shown when the server refuses an answer', () => {
  it('uses the server error when it sent one', () => {
    expect(refusalSentence(400, { error: 'Type your answer first.' })).toBe('Type your answer first.');
  });

  it('falls back to plain words when the body has no error', () => {
    expect(refusalSentence(404, null)).toBe('That question is no longer in this conversation.');
    expect(refusalSentence(400, {})).toBe('Couldn\'t send your answer. Try again.');
  });
});

describe('the transcript as the server holds it after a failed send', () => {
  it('reopens a card the server still has open, with a fresh refusal stamp', () => {
    const out = withServerCard(rows, 'card_c', 'Couldn\'t send your answer. Try again.', 9);

    expect(out[0]!.recommendations![0]).toMatchObject({ state: 'proposed', answerRefused: { at: 9 } });
  });

  it('leaves an answered card and a skipped card as the server has them', () => {
    const answered = { ...card, state: 'decided' as const, answer: { optionId: 'A', text: 'Reports', at: 'x' } };
    const skipped = { ...card, state: 'deferred' as const };
    const out = withServerCard([{ role: 'assistant', content: '', recommendations: [answered] }], 'card_c', 's', 1);
    const out2 = withServerCard([{ role: 'assistant', content: '', recommendations: [skipped] }], 'card_c', 's', 1);

    expect(out[0]!.recommendations![0]).toEqual(answered);
    expect(out2[0]!.recommendations![0]).toEqual(skipped);
  });
});
