import { describe, expect, it } from 'vitest';
import {
  isReasonCode,
  NO_REASON_RECORDED,
  readReasons,
  REASON_CODES,
  ReasonCodeSchema,
  reasonPhrase,
  reasonSummary,
} from './reasonCodes';

// The closed list, and the rule that absence is reported rather than filled
// in. Nothing here touches a database.

describe('the reason code list', () => {
  it('is the nine codes, and nothing else parses', () => {
    expect([...REASON_CODES]).toEqual([
      'user_request',
      'production_bug',
      'blocks_goal',
      'breaks_promise',
      'required_for_dogfood',
      'manual_toil',
      'platform_leverage',
      'factory_reliability',
      'observed_behaviour',
    ]);
    expect(ReasonCodeSchema.safeParse('user_request').success).toBe(true);
    expect(ReasonCodeSchema.safeParse('priority_62').success).toBe(false);
    expect(isReasonCode('blocks_goal')).toBe(true);
    expect(isReasonCode(62)).toBe(false);
  });

  it('gives every code a phrase a person would say out loud', () => {
    for (const code of REASON_CODES) {
      expect(reasonPhrase(code)).toMatch(/^[a-z]/);
      expect(reasonPhrase(code).length).toBeGreaterThan(8);
    }

    expect(reasonPhrase('required_for_dogfood')).toBe('we cannot dogfood without it');
  });
});

describe('reading meta.why off a record', () => {
  it('keeps the recorded codes, in order, deduped', () => {
    const reasons = readReasons({ why: ['user_request', 'blocks_goal', 'user_request'] });

    expect(reasons.codes).toEqual(['user_request', 'blocks_goal']);
    expect(reasons.recorded).toBe(true);
    expect(reasons.unrecognised).toEqual([]);
  });

  it('sets a string that is not on the list aside instead of rendering it', () => {
    const reasons = readReasons({ why: ['user_request', 'userRequest', 'made_up'] });

    expect(reasons.codes).toEqual(['user_request']);
    expect(reasons.unrecognised).toEqual(['userRequest', 'made_up']);
    expect(reasonSummary(reasons)).toBe('a person asked for it');
  });

  it('accepts a single code written without the array', () => {
    expect(readReasons({ why: 'production_bug' }).codes).toEqual(['production_bug']);
  });

  it('reads the note from meta.whyNote by default, and from named fields on request', () => {
    expect(readReasons({ whyNote: '  three user asks  ' }).note).toBe('three user asks');
    expect(readReasons({ priorityReason: 'dogfood blocker' }).note).toBeNull();
    expect(readReasons({ priorityReason: 'dogfood blocker' }, ['whyNote', 'priorityReason']).note).toBe('dogfood blocker');
  });

  it('cannot be tricked into promoting an arbitrary field into a reason code', () => {
    // `noteFields` names where PROSE lives. Codes come from meta.why only.
    const reasons = readReasons({ priorityReason: 'user_request' }, ['priorityReason']);

    expect(reasons.codes).toEqual([]);
    expect(reasons.recorded).toBe(false);
  });

  it('reads an absent, null or non-object meta as nothing recorded', () => {
    for (const meta of [undefined, null, 'why', 42, [], {}, { why: [] }, { why: null }]) {
      const reasons = readReasons(meta);

      expect(reasons.recorded).toBe(false);
      expect(reasons.codes).toEqual([]);
      expect(reasonSummary(reasons)).toBe(NO_REASON_RECORDED);
    }
  });
});

describe('the one line a surface shows', () => {
  it('joins the phrases, and appends the note when there is one', () => {
    expect(reasonSummary(readReasons({ why: ['user_request', 'breaks_promise'] })))
      .toBe('a person asked for it · it breaks a promise we made');
    expect(reasonSummary(readReasons({ why: ['production_bug'], whyNote: 'Send is down for invited viewers' })))
      .toBe('it is broken in production - Send is down for invited viewers');
  });

  it('never passes prose off as a reason code', () => {
    const line = reasonSummary(readReasons({ priorityReason: 'Promise kept: the board must be honest.' }, ['whyNote', 'priorityReason']));

    expect(line).toBe('no reason recorded; the note says: Promise kept: the board must be honest.');
    expect(line.startsWith(NO_REASON_RECORDED)).toBe(true);
  });

  it('says nothing is recorded rather than inventing one', () => {
    expect(reasonSummary(readReasons({ priority: 62, status: 'new' }))).toBe(NO_REASON_RECORDED);
    expect(reasonSummary(readReasons({ priority: 62 }))).not.toMatch(/62/);
  });
});
