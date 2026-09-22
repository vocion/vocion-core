import { describe, expect, it } from 'vitest';
import { OperatingIntentManifestSchema } from '@/libs/workspace/schemas';
import { operatingIntentPromptNote } from './harness';

/**
 * Operating intent is only real if the agents read it, and only honest if it
 * claims exactly what it does.
 *
 * Two failures this guards. The first is a workspace that has stated nothing
 * being read as a workspace that allowed everything: silence is not consent,
 * so a null intent must produce no section at all rather than a section
 * saying there are no constraints. The second is the budget: it is composed
 * into a prompt and it is NOT enforced by the platform, so the line has to
 * say so, or an agent will one day tell a person a spend was stopped by a
 * cap that never existed.
 */

const intent = OperatingIntentManifestSchema.parse({
  outcomes: [{ statement: 'Send in real Metacto dogfood', because: 'we do not trust what we do not use' }],
  priorities: [
    { statement: 'Reliability of what is live', over: 'a second product' },
    { statement: 'Removing manual toil' },
  ],
  constraints: [{ statement: 'Nothing outside the agreed 20 percent without asking' }],
  budget: { limitCents: 2500, window: 'day', note: 'Model spend only.' },
  autonomy: [{ actionClass: 'routine releases', policy: 'unattended' }],
  productJudgment: ['A working name is not a launch name.'],
  reviewedAt: '2026-09-21',
});

describe('the operating intent an agent is given', () => {
  it('says nothing at all when the workspace has stated nothing', () => {
    expect(operatingIntentPromptNote(null)).toBe('');
  });

  it('says nothing when an authored intent states nothing an agent could act on', () => {
    expect(operatingIntentPromptNote(OperatingIntentManifestSchema.parse({}))).toBe('');
  });

  it('gives the priorities as an ordered list, because the order is the ranking', () => {
    const note = operatingIntentPromptNote(intent);

    expect(note).toContain('1. Reliability of what is live over a second product');
    expect(note).toContain('2. Removing manual toil');
    expect(note).toContain('This list IS the ranking');
  });

  it('states the budget and says plainly that it advises rather than enforces', () => {
    const note = operatingIntentPromptNote(intent);

    expect(note).toContain('25.00 per day');
    expect(note).toContain('ADVISES');
    expect(note).toContain('NOT enforced');
    expect(note).toContain('never tell a person a spend was blocked by it');
  });

  it('calls a constraint a refusal and sends the agent to an ask, not around it', () => {
    const note = operatingIntentPromptNote(intent);

    expect(note).toContain('These are refusals, not preferences');
    expect(note).toContain('Nothing outside the agreed 20 percent without asking');
  });

  it('defers to the trust ladder where the stated autonomy disagrees with it', () => {
    expect(operatingIntentPromptNote(intent)).toContain('the ladder wins');
  });

  it('says when it was last reviewed, and says so when nobody has', () => {
    expect(operatingIntentPromptNote(intent)).toContain('Last reviewed by a person on 2026-09-21');
    expect(operatingIntentPromptNote(OperatingIntentManifestSchema.parse({ outcomes: [{ statement: 'x' }] })))
      .toContain('Nobody has recorded when this was last reviewed');
  });
});
