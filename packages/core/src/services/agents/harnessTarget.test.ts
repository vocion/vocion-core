/**
 * Reading every spelling of "where does this agent run".
 *
 * The names were changed because the old ones hid the distinction that
 * matters: `runtime` and `agentcore` both meant AWS AgentCore, so the old
 * names made it look as though only one of them did. Every old spelling still
 * has to resolve, though — parent projects hold workspace files this repo
 * never sees, and `harness_config` rows written before the rename are still in
 * the database.
 */
import { describe, expect, it } from 'vitest';
import { harnessTargetNames, harnessTargetSchema, normalizeHarnessTarget } from './harnessTarget';

describe('normalizeHarnessTarget', () => {
  it('passes canonical names through unchanged', () => {
    expect(normalizeHarnessTarget('in-process')).toBe('in-process');
    expect(normalizeHarnessTarget('agentcore-container')).toBe('agentcore-container');
    expect(normalizeHarnessTarget('aws-managed-harness')).toBe('aws-managed-harness');
  });

  it('maps the pre-rename spellings', () => {
    expect(normalizeHarnessTarget('local')).toBe('in-process');
    expect(normalizeHarnessTarget('runtime')).toBe('agentcore-container');
    expect(normalizeHarnessTarget('agentcore')).toBe('aws-managed-harness');
  });

  it('keeps "nobody said" distinguishable from "somebody said in-process"', () => {
    // The Bedrock default only applies to the first case, so undefined must
    // never quietly become a target here.
    expect(normalizeHarnessTarget(undefined)).toBeUndefined();
    expect(normalizeHarnessTarget(null)).toBeUndefined();
    expect(normalizeHarnessTarget('')).toBeUndefined();
  });

  it('returns undefined for a name it does not know', () => {
    expect(normalizeHarnessTarget('bedrock')).toBeUndefined();
    expect(normalizeHarnessTarget('lambda')).toBeUndefined();
  });

  it('does not accept a model vendor as a target', () => {
    // The mix-up that started all of this: `bedrock` is a modelProvider.
    expect(normalizeHarnessTarget('bedrock')).toBeUndefined();
    expect(normalizeHarnessTarget('anthropic')).toBeUndefined();
  });
});

describe('harnessTargetNames', () => {
  it('lists canonical names first, then the legacy ones', () => {
    expect(harnessTargetNames()).toEqual([
      'in-process',
      'agentcore-container',
      'aws-managed-harness',
      'local',
      'runtime',
      'agentcore',
    ]);
  });
});

describe('harnessTargetSchema', () => {
  it('yields the canonical name for a legacy input', () => {
    expect(harnessTargetSchema.parse('runtime')).toBe('agentcore-container');
  });

  it('yields the canonical name for a canonical input', () => {
    expect(harnessTargetSchema.parse('aws-managed-harness')).toBe('aws-managed-harness');
  });

  it('rejects a name that is not a target at all', () => {
    expect(() => harnessTargetSchema.parse('bedrock')).toThrow();
  });
});
