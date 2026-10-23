import type { AgentRun, TraceNode } from './types';
import { describe, expect, it } from 'vitest';
import { foldNarration, liveWorkIndex, segmentTurn, stepsWithNotes } from './interleave';

const actor = { id: 'lead', kind: 'lead' as const, name: 'Revenue' };
const node = (id: string, extra: Partial<TraceNode> = {}): TraceNode => ({ id, actor, kind: 'tool', status: 'done', label: id, ...extra });

describe('segmentTurn — the turn in the order it happened', () => {
  it('a plain answer is one text segment and nothing else', () => {
    expect(segmentTurn([{ type: 'text', text: 'Pipeline is up.' }])).toEqual([
      { kind: 'text', text: 'Pipeline is up.', index: 0 },
    ]);
  });

  it('puts tool runs between the passages they fell between, in order', () => {
    const runs: AgentRun[] = [
      { type: 'tool', name: 'get_briefing', state: 'done' },
      { type: 'text', text: 'Reading the brief first.' },
      { type: 'tool', name: 'lookup_objects', state: 'done' },
      { type: 'tool', name: 'web_search', state: 'done' },
      { type: 'text', text: 'Three deals moved.' },
      { type: 'tool', name: 'render_markdown', state: 'done' },
    ];

    const segments = segmentTurn(runs);

    expect(segments.map(s => (s.kind === 'text' ? `text:${s.index}` : `work:${s.runs.map(r => r.name).join(',')}`))).toEqual([
      'work:get_briefing',
      'text:0',
      'work:lookup_objects,web_search',
      'text:1',
      'work:render_markdown',
    ]);
  });

  it('places trace roots by anchor and keeps their children with them', () => {
    const runs: AgentRun[] = [{ type: 'text', text: 'First.' }, { type: 'text', text: 'Second.' }];
    const trace: TraceNode[] = [
      node('reason', { kind: 'reason', anchor: 0 }),
      node('delegate', { kind: 'delegate', anchor: 1 }),
      node('child', { parentId: 'delegate', kind: 'search' }),
      node('render', { anchor: 2 }),
    ];

    const segments = segmentTurn(runs, trace);

    expect(segments.map(s => (s.kind === 'text' ? `text:${s.index}` : `work:${s.trace.map(n => n.id).join(',')}`))).toEqual([
      'work:reason',
      'text:0',
      'work:delegate,child',
      'text:1',
      'work:render',
    ]);
  });

  it('a trace with no anchors renders hoisted, exactly as before', () => {
    const runs: AgentRun[] = [{ type: 'text', text: 'Done.' }];
    const trace: TraceNode[] = [node('a'), node('b')];

    expect(segmentTurn(runs, trace)).toEqual([
      { kind: 'work', runs: [], trace, index: 0 },
      { kind: 'text', text: 'Done.', index: 0 },
    ]);
  });

  it('clamps an anchor past the last passage into the trailing group', () => {
    const runs: AgentRun[] = [{ type: 'text', text: 'Done.' }];
    const segments = segmentTurn(runs, [node('late', { anchor: 7 })]);

    expect(segments[segments.length - 1]).toEqual({ kind: 'work', runs: [], trace: [node('late', { anchor: 7 })], index: 1 });
  });

  it('a tool run and its trace node land in the same group', () => {
    const runs: AgentRun[] = [{ type: 'text', text: 'Looking.' }, { type: 'tool', name: 'web_search', state: 'done' }];
    const segments = segmentTurn(runs, [node('s', { kind: 'search', tool: 'web_search', anchor: 1 })]);

    expect(segments).toHaveLength(2);
    expect(segments[1]).toMatchObject({ kind: 'work', index: 1, runs: [{ name: 'web_search' }], trace: [{ id: 's' }] });
  });
});

describe('liveWorkIndex — which group is still running', () => {
  it('is the trailing work group when the turn ends in work', () => {
    const segments = segmentTurn([{ type: 'text', text: 'A' }, { type: 'tool', name: 'x', state: 'pending' }]);

    expect(liveWorkIndex(segments)).toBe(1);
  });

  it('is null once prose follows the last group — that work is finished', () => {
    const segments = segmentTurn([{ type: 'tool', name: 'x', state: 'done' }, { type: 'text', text: 'A' }]);

    expect(liveWorkIndex(segments)).toBeNull();
  });
});

