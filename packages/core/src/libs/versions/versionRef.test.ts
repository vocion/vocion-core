/**
 * A version as a place (backlog 035): the ref id, the link, and the line the
 * answer gets — joined to a "Changed …" line when the answer ends on one.
 */
import { describe, expect, it } from 'vitest';
import { historyRefId, parseHistoryRefId, versionHistoryHref, versionLinksDelta } from './versionRef';

describe('history refs', () => {
  it('round-trips a version and the whole history', () => {
    expect(historyRefId(214, 5)).toBe('214@5');
    expect(historyRefId(214)).toBe('214');
    expect(parseHistoryRefId('214@5')).toEqual({ objectId: 214, version: 5 });
    expect(parseHistoryRefId('214')).toEqual({ objectId: 214, version: null });
    expect(parseHistoryRefId('x@5')).toBeNull();
    expect(versionHistoryHref(214, 5)).toBe('/dashboard/objects/214?preview=record_history%3A214%405');
  });
});

describe('versionLinksDelta', () => {
  const v = { ref: { type: 'object' as const, id: '214', label: 'request #214' }, to: 5 };

  it('joins the link to the answer\'s "Changed …" line', () => {
    expect(versionLinksDelta('Changed [request #214](/dashboard/p/feature/214): added a CSV column.', [v]))
      .toBe(' [Version 5 in its history](/dashboard/objects/214?preview=record_history%3A214%405).');
  });

  it('adds its own line otherwise, one per record at its newest version', () => {
    expect(versionLinksDelta('Done — the criterion now names the file.', [{ ...v, to: 4 }, v]))
      .toBe('\n\nChanged request #214 — [version 5 in its history](/dashboard/objects/214?preview=record_history%3A214%405).');
  });

  it('owes nothing when the answer already links it, or nothing was a record', () => {
    expect(versionLinksDelta('See /dashboard/objects/214?preview=record_history%3A214%405', [v])).toBe('');
    expect(versionLinksDelta('Updated the table.', [{ ref: { type: 'artifact', id: '9' }, to: 2 }])).toBe('');
  });
});
