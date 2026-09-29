import { describe, expect, it } from 'vitest';
import { quoteThenAsk } from './useChatSession';
import { splitQuote } from './UserMessage';

describe('a highlighted passage is part of the turn', () => {
  it('opens the turn as a quote, and is the whole turn when nothing was typed', () => {
    expect(quoteThenAsk('Blocked: plan 136\nis in review', 'tell me?')).toBe('> Blocked: plan 136\n> is in review\n\ntell me?');
    expect(quoteThenAsk('Blocked: plan 136', '')).toBe('> Blocked: plan 136');
  });

  it('the bubble shows the quote above what was asked', () => {
    expect(splitQuote('> Blocked: plan 136\n> is in review\n\ntell me?')).toEqual({ quote: 'Blocked: plan 136\nis in review', body: 'tell me?' });
    expect(splitQuote('no quote here')).toEqual({ quote: null, body: 'no quote here' });
  });
});
