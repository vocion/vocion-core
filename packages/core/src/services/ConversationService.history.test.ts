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

  it('drops every ending with no real answer in it — broken, never started, or declined', () => {
    const turns = toHistoryTurns([
      { role: 'user', content: 'how many deals closed?' },
      { role: 'assistant', content: 'Four deals closed last month, worth', status: 'incomplete' },
      { role: 'assistant', content: '', status: 'failed' },
      { role: 'assistant', content: 'Budget exceeded for "revenue-lead"', status: 'refused' },
    ]);

    expect(turns.map(t => t.content)).toEqual(['how many deals closed?']);
  });

  it('keeps a turn the person stopped: they read it and decided that was enough', () => {
    const turns = toHistoryTurns([
      { role: 'user', content: 'summarise the account' },
      { role: 'assistant', content: 'Northwind renews in March and', status: 'stopped' },
    ]);

    expect(turns.map(t => t.content)).toEqual(['summarise the account', 'Northwind renews in March and']);
  });

  it('keeps both halves of an answer a surface split in two, because together they are the whole thing', () => {
    const turns = toHistoryTurns([
      { role: 'assistant', content: 'The pipeline stands at', status: 'truncated' },
      { role: 'assistant', content: '$1.4M across eleven deals.', status: 'continued' },
    ]);

    expect(turns.map(t => t.content)).toEqual(['The pipeline stands at', '$1.4M across eleven deals.']);
  });

  it('keeps a row whose status nobody here recognises, rather than silently erasing a real answer', () => {
    const turns = toHistoryTurns([
      { role: 'assistant', content: 'Four closed last month.', status: 'something-new' },
    ]);

    expect(turns.map(t => t.content)).toEqual(['Four closed last month.']);
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

describe('toHistoryTurns carries the runs', () => {
  it('hands an agent turn\'s runs_json and id through, so the loop can replay its calls', () => {
    const turns = toHistoryTurns([
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', content: 'Filed.', runsJson: [{ type: 'tool', name: 'lookup_objects', input: {} }] },
    ]);

    expect(turns).toEqual([
      { role: 'user', content: 'hi', id: 'u1' },
      { role: 'assistant', content: 'Filed.', id: 'a1', runs: [{ type: 'tool', name: 'lookup_objects', input: {} }] },
    ]);
  });
});
