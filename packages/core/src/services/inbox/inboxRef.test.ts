import { describe, expect, it } from 'vitest';
import { inboxHref, inboxRef, parseInboxRef } from './inboxRef';

/**
 * The detail route resolves a row by the kind in its ref. A bare number stays
 * an ask — every link the API, the mail job and Slack ever wrote has that
 * shape — and every other kind spells itself out.
 */
describe('inboxRef', () => {
  it('round-trips every kind', () => {
    expect(inboxRef('ask', 42)).toBe('42');
    expect(inboxRef('proposal', 123)).toBe('proposal-123');
    expect(inboxHref('mission', 5)).toBe('/dashboard/inbox/mission-5');

    for (const kind of ['ask', 'proposal', 'mission', 'workflow', 'worker', 'learning'] as const) {
      expect(parseInboxRef(inboxRef(kind, 7))).toEqual({ kind, id: 7 });
    }
  });

  it('reads a bare number and an explicit ask- prefix as the same ask', () => {
    expect(parseInboxRef('42')).toEqual({ kind: 'ask', id: 42 });
    expect(parseInboxRef('ask-42')).toEqual({ kind: 'ask', id: 42 });
    expect(parseInboxRef(encodeURIComponent('proposal-9'))).toEqual({ kind: 'proposal', id: 9 });
  });

  it('rejects anything that names nothing', () => {
    expect(parseInboxRef('review-1')).toBeNull();
    expect(parseInboxRef('proposal-')).toBeNull();
    expect(parseInboxRef('proposal-0')).toBeNull();
    expect(parseInboxRef('abc')).toBeNull();
    expect(parseInboxRef('')).toBeNull();
    expect(parseInboxRef('proposal-1; drop table')).toBeNull();
  });
});
