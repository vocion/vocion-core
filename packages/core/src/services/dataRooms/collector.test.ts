import type { DataRoom } from '@/services/DataRoomService';
import { describe, expect, it } from 'vitest';
import { emailsOf, planCollection, planDealRooms, sourceKindOf } from './collector';

/**
 * The collector's decisions, pure: which synced documents file themselves,
 * which wait for a person, which are left alone — and which deals earn a room.
 */

const room = (id: number, meta: DataRoom['meta'], status: string | null = 'active'): DataRoom => ({ id, title: `Room ${id}`, status, meta, createdAt: new Date(), updatedAt: null });

const northwind = room(1, { client: 'Northwind', aliases: ['northwind logistics'], domains: ['northwind.example'], cast: [{ name: 'Amy Larkin', email: 'amy@northwind.example' }] });
const kestrel = room(2, { client: 'Kestrel Capital', codename: 'Project Falcon', domains: ['kestrel.example'] });
const quiet = room(3, { client: 'Contoso', domains: ['contoso.example'], autoFile: false });

const zoom = (id: number, title: string, host: string, text = '') => ({ id, title, metadata: { kind: 'zoom-recording', host, start: '2026-09-16T17:00:00Z' }, text });

describe('sourceKindOf / emailsOf', () => {
  it('reads the connector\'s vocabulary into the room\'s, and leaves CRM records out', () => {
    expect(sourceKindOf({ kind: 'zoom-recording' })).toBe('transcript');
    expect(sourceKindOf({ kind: 'granola-note' })).toBe('transcript');
    expect(sourceKindOf({ kind: 'gmail-thread' })).toBe('email');
    expect(sourceKindOf({ kind: 'drive-file' })).toBe('attachment');
    expect(sourceKindOf({ objectType: 'deals', hubspotId: '1' })).toBeNull();
    expect(emailsOf({ host: 'a@x.example', attendees: ['b@y.example', 'a@x.example'], from: 'c@z.example' })).toEqual(['a@x.example', 'c@z.example', 'b@y.example']);
  });
});

describe('planCollection', () => {
  it('files a clear match with its score and evidence, asks on a plausible one, leaves the rest alone', () => {
    const docs = [
      zoom(10, 'Northwind — weekly sync', 'amy@northwind.example'),
      zoom(11, 'Project Falcon check-in', 'me@metacto.example'),
      zoom(12, 'Internal stand-up', 'me@metacto.example'),
    ];
    const plan = planCollection(docs, [northwind, kestrel], new Map());

    expect(plan[0]).toMatchObject({ action: 'file', roomId: 1, kind: 'transcript', rating: 2, date: '2026-09-16' });
    expect((plan[0] as { score: number }).score).toBeGreaterThanOrEqual(0.75);
    expect((plan[0] as { evidence: string[] }).evidence.join(' ')).toContain('domain northwind.example');
    expect(plan[1]).toMatchObject({ action: 'ask' });
    expect(plan[2]).toMatchObject({ action: 'skip', reason: 'no-match' });
  });

  it('never re-files what is filed, what a person took out, or into a room that opted out', () => {
    const docs = [zoom(10, 'Northwind — weekly sync', 'amy@northwind.example'), zoom(20, 'Contoso kickoff', 'pat@contoso.example'), zoom(30, 'Northwind — pricing', 'amy@northwind.example')];
    const filed = new Map([[10, northwind]]);
    const dismissedNorthwind = room(1, { ...northwind.meta, unfiled: [30] });

    const plan = planCollection(docs, [dismissedNorthwind, quiet], filed);

    expect(plan.map(p => p.action === 'skip' ? p.reason : p.action)).toEqual(['filed', 'no-match', 'unfiled']);
  });

  it('a CRM record is not material — nothing files even when its text names the client', () => {
    const plan = planCollection([{ id: 5, title: 'Northwind Logistics', metadata: { objectType: 'companies', domain: 'northwind.example' } }], [northwind], new Map());

    expect(plan[0]).toMatchObject({ action: 'skip', reason: 'not-material' });
  });
});

describe('planDealRooms', () => {
  const deal = (id: string, title: string, stage: string, extra: Record<string, unknown> = {}) => ({ id: Number(id), title, metadata: { objectType: 'deals', hubspotId: id, dealStageLabel: stage, ...extra } });

  it('opens a room for a proposal-stage deal that has none, anchored to the deal', () => {
    const anchored = room(9, { anchor: { type: 'deal', system: 'hubspot', id: '200' } });
    const legacy = room(8, { deal: { system: 'hubspot', id: '300' } });

    const plan = planDealRooms([
      deal('100', 'Northwind — Hiring agents', 'Proposal', { amount: 120000 }),
      deal('200', 'Kestrel — Deal desk', 'Proposal sent'),
      deal('300', 'Contoso — Ops', 'Proposal'),
      deal('400', 'Bellwater — Discovery', 'Discovery'),
      deal('500', 'Acme — Closed', 'Proposal', { dealClosed: true }),
    ], [anchored, legacy]);

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ title: 'Northwind — Hiring agents', stage: 'Proposal', anchor: { type: 'deal', system: 'hubspot', id: '100', amount: 120000 } });
  });
});
