import { describe, expect, it } from 'vitest';
import { toHistoryTurns } from './ConversationService';

const LA = 'America/Los_Angeles';

describe('toHistoryTurns', () => {
  const messages = [
    { role: 'user', content: 'what is on today?', createdAt: new Date('2026-09-17T16:05:00Z') },
    { role: 'assistant', content: 'Three calls.', createdAt: new Date('2026-09-17T16:05:20Z') },
    { role: 'tool', content: '{"raw":true}', createdAt: new Date('2026-09-17T16:05:10Z') },
    { role: 'user', content: 'and tomorrow?', createdAt: new Date('2026-09-17T16:06:00Z') },
    { role: 'user', content: 'what is up', createdAt: new Date('2026-09-18T14:20:00Z') },
  ];

  it('stamps the first turn and any turn after a long silence with when it was sent, in the person\'s zone', () => {
    const turns = toHistoryTurns(messages, { timeZone: LA });

    expect(turns.map(t => t.content)).toEqual([
      '[sent Thu, Sep 17, 2026, 9:05 AM PDT] what is on today?',
      'Three calls.',
      'and tomorrow?',
      '[sent Fri, Sep 18, 2026, 7:20 AM PDT] what is up',
    ]);
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'user', 'user']);
  });

  it('drops a turn that died part-way, so a cut-off sentence is never replayed as something the agent said', () => {
    const turns = toHistoryTurns([
      { role: 'user', content: 'how many deals closed?' },
      { role: 'assistant', content: 'Four closed last month, worth', status: 'incomplete' },
      { role: 'user', content: 'well?' },
    ]);

    expect(turns).toEqual([
      { role: 'user', content: 'how many deals closed?' },
      { role: 'user', content: 'well?' },
    ]);
  });

  it('keeps an assistant turn that finished, whether it says so or says nothing', () => {
    const turns = toHistoryTurns([
      { role: 'assistant', content: 'Four closed last month.', status: null },
      { role: 'assistant', content: 'Three are in proposal.' },
    ]);

    expect(turns.map(t => t.content)).toEqual(['Four closed last month.', 'Three are in proposal.']);
  });

  it('is the bare role and content it always was when no zone is given, and drops tool rows and blanks', () => {
    expect(toHistoryTurns([...messages, { role: 'user', content: '   ' }])).toEqual([
      { role: 'user', content: 'what is on today?' },
      { role: 'assistant', content: 'Three calls.' },
      { role: 'user', content: 'and tomorrow?' },
      { role: 'user', content: 'what is up' },
    ]);
  });
});
