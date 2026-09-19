import type { ArtifactRow } from '@/services/ArtifactService';
import type { DataRoom } from '@/services/DataRoomService';
import { describe, expect, it } from 'vitest';
import { latestDocument, proposalRows, proposalRowView, proposalStage, unanchoredDeliverables } from './board';

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

  it('says whether a sceptical buyer has read this version, and what they found', () => {
    const unread = doc(20, { spec: { sheets: 7, verification: { ok: true, sheets: Array.from({ length: 7 }), issues: [] } } });
    const blocked = doc(21, { spec: { sheets: 7, redTeam: { at: '2026-09-19T10:00:00.000Z', version: 2, model: 'test-model', sheets: 7, blocks: 2, fixes: 0, considers: 0, findings: [] } } });
    const clean = doc(22, { spec: { sheets: 7, redTeam: { at: '2026-09-19T10:00:00.000Z', version: 2, model: 'test-model', sheets: 7, blocks: 0, fixes: 0, considers: 1, findings: [] } } });

    expect(latestDocument([unread])).toMatchObject({ redTeam: 'unread', redTeamLabel: 'not read as the buyer' });
    expect(latestDocument([blocked])).toMatchObject({ redTeam: 'blocking', redTeamLabel: 'read as the buyer · 2 blocking' });
    expect(latestDocument([clean])).toMatchObject({ redTeam: 'clean', redTeamLabel: 'read as the buyer · clean' });
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

describe('unanchoredDeliverables', () => {
  it('names the deliverable artifacts a room lists but does not anchor, and skips the ones it does', () => {
    const room = { id: 22, meta: { deliverables: [{ title: 'v2', artifactId: 251 }, { title: 'v1', artifactId: 250 }, { title: 'planned' }] } } as unknown as DataRoom;
    const anchored = new Map<number, ArtifactRow[]>([[22, [{ id: 251 } as ArtifactRow]]]);

    expect([...unanchoredDeliverables([room], anchored).entries()]).toEqual([[250, 22]]);
    expect(unanchoredDeliverables([room], new Map([[22, [{ id: 250 } as ArtifactRow, { id: 251 } as ArtifactRow]]])).size).toBe(0);
  });
});

describe('proposalRowView — the whole matrix, one glance each', () => {
  const NOW = Date.parse('2026-09-19T12:00:00Z');
  const MOVED = new Date('2026-09-15T12:00:00Z');
  const verification = (ok: boolean, n = 7) => ({ ok, sheets: Array.from({ length: n }), issues: ok ? [] : ['footer moved on sheet 3', 'sheet 5 overflows'] });
  const read = (blocks: number, fixes: number) => ({ at: '2026-09-19T10:00:00.000Z', version: 2, model: 'test-model', sheets: 7, blocks, fixes, considers: 0, findings: [] });

  const VERIFY = {
    unverified: { spec: {}, label: 'Not verified', tone: 'neutral' },
    verified: { spec: { verification: verification(true) }, label: 'Verified', tone: 'pass' },
    issues: { spec: { verification: verification(false) }, label: '2 issues', tone: 'amber' },
  } as const;
  const RED = {
    'not read': { spec: {}, label: 'Not read', tone: 'neutral' },
    'read clean': { spec: { redTeam: read(0, 0) }, label: 'Read · clean', tone: 'pass' },
    'blocks': { spec: { redTeam: read(2, 0) }, label: 'Read · 2 blocking', tone: 'fail' },
  } as const;

  const rowFor = (stage: string, verify: keyof typeof VERIFY, red: keyof typeof RED) => {
    const a = doc(40, { title: 'Northwind — Proposal', updatedAt: MOVED, currentVersion: 3, spec: { ...VERIFY[verify].spec, ...RED[red].spec } });
    const r = room(1, { client: 'Northwind Logistics', stage, statusAt: '2026-09-16' });
    return proposalRows([r], new Map([[1, [a]]]), new Map([[1, 2]]))[0]!;
  };

  it('leads with the DOCUMENT, and says its verify verdict and its buyer read in every combination', () => {
    for (const stage of ['Proposal', 'Proposal sent'] as const) {
      for (const verify of ['unverified', 'verified', 'issues'] as const) {
        for (const red of ['not read', 'read clean', 'blocks'] as const) {
          const v = proposalRowView(rowFor(stage, verify, red), NOW);

          expect(v.subject).toBe('document');
          expect(v.title).toBe('Northwind — Proposal');
          expect(v.verify).toEqual({ label: VERIFY[verify].label, tone: VERIFY[verify].tone });
          expect(v.redTeam).toEqual({ label: RED[red].label, tone: RED[red].tone });
          expect(v.state.label).toBe(stage === 'Proposal sent' ? 'Sent' : 'Drafted');
          expect(v.age).toBe('4 days ago');
          // The room is the context, not the headline.
          expect(v.subline).toContain('Room 1');
          expect(v.subline).toContain('v3');
          expect(v.subline).toContain('status 2026-09-16');
          expect(v.openItems).toBe(2);
        }
      }
    }
  });

  it('a row with nothing drafted reads differently: the engagement leads, the state says so, every column is empty', () => {
    const r = proposalRows([room(9, { client: 'Kestrel Capital', stage: 'Proposal', statusAt: '2026-09-17' })], new Map(), new Map())[0]!;

    const v = proposalRowView(r, NOW);

    expect(v).toMatchObject({
      subject: 'none',
      title: 'Room 9',
      state: { label: 'Nothing drafted', tone: 'amber' },
      verify: null,
      redTeam: null,
      age: '3 days ago',
      openItems: 0,
    });
    expect(v.subline).toEqual(['Kestrel Capital', 'Proposal', 'at this stage since 2026-09-17']);
  });

  it('the room\'s deliverables say whether it went out; a room at Proposal stage never downgrades a sent document', () => {
    const a = doc(50, { title: 'Proposal', updatedAt: MOVED, spec: { verification: verification(true) } });
    const sent = room(2, { client: 'Contoso Supply', stage: 'Proposal', statusAt: '2026-09-16', deliverables: [{ title: 'Proposal — v2.0 (4-month scope)', artifactId: 50, status: 'sent', date: '2026-09-18' }] });
    const signed = room(3, { client: 'Contoso Supply', stage: 'Proposal', statusAt: '2026-09-16', deliverables: [{ title: 'Proposal', artifactId: 50, status: 'signed' }] });

    expect(proposalRowView(proposalRows([sent], new Map([[2, [a]]]), new Map())[0]!, NOW).state).toEqual({ label: 'Sent', tone: 'pass' });
    expect(proposalRowView(proposalRows([signed], new Map([[3, [a]]]), new Map())[0]!, NOW).state).toEqual({ label: 'Signed', tone: 'pass' });
  });

  it('dates what it says: the sheet count and the status date are on the row, not only in a tooltip', () => {
    const v = proposalRowView(rowFor('Proposal', 'verified', 'read clean'), NOW);

    expect(v.subline).toEqual(['Northwind Logistics', 'Room 1', 'v3', '7 sheets', 'status 2026-09-16']);
  });
});
