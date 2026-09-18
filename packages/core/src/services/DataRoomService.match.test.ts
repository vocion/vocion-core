import type { DataRoom } from './DataRoomService';
import { describe, expect, it } from 'vitest';
import { domainsIn, MATCH_HIGH, MATCH_MEDIUM, scoreRooms } from './DataRoomService';

/**
 * The confidence rules behind filing. Pure: rooms in, verdict out. The
 * thresholds are what decide whether a transcript lands in a room on its own,
 * waits for a person, or proposes a new room — so they are pinned here.
 */

const room = (id: number, meta: DataRoom['meta'], status: string | null = 'active'): DataRoom => ({ id, title: `Room ${id}`, status, meta, createdAt: new Date(), updatedAt: null });

const northwind = room(1, { client: 'Northwind', aliases: ['northwind logistics'], domains: ['northwind.example'], cast: [{ name: 'Amy Larkin', email: 'amy@northwind.example' }] });
const kestrel = room(2, { client: 'Kestrel Capital', codename: 'Project Falcon', domains: ['kestrel.example'] });
const closed = room(3, { client: 'Contoso', domains: ['contoso.example'] }, 'closed');

describe('domainsIn', () => {
  it('finds distinct company domains and ignores personal mail', () => {
    expect(domainsIn('From: amy@northwind.example, pat@gmail.com, jo@Northwind.example')).toEqual(['northwind.example']);
  });
});

describe('scoreRooms', () => {
  it('a domain hit plus the name in the title is a clear match — files on its own', () => {
    const out = scoreRooms([northwind, kestrel], { title: 'Northwind — third call', emails: ['amy@northwind.example'] });

    expect(out.best?.room.id).toBe(1);
    expect(out.best!.score).toBeGreaterThanOrEqual(MATCH_HIGH);
    expect(out.confidence).toBe('high');
    expect(out.best!.evidence).toEqual(expect.arrayContaining([expect.stringContaining('domain northwind.example'), expect.stringContaining('in the title')]));
  });

  it('a codename in the title alone is plausible, not clear — a person confirms', () => {
    const out = scoreRooms([northwind, kestrel], { title: 'Project Falcon sync' });

    expect(out.best?.room.id).toBe(2);
    expect(out.confidence).toBe('medium');
    expect(out.best!.score).toBeGreaterThanOrEqual(MATCH_MEDIUM);
    expect(out.best!.score).toBeLessThan(MATCH_HIGH);
  });

  it('two rooms neck and neck are never a clear match', () => {
    const both = room(4, { client: 'Northwind', domains: ['northwind.example'] });
    const out = scoreRooms([northwind, both], { title: 'Northwind — third call', emails: ['amy@northwind.example'] });

    expect(out.candidates).toHaveLength(2);
    expect(out.confidence).toBe('medium');
  });

  it('nothing in common is no match — a new-opportunity proposal, not a room', () => {
    const out = scoreRooms([northwind, kestrel], { title: 'Weekly standup', text: 'internal notes' });

    expect(out.candidates).toEqual([]);
    expect(out.confidence).toBe('none');
  });

  it('a closed room is never a candidate, and a cast email counts', () => {
    const out = scoreRooms([closed, northwind], { title: 'call', text: 'attendees: amy@northwind.example and two others' });

    expect(out.candidates.map(c => c.room.id)).toEqual([1]);
    expect(out.best!.evidence.some(e => e.includes('on the cast'))).toBe(true);
  });
});
