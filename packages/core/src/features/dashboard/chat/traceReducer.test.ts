import type { TraceNode } from './types';
import { describe, expect, it } from 'vitest';
import { failToolNode, finalizeTrace, liveStepLabel, mergeArtifactEvent, mergeTraceNode, noteToolProgress, summarizeLiveTrace } from './traceReducer';

const actor = { id: 'lead', kind: 'lead' as const, name: 'Revenue Director' };
const start: TraceNode = { id: 't1', actor, kind: 'tool', status: 'start', label: 'Looking up records…', detail: 'deals', tool: 'lookup_objects', args: '{"type":"deal"}' };

describe('mergeTraceNode', () => {
  it('appends reason deltas and keeps fields a later event leaves out', () => {
    const a = mergeTraceNode(undefined, { id: 'r1', actor, kind: 'reason', status: 'progress', label: 'Thinking', delta: 'The deal ' });
    const b = mergeTraceNode(a, { id: 'r1', actor, kind: 'reason', status: 'progress', label: 'Thinking', delta: 'is Northwind.' });

    expect(b.text).toBe('The deal is Northwind.');
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

describe('mergeArtifactEvent', () => {
  const base = {
    id: 12,
    conversationId: 3,
    kind: 'markdown' as const,
    title: 'Release readiness',
    spec: {} as Record<string, unknown>,
    folder: null,
    version: 0,
    // Null while the tool runs — the assistant message does not exist yet.
    messageId: null,
    authorKind: 'agent' as const,
    authorId: 'agent:lead',
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
  };

  it('a pending event opens a shell with the title and no body', () => {
    const shell = mergeArtifactEvent(undefined, { artifact: { ...base, id: -1 }, pending: true });

    expect(shell.pending).toBe(true);
    expect(shell.title).toBe('Release readiness');
    expect(shell.spec.md).toBeUndefined();
  });

  it('deltas append to the pending body', () => {
    let node = mergeArtifactEvent(undefined, { artifact: { ...base, id: -1 }, pending: true });
    node = mergeArtifactEvent(node, { artifact: { ...base, id: -1 }, pending: true, delta: '# Ready\n' });
    node = mergeArtifactEvent(node, { artifact: { ...base, id: -1 }, delta: 'Two risks.' });

    expect(node.spec.md).toBe('# Ready\nTwo risks.');
    expect(node.pending).toBe(true);
  });

  it('the settled event replaces the accumulated body, so a dropped delta cannot leave the pane lying', () => {
    let node = mergeArtifactEvent(undefined, { artifact: { ...base, id: -1 }, pending: true, delta: '# Rea' });
    node = mergeArtifactEvent(node, { artifact: { ...base, version: 1, spec: { md: '# Ready\nTwo risks.' } } });

    expect(node.pending).toBe(false);
    expect(node.id).toBe(12);
    expect(node.version).toBe(1);
    expect(node.spec.md).toBe('# Ready\nTwo risks.');
  });
});

describe('what a long call says while it runs', () => {
  /**
   * "'working…' isn't much info" (Chris, twice). A twelve-sheet render holds
   * one step line for a minute, so the line says where the call has got to —
   * on the step that is already there, never on a second surface.
   */
  it('puts the note on the newest in-flight step for that tool', () => {
    const render: TraceNode = { id: 'd1', actor, kind: 'tool', status: 'start', label: 'Rendering the document…', tool: 'render_document', labels: { running: 'Rendering the document…', done: 'Rendered the document' } };
    const out = noteToolProgress([{ ...render, id: 'earlier', status: 'done' }, render], 'render_document', 'sheet 7 of 12');

    expect(out[1]).toMatchObject({ status: 'progress', progress: 'sheet 7 of 12' });
    expect(liveStepLabel(out[1]!)).toBe('Rendering the document… sheet 7 of 12');
    expect(out[0]!.progress).toBeUndefined();
  });

  it('leaves the trace alone when no step of that tool is running', () => {
    const done: TraceNode = { id: 'd1', actor, kind: 'tool', status: 'done', label: 'Rendered the document', tool: 'render_document' };
    const trace = [done];

    expect(noteToolProgress(trace, 'render_document', 'sheet 2 of 9')).toBe(trace);
    expect(noteToolProgress(trace, 'verify_document', 'sheet 2 of 9')).toBe(trace);
    expect(noteToolProgress([{ ...done, status: 'start' }], 'render_document', '   ')).toHaveLength(1);
  });

  it('drops the note the moment the step lands, so a finished trace never keeps a count', () => {
    const running = mergeTraceNode(undefined, { id: 'd1', actor, kind: 'tool', status: 'progress', label: 'Rendering the document…', tool: 'render_document', progress: 'sheet 7 of 12', labels: { running: 'Rendering the document…', done: 'Rendered the document' } });

    expect(running.progress).toBe('sheet 7 of 12');
    expect(liveStepLabel(running)).toBe('Rendering the document… sheet 7 of 12');

    const landed = mergeTraceNode(running, { id: 'd1', actor, kind: 'tool', status: 'done', label: 'Rendered the document' });

    expect(landed.progress).toBeUndefined();
    expect(liveStepLabel(landed)).toBe('Rendered the document');
    expect(finalizeTrace([running])[0]!.progress).toBeUndefined();
  });
});
