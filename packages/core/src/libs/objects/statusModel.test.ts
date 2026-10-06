import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { REQUEST_STATUSES } from './requestStatuses.fixture';
import { createdStatus, followedStatus, groupOf, placeOf, readStatusModel, reopens, valueFor, withFollowedStatus } from './statusModel';

/**
 * One status field, read from the type (Chris, 2026-10-02). Core names no
 * value here; every case reads the software factory's request type.
 */

const REQUEST = parse(readFileSync(join(process.cwd(), 'templates/plugins/software-factory/objects/request/type.yaml'), 'utf8')).schema;
const MODEL = readStatusModel(REQUEST)!;

describe('the request type declares one status', () => {
  it('reads the field, its groups, labels, tones, who it waits on and its transitions', () => {
    expect(MODEL.field).toBe('status');
    expect(MODEL.groups.map(g => [g.key, g.role, g.label])).toEqual([
      ['progress', 'progress', 'In progress'],
      ['proposed', 'proposed', 'Proposed'],
      ['done', 'done', 'Done'],
      ['archived', 'archived', 'Archived'],
    ]);
    expect(MODEL.labels.awaiting_merge).toBe('Waiting on your merge');
    expect(MODEL.tones.stopped).toBe('bad');
    expect([...MODEL.needsYou]).toEqual(['deciding', 'changes_asked', 'awaiting_merge', 'stopped']);
  });

  it('puts every enum value in exactly one group, with a label and a tone', () => {
    const values = REQUEST.properties.status.enum as string[];
    const grouped = MODEL.groups.flatMap(g => g.in);

    expect([...grouped].sort()).toEqual([...values].sort());
    expect(new Set(grouped).size).toBe(grouped.length);

    for (const v of values) {
      expect(MODEL.labels[v], v).toBeTruthy();
      expect(MODEL.tones[v], v).toBeTruthy();
    }
  });

  it('writes only values the enum allows', () => {
    const values = new Set(REQUEST.properties.status.enum as string[]);

    for (const [name, value] of MODEL.transitions) {
      expect(values.has(value), `${name} → ${value}`).toBe(true);
    }
  });

  it('tells the asker only what needs them and the end, each on a transition it declares (Chris, 2026-10-06)', () => {
    const names = new Set(MODEL.transitions.map(([name]) => name));

    expect(Object.keys(MODEL.tell).sort()).toEqual(['live', 'live_seen', 'live_unchecked', 'live_unconfirmed', 'merge_waits', 'resolved', 'stopped']);

    for (const name of Object.keys(MODEL.tell)) {
      expect(names.has(name), name).toBe(true);
    }

    // A send-back retries by itself; nobody is needed, so nobody is told.
    expect(MODEL.tell.live_changes).toBeUndefined();
    expect(MODEL.tell.qa_changes).toBeUndefined();
  });

  it('is what the browser tests read', () => {
    expect(REQUEST_STATUSES).toEqual(MODEL);
  });
});

describe('where a record stands', () => {
  it('a null or unknown status is the default group\'s (In progress)', () => {
    expect(groupOf(MODEL, null).key).toBe('progress');
    expect(groupOf(MODEL, 'made_up').key).toBe('progress');
    expect(placeOf(MODEL, {})).toMatchObject({ value: null, label: 'In progress', tone: 'muted', needsYou: false });
    expect(placeOf(MODEL, { status: 'made_up' })).toMatchObject({ value: 'made_up', label: 'made_up' });
  });

  it('reads a status as its group, label, tone and whose move it is', () => {
    expect(placeOf(MODEL, { status: 'awaiting_merge' })).toMatchObject({ group: { key: 'progress' }, label: 'Waiting on your merge', tone: 'warn', needsYou: true });
    expect(placeOf(MODEL, { status: 'shipped', state: 'building' })).toMatchObject({ group: { key: 'done' }, label: 'Shipped', needsYou: false });
  });

  it('a type with no `x-groups`, or none to default to, declares no status', () => {
    expect(readStatusModel({ properties: { state: { enum: ['a'] } } })).toBeNull();
    expect(readStatusModel({ properties: { status: { 'x-groups': [{ key: 'done', role: 'done', in: ['x'] }] } } })).toBeNull();
    expect(readStatusModel(null)).toBeNull();
  });
});

describe('what each writer writes', () => {
  it('names a transition, and the type says the value', () => {
    expect(valueFor(MODEL, 'review')).toBe('in_qa');
    expect(valueFor(MODEL, 'merge_waits')).toBe('awaiting_merge');
    expect(valueFor(MODEL, 'live')).toBe('seen_live');
    expect(valueFor(MODEL, 'checking_live')).toBeNull();
  });

  it('a write of another field carries the status, first declared match first', () => {
    expect(followedStatus(MODEL, { state: 'triaged' })).toBe('triaged');
    expect(followedStatus(MODEL, { state: 'triaged', recommendationState: 'proposed' })).toBe('deciding');
    // A person's Dismiss writes both; the archive wins.
    expect(followedStatus(MODEL, { state: 'out_of_scope', recommendationState: 'rejected' })).toBe('out_of_scope');
    expect(followedStatus(MODEL, { duplicateOf: 233, state: 'new' })).toBe('duplicate');
    expect(followedStatus(MODEL, { duplicateOf: 0, state: 'new' })).toBe('new');
    expect(followedStatus(MODEL, { priority: 70 })).toBeNull();
    // A write that sets the status itself is not overridden.
    expect(followedStatus(MODEL, { state: 'shipped', status: 'seen_live' })).toBeNull();
  });

  it('carries the status with its time, and clears the last line', () => {
    expect(withFollowedStatus(MODEL, { state: 'deferred' }, '2026-10-02T00:00:00Z')).toEqual({ state: 'deferred', status: 'deferred', statusLine: null, statusAt: '2026-10-02T00:00:00Z' });
    expect(withFollowedStatus(null, { state: 'deferred' })).toEqual({ state: 'deferred' });
  });

  it('a new record starts where its fields put it, else at `created`', () => {
    expect(createdStatus(REQUEST, { title: 'x' }, 'T')).toMatchObject({ status: 'new', statusAt: 'T' });
    expect(createdStatus(REQUEST, { state: 'triaged' }, 'T')).toMatchObject({ status: 'triaged' });
    expect(createdStatus(REQUEST, { status: 'building' }, 'T')).toEqual({ status: 'building' });
    expect(createdStatus({ properties: {} }, { a: 1 })).toEqual({ a: 1 });
  });

  it('an automatic write never moves a finished record back into the work (FE-224)', () => {
    expect(reopens(MODEL, 'shipped', 'building')).toBe(true);
    expect(reopens(MODEL, 'out_of_scope', 'deciding')).toBe(true);
    expect(reopens(MODEL, 'shipped', 'seen_live')).toBe(false);
    expect(reopens(MODEL, 'in_qa', 'awaiting_merge')).toBe(false);
    expect(reopens(MODEL, null, 'building')).toBe(false);
  });
});
