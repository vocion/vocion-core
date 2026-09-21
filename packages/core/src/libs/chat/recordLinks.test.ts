import { describe, expect, it } from 'vitest';
import { appendRecordLinks } from './recordLinks';

const room = { type: 'object' as const, id: '22', label: 'Northwind — Hiring agents', href: '/dashboard/rooms/22' };

describe('appendRecordLinks', () => {
  it('adds a link for a created record the answer never linked', () => {
    expect(appendRecordLinks('Room\'s built. Here\'s what\'s in it.', [room])).toBe('Room\'s built. Here\'s what\'s in it.\n\n[Northwind — Hiring agents](/dashboard/rooms/22)');
  });

  it('leaves an answer alone when it already links the record, and dedupes repeats', () => {
    const text = 'Opened [the room](/dashboard/rooms/22).';

    expect(appendRecordLinks(text, [room, room])).toBe(text);
    expect(appendRecordLinks('x', [room, room])).toBe('x\n\n[Northwind — Hiring agents](/dashboard/rooms/22)');
  });

  it('skips records with no page to link', () => {
    expect(appendRecordLinks('x', [{ type: 'object', id: '3' }])).toBe('x');
  });
});
