import type { AgentRun, TraceNode } from './types';
import { describe, expect, it } from 'vitest';
import { turnFailure } from './turnFailure';

const lead = { id: 'lead', kind: 'lead' as const, name: 'Product manager' };
const failedFiling: AgentRun = { type: 'tool', name: 'file_request', state: 'error', output: 'Not recorded: invalid arguments for file_request: expected array at acceptance' };
const filed: AgentRun = { type: 'tool', name: 'file_request', state: 'done', output: 'objects.propose_candidate is DONE: filed as request #214 (run #4944), open at /w/northwind/dashboard/p/feature/214.' };

describe('the turn\'s failure chip (journey 4, 2026-09-28: "file_request failed" over request #214)', () => {
  it('a failed call a later call of the same kind recovered from is "retried · filed", not a red chip', () => {
    const f = turnFailure([{ type: 'tool', name: 'lookup_objects', state: 'done', output: '[]' }, failedFiling, filed]);

    expect(f.run).toBeUndefined();
    expect(f.node).toBeUndefined();
    expect(f.retried).toEqual({ tool: 'file_request', filed: true });
  });

  it('the filing tools are one act: propose_action recovers a failed file_request', () => {
    const f = turnFailure([failedFiling, { type: 'tool', name: 'propose_action', state: 'done', output: 'action run #9 is PENDING' }]);

    expect(f.run).toBeUndefined();
    expect(f.retried?.filed).toBe(true);
  });

  it('a failure nothing recovered from keeps its red chip', () => {
    expect(turnFailure([failedFiling]).run).toBe(failedFiling);
    // A later call that answered with a refusal did not recover it.
    expect(turnFailure([failedFiling, { type: 'tool', name: 'file_request', state: 'done', output: 'Not recorded: still missing acceptance' }]).run).toBe(failedFiling);
    // Nor does a different kind of step.
    expect(turnFailure([failedFiling, { type: 'tool', name: 'read_object', state: 'done', output: '{}' }]).run).toBe(failedFiling);
    // A success BEFORE the failure is not a recovery.
    expect(turnFailure([filed, failedFiling]).run).toBe(failedFiling);
  });

  it('reads a typed trace the same way', () => {
    const failedNode: TraceNode = { id: 'a', actor: lead, kind: 'tool', status: 'error', label: 'file_request', tool: 'file_request' };
    const doneNode: TraceNode = { id: 'b', actor: lead, kind: 'tool', status: 'done', label: 'Filed the request', tool: 'file_request' };

    expect(turnFailure([], [failedNode, doneNode]).node).toBeUndefined();
    expect(turnFailure([], [failedNode, doneNode]).retried?.tool).toBe('file_request');
    expect(turnFailure([], [failedNode]).node).toBe(failedNode);
    // The run log recovering the node counts too.
    expect(turnFailure([filed], [failedNode]).node).toBeUndefined();
  });
});
