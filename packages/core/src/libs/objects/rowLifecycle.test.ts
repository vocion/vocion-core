import { describe, expect, it } from 'vitest';
import { hasRowLifecycle, isFinishedStatus, offersOwedVerbs } from './rowLifecycle';

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
});
