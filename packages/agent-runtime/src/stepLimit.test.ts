/**
 * The runtime's copy of the step limit, which core cannot share with it.
 *
 * What can go wrong on this side: the limit is sent but never applied (core
 * passes `maxSteps`, the runtime drops it), a limit of our own sneaks in for an
 * agent that set none, or the stop reaches the person as LangGraph's
 * "Recursion limit of N reached" instead of the setting they can change.
 */
import { describe, expect, it } from 'vitest';
import { stepLimitStreamConfig, turnFailureMessage } from './stepLimit.js';

/** An error shaped like LangGraph's, which is matched by name. */
function recursionError(): Error {
  const error = new Error('Recursion limit of 6 reached without hitting a stop condition.');
  error.name = 'GraphRecursionError';
  return error;
}

describe('stepLimitStreamConfig', () => {
  it('passes the agent\'s maxSteps to deepagents as recursionLimit', () => {
    expect(stepLimitStreamConfig(6)).toEqual({ recursionLimit: 6 });
  });

  it('adds nothing when core sent no maxSteps, so deepagents\' default stands', () => {
    expect(stepLimitStreamConfig(undefined)).toEqual({});
  });
});

describe('turnFailureMessage', () => {
  it('names the agent\'s limit and the setting when the step limit stopped the turn', () => {
    const message = turnFailureMessage(recursionError(), 6);

    expect(message).toContain('stopped after 6 steps');
    expect(message).toContain('maxSteps');
    expect(message).not.toContain('Recursion limit');
  });

  it('names deepagents\' own limit when the agent set none', () => {
    expect(turnFailureMessage(recursionError(), undefined)).toContain('stopped after 10000 steps');
  });

  it('keeps any other failure\'s own message', () => {
    expect(turnFailureMessage(new Error('tool endpoint unreachable'), 6)).toBe('tool endpoint unreachable');
  });
});
