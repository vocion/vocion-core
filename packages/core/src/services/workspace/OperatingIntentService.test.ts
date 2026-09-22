import { describe, expect, it } from 'vitest';
import { listActions } from '@/libs/actions/registry';
import { defaultRiskTier } from '@/services/autonomy/rungs';
import { parseOperatingIntent } from './OperatingIntentService';

/**
 * The promises the Guide page rests on.
 *
 * An operating intent that half-parses is worse than none: the agents would
 * read a partial statement of what a person wants and act on it. So parsing
 * returns the reason instead of throwing, and the action's precheck refuses
 * before a card exists.
 *
 * The write is on the rail, at `medium`, deliberately. This file is the
 * standing instruction every choosing agent reads, so a confident agent does
 * not get to restate a person's own priorities for them.
 */

describe('reading an operating intent', () => {
  it('reads a whole intent, and defaults the lists it was not given', () => {
    const { intent, error } = parseOperatingIntent([
      'outcomes:',
      '  - statement: Send in real Metacto dogfood',
      '    because: we do not trust what we do not use',
      'priorities:',
      '  - statement: Reliability of what is live',
      '    over: a second product',
      'budget:',
      '  limitCents: 2500',
      '  window: day',
      '',
    ].join('\n'));

    expect(error).toBeNull();
    expect(intent?.outcomes[0]?.statement).toBe('Send in real Metacto dogfood');
    expect(intent?.priorities[0]?.over).toBe('a second product');
    expect(intent?.budget?.limitCents).toBe(2500);
    // Not stated is an empty list, not undefined: a caller reading `.length`
    // on an unauthored section should get 0 rather than throw.
    expect(intent?.constraints).toEqual([]);
    expect(intent?.autonomy).toEqual([]);
    expect(intent?.productJudgment).toEqual([]);
  });

  it('says what is wrong instead of throwing, so the page and the precheck can quote it', () => {
    expect(parseOperatingIntent('priorities: [{}]').error).toContain('statement');
    expect(parseOperatingIntent('budget: {limitCents: 100, window: fortnight}').error).toContain('window');
    expect(parseOperatingIntent(': :\n  - [').error).toContain('not valid YAML');
    expect(parseOperatingIntent('').error).toContain('an operating intent with nothing in it says nothing');
  });

  it('refuses an autonomy policy that is not one of the three', () => {
    expect(parseOperatingIntent('autonomy: [{actionClass: releases, policy: sometimes}]').error).toContain('policy');
  });
});

describe('writing an operating intent', () => {
  it('is on the action rail, so a change of direction is a decision with a reason', () => {
    const action = listActions().find(a => a.id === 'workspace.write_operating_intent');

    expect(action).toBeDefined();
    expect(action?.grant).toBe('manage_workspace');
    expect(action?.external).toBe(false);
  });

  it('is held at medium, beside missions and playbooks, rather than done for you', () => {
    expect(defaultRiskTier('workspace.write_operating_intent', false)).toBe('medium');
  });
});
