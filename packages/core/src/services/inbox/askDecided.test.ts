import { describe, expect, it } from 'vitest';
import { askDecidedPayload, listenersFor, statusForDecision } from './askDecided';

/**
 * The decision page previews what each answer starts by matching the SAME
 * payload `AskService.announceDecided` emits against the same filters
 * `emitEvent` applies. The subscriber names are fictional.
 */

const ask = {
  id: 41,
  kind: 'recommendation',
  agentSlug: 'product-manager',
  teamSlug: 'software-factory',
  groupKey: null,
  sourceRef: 'action_run:9001',
  objectRefs: [{ type: 'request', id: '7' }],
};

describe('what an answer starts', () => {
  it('matches the factory decision automation on the PM\'s recommendation, for every answer', () => {
    const got = listenersFor(ask, ['approve', 'reject', 'done'], [
      { name: 'A build decision landed', event: 'ask.decided', filter: { agentSlug: 'product-manager', kind: 'recommendation' } },
      { name: 'Merge landed', event: 'pr.merged', filter: {} },
    ]);

    expect(got).toEqual({
      approve: ['A build decision landed'],
      reject: ['A build decision landed'],
      done: ['A build decision landed'],
    });
  });

  it('reads the status each answer writes, so a filter on status splits them', () => {
    const got = listenersFor(ask, ['approve', 'reject', 'platform'], [
      { name: 'Ship on yes', event: ['ask.decided', 'plan.approved'], filter: { status: 'approved' } },
    ]);

    expect(got).toEqual({ approve: ['Ship on yes'], reject: [], platform: [] });
  });

  it('finds nothing for an ask filed by a person in chat, with no asking agent', () => {
    const got = listenersFor({ ...ask, kind: 'ruling', agentSlug: null, teamSlug: null }, ['approve'], [
      { name: 'A build decision landed', event: 'ask.decided', filter: { agentSlug: 'product-manager', kind: 'recommendation' } },
    ]);

    expect(got).toEqual({ approve: [] });
  });

  it('builds the payload the event carries', () => {
    const at = new Date('2026-09-29T15:00:00Z');

    expect(askDecidedPayload({ ...ask, status: 'approved', decision: 'approve', followUp: false, decidedBy: 'usr-1', decidedAt: at })).toEqual({
      askId: 41,
      kind: 'recommendation',
      status: 'approved',
      decision: 'approve',
      followUp: false,
      agentSlug: 'product-manager',
      teamSlug: 'software-factory',
      groupKey: null,
      sourceRef: 'action_run:9001',
      objectRefs: [{ type: 'request', id: '7' }],
      decidedBy: 'usr-1',
      decidedAt: '2026-09-29T15:00:00.000Z',
    });
    expect(statusForDecision('other')).toBe('done');
  });
});
