import { describe, expect, it } from 'vitest';
import { claimsSave, turnSignals } from './turnSignals';

const available = ['recommend_action', 'propose_action', 'remember_preference', 'hubspot_list_deals'];

describe('a turn\'s signals', () => {
  it('flags three failed calls in one turn, and not two', () => {
    const fail = { tool: 'render_chart', error: true };

    expect(turnSignals({ answer: 'Here it is.', calls: [fail, fail, fail, { tool: 'render_chart', error: false }], available }).flags).toEqual(['toolFailures']);
    expect(turnSignals({ answer: 'Here it is.', calls: [fail, fail], available }).flags).toEqual([]);
  });

  it('flags a refusal while the action path was there, and not when it was taken or absent', () => {
    const answer = 'I don\'t have a tool available to update HubSpot deals.';

    expect(turnSignals({ answer, calls: [], available }).flags).toEqual(['refusedWithAction']);
    expect(turnSignals({ answer, calls: [{ tool: 'recommend_action', error: false }], available }).flags).toEqual([]);
    expect(turnSignals({ answer, calls: [], available: ['hubspot_list_deals'] }).flags).toEqual([]);
  });

  it('reads a caveat inside a yes as no refusal', () => {
    const answer = 'Yes, I can update deal fields. I can\'t invent values on my own, and I can\'t tell whether the list is capped.';

    expect(turnSignals({ answer, calls: [], available }).flags).toEqual([]);
    expect(turnSignals({ answer: 'I cannot execute the CRM update directly.', calls: [], available }).flags).toEqual(['refusedWithAction']);
  });

  it('counts "I can\'t save that" as a refusal, not a made-up save', () => {
    const answer = 'Understood. I\'ll use that from here on, but I can\'t save it for later conversations.';

    expect(turnSignals({ answer, calls: [], available }).flags).toEqual(['refusedWithAction']);
  });

  it('flags a claimed save with no call that saves', () => {
    expect(turnSignals({ answer: 'Noted, Monday mornings it is.', calls: [], available }).flags).toEqual(['claimedSave']);
    expect(turnSignals({ answer: 'Noted, Monday mornings it is.', calls: [{ tool: 'remember_preference', error: false }], available }).flags).toEqual([]);
  });

  it.each([
    'Noted.',
    'Got it, I\'ll remember that for next time.',
    'I\'ve saved that preference.',
    'I\'ll keep that in mind.',
    'I will remember that your fiscal year starts in February.',
    'Understood. From here on I\'ll use tables rather than bullet lists.',
    'I\'ll use tables rather than bullet lists from now on.',
  ])('reads "%s" as a claimed save', (answer) => {
    expect(claimsSave(answer)).toBe(true);
  });

  it.each([
    'Here is the chart of pipeline by stage.',
    'Should I remember this as a standing preference?',
    'The deal is annotated in HubSpot.',
    'From now on, deals over $50k need a second approver.',
  ])('does not read "%s" as one', (answer) => {
    expect(claimsSave(answer)).toBe(false);
  });
});