describe('foldNarration — what the agent said while working stays with the work', () => {
  // The Founder GTM turn of 2026-10-23: three lines of "I'll pull… / Let me
  // find… / Let me check…" read as the answer, between the step lines.
  const turn = (): AgentRun[] => [
    { type: 'text', text: 'I\'ll pull the plan, the sprint goal and the tracker together.' },
    { type: 'tool', name: 'freshen_source', state: 'done' },
    { type: 'tool', name: 'get_briefing', state: 'done' },
    { type: 'text', text: 'Let me find the goal and check sent mail.' },
    { type: 'tool', name: 'search_knowledge', state: 'done' },
    { type: 'text', text: 'Three of five weekly targets are met.' },
  ];

  it('folds every passage but the last into one group of work, as notes in order; the last passage is the answer', () => {
    const folded = foldNarration(segmentTurn(turn()));

    expect(folded.map(s => s.kind)).toEqual(['work', 'text']);

    const work = folded[0]!;
    const answer = folded[1]!;

    expect(work.kind === 'work' && work.runs.map(r => r.name)).toEqual(['freshen_source', 'get_briefing', 'search_knowledge']);
    expect(work.kind === 'work' && work.notes).toEqual([
      { text: 'I\'ll pull the plan, the sprint goal and the tracker together.', at: 0 },
      { text: 'Let me find the goal and check sent mail.', at: 1 },
    ]);
    expect(answer).toEqual({ kind: 'text', text: 'Three of five weekly targets are met.', index: 2 });
  });

  it('while streaming, the newest passage stays in the body, and folds once the agent writes past the next step', () => {
    const live: AgentRun[] = [
      { type: 'tool', name: 'freshen_source', state: 'done' },
      { type: 'text', text: 'Let me find the goal.' },
      { type: 'tool', name: 'goal_list', state: 'pending' },
    ];

    // Narration and an answer followed by a card look the same until more
    // prose comes, so the newest passage shows: it is the live line of what
    // the agent is doing.
    expect(foldNarration(segmentTurn(live)).map(s => s.kind)).toEqual(['work', 'text', 'work']);

    live.push({ type: 'text', text: 'Week 1 of 13: 3 of 9 targets met.' });
    const folded = foldNarration(segmentTurn(live));

    expect(folded.map(s => s.kind)).toEqual(['work', 'text']);
    expect(folded[0]!.kind === 'work' && folded[0]!.notes?.map(n => n.text)).toEqual(['Let me find the goal.']);
  });

  it('keeps the answer in the body when the turn ends with work after it (a card, a write)', () => {
    const runs: AgentRun[] = [
      { type: 'tool', name: 'lookup_objects', state: 'done' },
      { type: 'text', text: 'Two follow-ups are owed.' },
      { type: 'tool', name: 'update_object', state: 'done' },
    ];

    const folded = foldNarration(segmentTurn(runs));

    expect(folded.map(s => s.kind)).toEqual(['work', 'text', 'work']);
    expect(folded[1]).toEqual({ kind: 'text', text: 'Two follow-ups are owed.', index: 0 });
  });

  it('leaves a plain answer and a passage with no work after it alone', () => {
    expect(foldNarration(segmentTurn([{ type: 'text', text: 'Pipeline is up.' }]))).toEqual([{ kind: 'text', text: 'Pipeline is up.', index: 0 }]);
  });
});

describe('stepsWithNotes — a note goes back where it was said', () => {
  it('puts a note before the first step that began after it, and late notes last', () => {
    const steps = [node('a', { anchor: 0 }), node('b', { anchor: 1 }), node('c', { anchor: 2 })];
    const notes = [{ text: 'second', at: 1 }, { text: 'first', at: 0 }, { text: 'after', at: 5 }];

    expect(stepsWithNotes(steps, notes).map(i => (i.kind === 'note' ? `note:${i.note.text}` : `step:${i.step.id}`))).toEqual([
      'step:a',
      'note:first',
      'step:b',
      'note:second',
      'step:c',
      'note:after',
    ]);
  });
});
