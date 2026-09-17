import type { AgentRun, TraceNode } from './types';
import { describe, expect, it } from 'vitest';
import { liveWorkIndex, segmentTurn } from './interleave';

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
