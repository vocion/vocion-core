import { describe, expect, it } from 'vitest';
import { flatHistory, historyMessages, toolsMarker } from './historyTools';

describe('toolsMarker', () => {
  it('says which tools a past turn ran and what came back', () => {
    const runs = [
      { type: 'text', text: 'I\'ll pull the records.' },
      { type: 'tool', name: 'lookup_objects', input: { type_slug: 'request', limit: 25 }, output: '[{"id":41},{"id":42},{"id":43}]' },
      { type: 'tool', name: 'read_object', input: { id: 121 }, output: 'title: add send/share…' },
      { type: 'tool', name: 'search_knowledge', input: { query: 'mobile upload fails on cellular' }, output: '[1] **squatch-core#23**\n[2] **squatch-core#7**' },
    ];

    expect(toolsMarker(runs)).toBe('\n\n[Earlier in this turn you ran: lookup_objects{type_slug: request, limit: 25} → 3 rows; read_object{id: 121} → 22 chars; search_knowledge{query: mobile upload fails on cellular} → 2 results]');
  });

  it('is nothing for a turn that ran no tool, and never longer than a line', () => {
    expect(toolsMarker([{ type: 'text', text: 'Yes.' }])).toBe('');
    expect(toolsMarker(null)).toBe('');

    const many = Array.from({ length: 40 }, (_, i) => ({ type: 'tool', name: `tool_${i}`, input: { q: 'x'.repeat(40) }, output: 'y'.repeat(100) }));

    expect(toolsMarker(many).length).toBeLessThanOrEqual(602);
    expect(toolsMarker(many).endsWith('…]')).toBe(true);
  });

  it('names the cards a turn put up, with the payload\'s title and the proposal id, so "approve" binds to them', () => {
    const runs = [
      { type: 'text', text: 'Seven customers lost files. Filing it now.' },
      { type: 'tool', name: 'lookup_objects', input: { type_slug: 'request' }, output: '[]' },
      { type: 'card', label: 'File this as a request', actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'Uploads drop on cellular and the file is gone' }, runId: 3691 },
    ];

    expect(toolsMarker(runs)).toBe('\n\n[Earlier in this turn you ran: lookup_objects{type_slug: request} → 0 rows. And you put up a card: "File this as a request" → objects.propose_candidate "Uploads drop on cellular and the file is gone" (proposal #3691). "Approve", "go", "file it" or "go ahead" means THAT card when it is still waiting — decide it or make its call, never a different record; a card that ran is done]');
    expect(toolsMarker([{ type: 'card', label: 'Roll back 912e4be0', actionId: 'deploy.release' }])).toContain('you put up a card: "Roll back 912e4be0" → deploy.release.');
  });
});

