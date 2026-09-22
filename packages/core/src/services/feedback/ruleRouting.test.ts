import { describe, expect, it } from 'vitest';
import { pickStepName } from './ruleRecorder';

/**
 * Where a rule learned from a correction lands.
 *
 * Observed live on 2026-09-20: a standing rule about client documents, given
 * to the Proposal Writer mid-task, was filed in `global` — because the only
 * fallback was "the workspace's oldest step". It then mounts for every agent
 * in the workspace, which is broader than the person meant.
 */
describe('pickStepName', () => {
  const workspaceSteps = ['global', 'voice', 'proposal-feedback'];

  it('prefers the agent\'s own first declared step over the workspace default', () => {
    expect(pickStepName({
      agentSteps: ['proposal-feedback', 'global'],
      workspaceSteps,
    })).toBe('proposal-feedback');
  });

  it('honours an explicit step over everything', () => {
    expect(pickStepName({ preferred: 'voice', agentSteps: ['proposal-feedback'], workspaceSteps })).toBe('voice');
  });

  it('skips a declared step the workspace does not have', () => {
    expect(pickStepName({ agentSteps: ['not-applied-yet', 'voice'], workspaceSteps })).toBe('voice');
  });

  it('falls back to the workspace\'s first step when the agent declares none', () => {
    expect(pickStepName({ agentSteps: [], workspaceSteps })).toBe('global');
  });

  it('falls back when there is no agent at all', () => {
    expect(pickStepName({ workspaceSteps })).toBe('global');
  });

  it('answers null when the workspace has no steps', () => {
    expect(pickStepName({ agentSteps: ['proposal-feedback'], workspaceSteps: [] })).toBeNull();
  });
});
