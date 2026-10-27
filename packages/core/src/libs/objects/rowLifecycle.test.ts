import { describe, expect, it } from 'vitest';
import { hasRowLifecycle, isFinishedStatus, isOwedStatus, offersOwedVerbs, readRecordDecision, recordStateLine } from './rowLifecycle';

describe('a record\'s own lifecycle', () => {
  it('belongs to a type that declares no status field of its own', () => {
    expect(hasRowLifecycle({ properties: { owed_action: { type: 'string' } } })).toBe(true);
    expect(hasRowLifecycle({ properties: { status: { type: 'string', enum: ['new', 'shipped'] } } })).toBe(false);
  });

  it('offers its verbs only where the type says its records are owed', () => {
    expect(offersOwedVerbs({ 'x-owed': true, 'properties': {} })).toBe(true);
    expect(offersOwedVerbs({ properties: {} })).toBe(false);
    expect(offersOwedVerbs({ 'x-owed': true, 'properties': { status: { type: 'string' } } })).toBe(false);
    expect(offersOwedVerbs(null)).toBe(false);
  });

  it('reads done, closed, dropped and archived as finished, and anything else as still owed', () => {
    expect(['done', 'closed', 'dropped', 'archived'].map(isFinishedStatus)).toEqual([true, true, true, true]);
    expect(['open', 'active', null, ''].map(isFinishedStatus)).toEqual([false, false, false, false]);
  });

  it('reads open, active and no status as owed, and a candidate or a rejected record as neither owed nor finished', () => {
    expect(['open', 'active', null, ''].map(isOwedStatus)).toEqual([true, true, true, true]);
    expect(['candidate', 'rejected'].map(s => isOwedStatus(s) || isFinishedStatus(s))).toEqual([false, false]);
  });

  it('says a record\'s own state in words, so a field that sounds like a status is not read as one', () => {
    expect(recordStateLine('candidate')).toMatch(/^proposed: waiting for a person/);
    // No stamp (decided before one existed): it does not blame a person.
    expect(recordStateLine('rejected')).toMatch(/^not in use: its proposal was closed in Review — by a person, or withdrawn by an agent or a sweep/);
    expect(recordStateLine('dropped')).toBe('finished (dropped)');
    expect(['open', 'active', 'approved', null].map(s => recordStateLine(s))).toEqual(['open', 'open', 'open', 'open']);

    const now = Date.parse('2026-10-23T12:00:00Z');

    expect(recordStateLine('active', new Date('2026-11-02T17:00:00Z'), now)).toMatch(/^open, snoozed until 2026-11-02/);
    expect(recordStateLine('active', new Date('2026-10-01T17:00:00Z'), now)).toBe('open');
  });

  // Jamie, 2026-10-27: "i never deny'd the repos in [the workspace]. i approved all."
  it('says who turned a record down, and never calls a machine\'s withdrawal a person\'s', () => {
    const at = '2026-10-24T18:00:00.000Z';

    expect(recordStateLine('rejected', null, Date.now(), { status: 'rejected', by: 'agent:product-manager', byMachine: true, at, note: 'superseded by proposal #6120' }))
      .toBe('withdrawn, not turned down by a person: agent:product-manager closed this proposal on 2026-10-24 (superseded by proposal #6120). File it again for a person to approve if it is still wanted');
    expect(recordStateLine('rejected', null, Date.now(), { status: 'rejected', by: 'by-default', byMachine: true, at }))
      .toMatch(/^withdrawn, not turned down by a person: its decision clock, by default at the deadline/);
    expect(recordStateLine('rejected', null, Date.now(), { status: 'rejected', by: 'user_jamie', byMachine: false, at }))
      .toBe('dismissed in Review: user_jamie turned this proposal down on 2026-10-24');
    expect(readRecordDecision({ by: 'x' })).toBeNull();
  });
});
