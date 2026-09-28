import { describe, expect, it } from 'vitest';
import { callMeets, isRefusal, parseToolRequirement } from './toolRequirement';

// `do.requireTool` as a tool, or a tool and the action it must carry (backlog 038).

describe('what a required tool asks of a run', () => {
  it('reads a bare tool, and a tool with its action', () => {
    expect(parseToolRequirement('record_verdict')).toEqual({ tool: 'record_verdict', action: null });
    expect(parseToolRequirement('propose_action:objects.propose_candidate.architecture_plan')).toEqual({ tool: 'propose_action', action: 'objects.propose_candidate.architecture_plan' });
  });

  it('is met only by an accepted call for the action it names', () => {
    const req = parseToolRequirement('propose_action:objects.propose_candidate.architecture_plan');
    const filed = { tool: 'propose_action', input: { action_id: 'objects.propose_candidate', action_input: { objectType: 'architecture_plan' } }, output: 'objects.propose_candidate is DONE (run #9)', error: null };

    expect(callMeets(req, filed)).toBe(true);
    // Mission 6017: an approval proposed for a plan never filed is not the plan.
    expect(callMeets(req, { ...filed, input: { action_id: 'factory.approve_plan', action_input: { planId: 3 } } })).toBe(false);
    expect(callMeets(req, { ...filed, output: 'Refused: you already have 8 undecided items in Review' })).toBe(false);
    expect(callMeets(req, { ...filed, input: { action_id: 'objects.propose_candidate', action_input: { objectType: 'request' } } })).toBe(false);
    expect(callMeets(parseToolRequirement('record_verdict'), { tool: 'record_verdict', input: {}, output: 'Recorded', error: null })).toBe(true);
  });

  it('knows a refusal when it reads one', () => {
    expect(isRefusal('Not recorded: prove it')).toBe(true);
    expect(isRefusal('"Proposal refused (VALIDATION_FAILED): x"')).toBe(true);
    expect(isRefusal('Proposed factory.dispatch_task → action run #4 is PENDING')).toBe(false);
  });
});