describe('historyMessages', () => {
  it('replays a turn as the calls it made, each result, then the answer', () => {
    const turn = {
      id: 'm42',
      role: 'assistant' as const,
      content: 'Seven customers lost files. Filing it now.',
      runs: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool', name: 'lookup_objects', input: { type_slug: 'request' }, output: '[]' },
        { type: 'tool', name: 'read_file', input: {}, output: 'read_file needs a path', state: 'error' },
        { type: 'card', label: 'File this as a request', actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'Uploads drop on cellular' }, runId: 3691 },
      ],
    };

    const out = historyMessages(turn);

    expect(out.map(m => m.role)).toEqual(['assistant', 'tool', 'tool', 'tool', 'assistant']);
    expect(out[0]).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'hist_m42_1', name: 'lookup_objects', args: { type_slug: 'request' } },
        { id: 'hist_m42_2', name: 'read_file', args: {} },
        { id: 'hist_m42_3', name: 'recommend_action', args: { label: 'File this as a request', action_id: 'objects.propose_candidate', objectType: 'request', title: 'Uploads drop on cellular' } },
      ],
    });
    expect(out[1]).toEqual({ role: 'tool', toolCallId: 'hist_m42_1', name: 'lookup_objects', content: '[]' });
    expect(out[2]).toMatchObject({ toolCallId: 'hist_m42_2', content: 'Error: read_file needs a path' });
    expect(out[3]).toMatchObject({ toolCallId: 'hist_m42_3', name: 'recommend_action' });
    expect((out[3] as { content: string }).content).toContain('proposal #3691');
    expect((out[3] as { content: string }).content).toContain('decide_proposal 3691');
    expect(out[4]).toEqual({ role: 'assistant', content: 'Seven customers lost files. Filing it now.', toolCalls: [] });
  });

  it('is one plain message for a turn that ran nothing, and caps a long result', () => {
    expect(historyMessages({ role: 'assistant', content: 'Yes.', runs: [{ type: 'text', text: 'Yes.' }] })).toEqual([{ role: 'assistant', content: 'Yes.', toolCalls: [] }]);

    const long = historyMessages({ role: 'assistant', content: 'Done.', runs: [{ type: 'tool', name: 't', input: {}, output: 'x'.repeat(5000) }] });

    expect((long[1] as { content: string }).content.startsWith(`${'x'.repeat(1199)}…`)).toBe(true);
  });

  it('says a cut replay is a cut, never an absence', () => {
    // Conversation 364 (2026-09-29): request #224's read was 3,452 characters,
    // its history began at 1,225, and the next turn — seeing only 1,200 —
    // said the gate that had fired twice "wasn't in the record".
    const cut = historyMessages({ role: 'assistant', content: 'Done.', runs: [{ type: 'tool', name: 'read_object', input: { id: 224 }, output: 'x'.repeat(3452) }] });
    const content = (cut[1] as { content: string }).content;

    expect(content).toContain('[cut on replay:');
    expect(content).toContain('Read it again before saying it is not there.');

    const whole = historyMessages({ role: 'assistant', content: 'Done.', runs: [{ type: 'tool', name: 'read_object', input: { id: 224 }, output: 'short' }] });

    expect((whole[1] as { content: string }).content).toBe('short');
  });

  it('flattens to the one-line marker for the loops that take text only', () => {
    const flat = flatHistory([
      { role: 'user', content: 'what is up' },
      { role: 'assistant', content: 'Filed.', runs: [{ type: 'card', label: 'File it', actionId: 'objects.propose_candidate', runId: 7 }] },
    ]);

    expect(flat[0]).toEqual({ role: 'user', content: 'what is up' });
    expect(flat[1]?.content).toBe('Filed.\n\n[Earlier in this turn you put up a card: "File it" → objects.propose_candidate (proposal #7). "Approve", "go", "file it" or "go ahead" means THAT card when it is still waiting — decide it or make its call, never a different record; a card that ran is done]');
  });

  it('a card that ran says what it created, so the next turn reads the record instead of asking for its id', () => {
    const out = historyMessages({ id: 'm7', role: 'assistant', content: 'Filed.', runs: [{ type: 'card', label: 'File P1 request', actionId: 'objects.propose_candidate', runId: 3722, state: 'decided', ref: { type: 'request', id: 126 } }] });

    expect((out[1] as { content: string }).content).toContain('created request #126');
    expect((out[1] as { content: string }).content).toContain('do not file it again');
  });

  it('a Decision the call raised replays inside that call\'s result, by id — and what ran inside the trust bar says it is done', () => {
    const out = historyMessages({ id: 'm8', role: 'assistant', content: '', runs: [
      { type: 'tool', name: 'offer_connection', input: { connector: 'github' }, output: 'Asked them to connect GitHub.' },
      { type: 'decision', id: 41, question: 'Connect GitHub', state: 'open' },
      { type: 'tool', name: 'recommend_action', input: { label: 'Move Northwind to Negotiation' }, output: 'Surfaced.' },
      { type: 'receipt', receipt: { runId: 88, actionId: 'hubspot.update', label: 'Move Northwind to Negotiation', undoable: true } },
    ] });
    const results = out.filter(m => m.role === 'tool').map(m => (m as { content: string }).content);

    expect(results[0]).toContain('decision #41: "Connect GitHub"');
    expect(results[0]).toContain('Do not ask it again');
    expect(results[1]).toContain('run #88');
    expect(results[1]).toContain('Undo is on its line');
    expect(out.filter(m => m.role === 'tool')).toHaveLength(2);
  });
});
