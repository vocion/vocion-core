import { describe, expect, it } from 'vitest';
import { RunCollector } from './runCollector';

/**
 * What a RELOADED transcript says about a turn that went wrong.
 *
 * The turn this was written for persisted `trace_json` with exactly one node —
 * `{ kind: 'delegate', status: 'start' }` — and nothing about the failure that
 * ended it. Two gaps, both here: the collector had no case for `tool_error`,
 * and the emitter never produced a terminal node for it to merge.
 */
describe('RunCollector', () => {
  it('merges a trace node by id, so the persisted trace ends where the live one did', () => {
    const c = new RunCollector();
    c.onTraceNode({ type: 'trace_node', id: 'task-1', kind: 'delegate', status: 'start', label: 'Delegating to Pipeline Analyst', detail: 'Full pipeline read' });
    c.onTraceNode({ type: 'trace_node', id: 'task-1', kind: 'delegate', status: 'error', label: 'Pipeline Analyst could not finish', result: 'the specialist could not be reached' });

    const { trace } = c.finalise();

    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ id: 'task-1', status: 'error', result: 'the specialist could not be reached' });
    // The `start` event's detail survives the merge — a terminal event that
    // carries only a status must not blank what the surface already showed.
    expect(trace[0]?.detail).toBe('Full pipeline read');
  });

  it('persists a tool failure as a failed step rather than dropping it', () => {
    const c = new RunCollector();
    c.onTextDelta('Handing this to the analyst.');
    c.onToolError('task', 'the specialist could not be reached');

    const { runs, text } = c.finalise();

    expect(text).toBe('Handing this to the analyst.');

    const failed = runs.filter(r => r.type === 'tool' && r.state === 'error');

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: 'task', output: 'the specialist could not be reached' });
  });

  it('closes an in-flight step rather than appending a second row for it', () => {
    const c = new RunCollector();
    c.onToolStart('lookup_objects', { type_slug: 'deal' });
    c.onToolError('lookup_objects', 'object type not found');

    const { runs } = c.finalise();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ type: 'tool', name: 'lookup_objects', state: 'error', output: 'object type not found' });
  });

  it('keeps a step that landed as a landed step', () => {
    const c = new RunCollector();
    c.onToolStart('search_knowledge', { query: 'renewals' });
    c.onToolEnd('search_knowledge', '[1] **A note** [granola]');

    const { runs } = c.finalise();

    expect(runs[0]).toMatchObject({ name: 'search_knowledge', output: '[1] **A note** [granola]' });
    expect((runs[0] as { state?: string }).state).toBeUndefined();
  });

  it('records the artifacts a turn touched, ignoring the pending shell', () => {
    const c = new RunCollector();
    c.onArtifact(12);
    c.onArtifact(12);
    c.onArtifact(-1);

    expect(c.touchedArtifactIds).toEqual([12]);
  });
});
