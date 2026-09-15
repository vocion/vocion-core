import type { TraceNode } from './types';
import { describe, expect, it } from 'vitest';
import { failToolNode, finalizeTrace, mergeTraceNode, summarizeLiveTrace } from './traceReducer';

const actor = { id: 'lead', kind: 'lead' as const, name: 'Revenue Director' };
const start: TraceNode = { id: 't1', actor, kind: 'tool', status: 'start', label: 'Looking up records…', detail: 'deals', tool: 'lookup_objects', args: '{"type":"deal"}' };

describe('mergeTraceNode', () => {
  it('appends reason deltas and keeps fields a later event leaves out', () => {
    const a = mergeTraceNode(undefined, { id: 'r1', actor, kind: 'reason', status: 'progress', label: 'Thinking', delta: 'The deal ' });
    const b = mergeTraceNode(a, { id: 'r1', actor, kind: 'reason', status: 'progress', label: 'Thinking', delta: 'is Spinutech.' });

    expect(b.text).toBe('The deal is Spinutech.');
    expect((b as { delta?: string }).delta).toBeUndefined();

    const done = mergeTraceNode(start, { id: 't1', actor, kind: 'tool', status: 'done', label: 'Looked up records', result: '3 records' });

    expect(done).toMatchObject({ status: 'done', detail: 'deals', tool: 'lookup_objects', args: '{"type":"deal"}', result: '3 records' });
  });
});

describe('finalizeTrace / failToolNode', () => {
  it('closes in-flight nodes as done and keeps errors', () => {
    const out = finalizeTrace([start, { ...start, id: 't2', status: 'error' }]);

    expect(out.map(n => n.status)).toEqual(['done', 'error']);
  });

  it('marks the newest in-flight node for the failing tool as an error', () => {
    const out = failToolNode([{ ...start, id: 'old', status: 'done' }, start], 'lookup_objects', 'HubSpot 429');

    expect(out[1]).toMatchObject({ status: 'error', result: 'HubSpot 429' });
    expect(out[0]!.status).toBe('done');
  });
});

describe('summarizeLiveTrace', () => {
  it('reports the in-flight node and root step counts, ignoring reasoning', () => {
    const s = summarizeLiveTrace([
      { id: 'r1', actor, kind: 'reason', status: 'done', label: 'Thinking' },
      { ...start, id: 'a', status: 'done' },
      { ...start, id: 'b', status: 'start', label: 'Searching sources…' },
      { ...start, id: 'b1', parentId: 'b', status: 'start', label: 'child' },
    ]);

    expect(s.steps).toBe(2);
    expect(s.done).toBe(1);
    expect(s.current?.id).toBe('b1');
  });
});
