/**
 * The pure half of the runaway guards: which event fires which automation,
 * and what ceiling an event-when is held to. No database — the rules are
 * what the matcher decides with, so they are tested on their own.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_FIRES_PER_10M, eventFireCeiling, extendChain, MAX_CHAIN_LENGTH, selfTriggerReason } from './fireGuards';

const DEBRIEF = { slug: 'wiki-debrief', doConfig: { checkMission: 'wiki-debrief' } };

describe('selfTriggerReason', () => {
  it('refuses an event whose chain names the candidate — its own run raised it', () => {
    const reason = selfTriggerReason(DEBRIEF, {
      type: 'mission_run.completed',
      payload: { missionSlug: 'anything' },
      causedBy: [{ automationSlug: 'wiki-debrief', automationRunId: 41, missionRunId: 2505 }],
    });

    expect(reason).toContain('mission run 2505');
    expect(reason).toContain('"wiki-debrief"');
  });

  it('refuses it however deep on the chain the candidate is', () => {
    const reason = selfTriggerReason(DEBRIEF, {
      type: 'automation_run.completed',
      payload: {},
      causedBy: [{ automationSlug: 'product-debrief', automationRunId: 50 }, { automationSlug: 'wiki-debrief', automationRunId: 41 }],
    });

    expect(reason).not.toBeNull();
  });

  it('refuses a completed run of the very mission the candidate checks, chain or no chain', () => {
    const reason = selfTriggerReason(DEBRIEF, {
      type: 'mission_run.completed',
      payload: { missionSlug: 'wiki-debrief', mode: 'check' },
    });

    expect(reason).toContain('mission "wiki-debrief"');
  });

  it('lets a different automation fire on the same event', () => {
    const reason = selfTriggerReason({ slug: 'product-debrief', doConfig: { checkMission: 'product-debrief' } }, {
      type: 'mission_run.completed',
      payload: { missionSlug: 'wiki-debrief' },
      causedBy: [{ automationSlug: 'wiki-debrief', automationRunId: 41 }],
    });

    expect(reason).toBeNull();
  });

  it('lets a workflow automation fire on a mission completion it did not cause', () => {
    expect(selfTriggerReason({ slug: 'notify', doConfig: {} }, { type: 'mission_run.completed', payload: { missionSlug: 'wiki-debrief' } })).toBeNull();
  });
});

describe('eventFireCeiling', () => {
  it('defaults an event-when to six', () => {
    expect(eventFireCeiling({ event: 'mission_run.completed' })).toBe(DEFAULT_MAX_FIRES_PER_10M);
    expect(DEFAULT_MAX_FIRES_PER_10M).toBe(6);
  });

  it('honours an authored ceiling', () => {
    expect(eventFireCeiling({ event: ['pr.merged'], maxFiresPer10m: 20 })).toBe(20);
  });

  it('falls back to the default for a ceiling that is not a whole positive number', () => {
    expect(eventFireCeiling({ event: 'x', maxFiresPer10m: 0 })).toBe(6);
    expect(eventFireCeiling({ event: 'x', maxFiresPer10m: 2.5 })).toBe(6);
  });

  it('holds a schedule-when to nothing — it fires on its cron', () => {
    expect(eventFireCeiling({ schedule: '0 * * * *' })).toBeNull();
    expect(eventFireCeiling({ schedule: '0 * * * *', maxFiresPer10m: 3 })).toBeNull();
  });
});

describe('extendChain', () => {
  it('puts this fire first and keeps the parent behind it', () => {
    expect(extendChain({ automationSlug: 'b', automationRunId: 2 }, [{ automationSlug: 'a', automationRunId: 1 }]))
      .toEqual([{ automationSlug: 'b', automationRunId: 2 }, { automationSlug: 'a', automationRunId: 1 }]);
  });

  it('starts a chain from nothing', () => {
    expect(extendChain({ automationSlug: 'a' }, null)).toEqual([{ automationSlug: 'a' }]);
  });

  it('keeps only the most recent links', () => {
    const long = Array.from({ length: MAX_CHAIN_LENGTH + 3 }, (_, i) => ({ automationSlug: `a${i}` }));

    expect(extendChain({ automationSlug: 'new' }, long)).toHaveLength(MAX_CHAIN_LENGTH);
    expect(extendChain({ automationSlug: 'new' }, long)[0]).toEqual({ automationSlug: 'new' });
  });
});
