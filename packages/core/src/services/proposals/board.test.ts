import type { ArtifactRow } from '@/services/ArtifactService';
import type { DataRoom } from '@/services/DataRoomService';
import { describe, expect, it } from 'vitest';
import { latestDocument, proposalRows, proposalStage } from './board';

const room = (id: number, meta: DataRoom['meta'], status: string | null = 'active', updatedAt: Date | null = null): DataRoom =>
  ({ id, title: `Room ${id}`, status, meta, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt });

const doc = (id: number, over: Partial<ArtifactRow> = {}): ArtifactRow => ({
  id,
  kind: 'document',
  title: `Doc ${id}`,
  spec: {},
  currentVersion: 1,
  conversationId: null,
  createdAt: new Date('2026-09-10T00:00:00Z'),
  updatedAt: null,
  ...over,
} as ArtifactRow);

const northwind = room(1, { client: 'Northwind Logistics', stage: 'Proposal', status: 'Third call held; pricing per open role.', statusAt: '2026-09-16' });
const kestrel = room(2, { client: 'Kestrel Capital', stage: 'Proposal sent', statusAt: '2026-09-17' });
const contoso = room(3, { client: 'Contoso Supply', stage: 'Discovery' });
const closed = room(4, { client: 'Bellwater Hall', stage: 'Proposal' }, 'closed');

describe('proposalStage', () => {
  it('reads the CRM\'s own words — any proposal stage counts, sent is its own state', () => {
    expect(proposalStage('Proposal')).toBe('drafting');
    expect(proposalStage('Proposal — in review')).toBe('drafting');
    expect(proposalStage('Proposal sent')).toBe('sent');
    expect(proposalStage('proposal submitted')).toBe('sent');
    expect(proposalStage('Discovery')).toBeNull();
    expect(proposalStage('Signed')).toBeNull();
    expect(proposalStage(undefined)).toBeNull();
  });
});

describe('latestDocument', () => {
  it('picks the newest document and reads its verify state off the receipt', () => {
    const older = doc(10, { spec: { sheets: 7, verification: { ok: true, sheets: Array.from({ length: 7 }), issues: [] } } });
    const newer = doc(11, { updatedAt: new Date('2026-09-17T00:00:00Z'), spec: { sheets: 6, verification: { ok: false, sheets: Array.from({ length: 6 }), issues: ['footer moved on sheet 3'] } }, conversationId: 118, currentVersion: 4 });

    const d = latestDocument([older, newer, doc(12, { kind: 'file' } as Partial<ArtifactRow>)]);

    expect(d).toMatchObject({ id: 11, verify: 'issues', version: 4, href: '/dashboard/chat/118?artifact=11' });
    expect(d!.chip).toContain('1 issue');
    expect(latestDocument([older])!.verify).toBe('verified');
    expect(latestDocument([doc(13)])!.verify).toBe('unverified');
    expect(latestDocument([])).toBeNull();
  });
});

describe('proposalRows', () => {
  it('keeps proposal-stage rooms only, freshest status first, with the document and open-item count', () => {
    const artifacts = new Map<number, ArtifactRow[]>([[1, [doc(20, { spec: { sheets: 5, verification: { ok: true, sheets: Array.from({ length: 5 }), issues: [] } } })]]]);
    const open = new Map<number, number>([[1, 2]]);

    const rows = proposalRows([northwind, kestrel, contoso, closed], artifacts, open);

    expect(rows.map(r => r.id)).toEqual([2, 1]);
    expect(rows[1]).toMatchObject({ client: 'Northwind Logistics', stage: 'drafting', stageLabel: 'Proposal', openItems: 2, href: '/dashboard/rooms/1' });
    expect(rows[1]!.document).toMatchObject({ id: 20, verify: 'verified' });
    expect(rows[0]).toMatchObject({ stage: 'sent', document: null, openItems: 0 });
    expect(rows[0]!.record).toEqual({ type: 'object', id: '2', label: 'Room 2', href: '/dashboard/rooms/2' });
  });
});
