import { describe, expect, it } from 'vitest';
import { isNurtureSequence, nurtureSlotProperties, readNurtureSlotsConfig } from './nurtureSlots';

describe('nurture slots', () => {
  it('recognises a ladder rung by its name prefix, case-insensitively', () => {
    expect(isNurtureSequence('Personalized Nurture · 3 Steady')).toBe(true);
    expect(isNurtureSequence('personalized nurture · 1 Ambient')).toBe(true);
    expect(isNurtureSequence('AI-Readiness Nurture')).toBe(false);
  });

  it('maps sends to slots in order and stamps generated-at as midnight UTC ms', () => {
    const props = nurtureSlotProperties(
      [{ subject: 'A', body: 'a' }, { subject: 'B', body: 'b' }, { subject: 'C', body: 'c' }],
      undefined,
      new Date('2026-09-10T15:42:00.000Z'),
    );

    expect(props).toEqual({
      pn_email_1_subject: 'A',
      pn_email_1_body: 'a',
      pn_email_2_subject: 'B',
      pn_email_2_body: 'b',
      pn_email_3_subject: 'C',
      pn_email_3_body: 'c',
      pn_generated_at: String(Date.UTC(2026, 8, 10)),
    });
  });

  it('refuses more sends than slots rather than dropping copy', () => {
    expect(() => nurtureSlotProperties(Array.from({ length: 5 }, (_, i) => ({ subject: `S${i}`, body: 'b' })))).toThrow(/4 slots/);
  });

  it('reads a source config with defaults, and falls back to the defaults on a malformed one', () => {
    expect(readNurtureSlotsConfig({ maxSlots: 3 })).toMatchObject({ maxSlots: 3, sequencePrefix: 'Personalized Nurture' });
    expect(readNurtureSlotsConfig({ subjectProperty: 'no-placeholder' })).toEqual(readNurtureSlotsConfig(undefined));
  });
});
