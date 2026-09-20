import type { DataRoomDetail } from './DataRoomService';
import type { ArtifactRow } from '@/services/ArtifactService';
import type { Ask } from '@/services/AskService';
import { describe, expect, it } from 'vitest';
import { deliverableIndex, mergeBrand, mergeRules, renderDataRoom, roomAnchor, roomDeliverables } from './DataRoomService';

/**
 * The bundle the agent reads and a person downloads: order and sections. The
 * rules come first because they govern everything under them; an auto filing
 * says so, with its score; working files that are neither documents nor
 * decision logs still appear.
 */

const artifact = (id: number, over: Partial<ArtifactRow>): ArtifactRow => ({ id, kind: 'markdown', title: `A${id}`, spec: {}, currentVersion: 1, conversationId: null, recordRole: null, url: null, createdAt: new Date('2026-09-10T00:00:00Z'), updatedAt: null, ...over } as ArtifactRow);

const detail: DataRoomDetail = {
  id: 7,
  title: 'Northwind — Hiring agents',
  status: 'active',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: null,
  meta: {
    client: 'Northwind Logistics',
    stage: 'Proposal',
    status: 'Third call held.',
    statusAt: '2026-09-16T10:00:00Z',
    anchor: { type: 'deal', system: 'hubspot', id: '100', label: 'Northwind — Hiring agents', amount: 120000 },
    rules: ['Call the product "Managed AI".', 'Openings are ~20 a month, not a dozen.'],
    deliverables: [
      // Names artifact 21 — the room said this twice, once as prose and once
      // by anchoring the document. The artifact is the truth.
      { title: 'Proposal — v2.0 (CV model + iPad checklist, 4-month scope)', artifactId: 21, status: 'sent', date: '2026-09-18' },
      { title: 'Case study', status: 'planned' },
    ],
    notes: '## Where things are\n\nPricing lives in the 09-16 log.',
    sources: [
      { documentId: 1, title: 'Northwind — weekly sync', kind: 'transcript', rating: 2, channel: 'zoom', date: '2026-09-16', retrievedAt: '2026-09-16T18:00:00Z', filedBy: 'auto', score: 0.82, evidence: ['domain northwind.example', '"northwind" in the title'] },
      { artifactId: 2, title: 'Pasted scope note', kind: 'note', rating: 3, retrievedAt: '2026-09-15T18:00:00Z', filedBy: 'human' },
    ],
    milestones: [{ date: '2026-09-20', title: 'Proposal sent', status: 'planned' }, { date: '2026-09-02', title: 'Discovery call', status: 'done' }],
    highlights: [{ kind: 'quote', text: 'We work on a monthly fee for managed AI services.', who: 'Amy Larkin', date: '2026-09-16', addedAt: '2026-09-16T18:00:00Z' }],
  },
  artifacts: [
    artifact(20, { recordRole: 'decision-log:1', title: '2026-09-16 · weekly sync — decision log', spec: { md: '1. Volume is ~20.' } }),
    artifact(21, { kind: 'document', title: 'Proposal', spec: { sheets: 9, verification: { ok: true } }, currentVersion: 3 }),
    artifact(22, { recordRole: 'architecture:v0.2', title: 'Platform architecture v0.2', kind: 'markdown' }),
    artifact(23, { recordRole: 'source:Pasted scope note', title: 'Pasted scope note' }),
  ],
  items: [{ id: 5, title: 'Confirm openings per month', status: 'open', risk: 'high', body: 'Amy said ~20.' } as Ask, { id: 6, title: 'Send the deck', status: 'done', risk: 'low', decisionNote: 'sent 09-15' } as Ask],
};

describe('renderDataRoom', () => {
  const md = renderDataRoom(detail);
  const at = (s: string) => md.indexOf(s);

  it('orders the bundle: rules, status, notes, sources, timeline, highlights, items, logs, documents, working files', () => {
    const order = ['## Rules for this room', '> **Status as of 2026-09-16.**', '## Notes', '## Promised', '## Sources', '## Timeline', '## Highlights', '## Open items', '## 2026-09-16 · weekly sync — decision log', '## Documents', '## Working files'].map(at);

    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shows the anchor, the auto filing with its score and evidence, and the timeline in date order', () => {
    expect(md).toContain('Anchor: deal "Northwind — Hiring agents" in hubspot (100) · $120,000');
    expect(md).toContain('⭐⭐⭐ Pasted scope note — note, filed 2026-09-15');
    expect(md).toContain('filed automatically at 82% (domain northwind.example, "northwind" in the title)');
    expect(at('| 2026-09-02 | Discovery call | done |')).toBeLessThan(at('| 2026-09-20 | Proposal sent | planned |'));
    expect(md).toContain('- **quote** · "We work on a monthly fee for managed AI services." — Amy Larkin, 2026-09-16');
    expect(md).toContain('1. 🔴 Confirm openings per month — Amy said ~20.');
    expect(md).toContain('- ~~Send the deck~~ (done: sent 09-15)');
    expect(md).toContain('- Proposal · v3 · sent 2026-09-18 · 9 sheets · verified');
    expect(md).toContain('- Platform architecture v0.2 · markdown · v1 · architecture:v0.2');
    // A pasted source is a source, listed once with its weight — not a working file.
    expect(md.split('Pasted scope note').length - 1).toBe(1);
  });

  it('says a deliverable once: the one with an artifact IS the document row, the one without is still only promised', () => {
    expect(md).not.toContain('## Deliverables');
    expect(md).toContain('- Case study — planned');
    // The prose line for artifact 21 is gone; its state and date moved onto
    // the document, which is the one thing that exists.
    expect(md).not.toContain('CV model + iPad checklist');
    expect(md.split('## Promised').length - 1).toBe(1);
  });
});

describe('roomAnchor', () => {
  it('reads the new shape first and the legacy deal as an anchor of type deal', () => {
    expect(roomAnchor({ anchor: { type: 'project', id: 'p1' } })).toEqual({ type: 'project', id: 'p1' });
    expect(roomAnchor({ deal: { system: 'hubspot', id: '9', amount: 5 } })).toEqual({ type: 'deal', system: 'hubspot', id: '9', amount: 5 });
    expect(roomAnchor({})).toBeNull();
  });
});

describe('roomDeliverables', () => {
  const pdf = artifact(31, { kind: 'file', title: 'Proposal.pdf' });
  const proposal = artifact(30, { kind: 'document', title: 'Proposal', currentVersion: 4 });
  const log = artifact(32, { kind: 'markdown', recordRole: 'decision-log:1' });

  it('renders a deliverable that has an artifact AS that artifact, carrying its state and date', () => {
    const split = roomDeliverables([proposal, log], [{ title: 'Proposal — v2.0 (4-month scope)', artifactId: 30, status: 'sent', date: '2026-09-18' }]);

    expect(split.documents).toHaveLength(1);
    expect(split.documents[0]).toMatchObject({ state: 'sent', date: '2026-09-18' });
    expect(split.documents[0]!.artifact.id).toBe(30);
    expect(split.documents[0]!.deliverable!.title).toContain('4-month scope');
    // Said once: it is not also a promise.
    expect(split.promised).toEqual([]);
  });

  it('a deliverable with no artifact is a commitment nobody has produced, and survives', () => {
    const split = roomDeliverables([proposal], [{ title: 'Case study', status: 'planned' }, { title: 'SOW', date: '2026-10-01' }]);

    expect(split.promised.map(d => d.title)).toEqual(['Case study', 'SOW']);
    expect(split.documents[0]).toMatchObject({ state: 'drafted', deliverable: null });
  });

  it('a file that exists is at least drafted — planned never describes a thing you can open', () => {
    expect(roomDeliverables([proposal], [{ title: 'Proposal', artifactId: 30, status: 'planned' }]).documents[0]!.state).toBe('drafted');
    expect(roomDeliverables([proposal], [{ title: 'Proposal', artifactId: 30, status: 'signed' }]).documents[0]!.state).toBe('signed');
  });

  it('collapses two lines naming one artifact to the newest, and keeps a line whose artifact is not on this room', () => {
    const legacy = [
      { title: 'Proposal v2.0', artifactId: 30, status: 'sent' as const },
      { title: 'Proposal v1.0', artifactId: 30, status: 'drafted' as const },
      { title: 'Deck', artifactId: 99 },
    ];
    const split = roomDeliverables([proposal, pdf], legacy);

    expect(split.documents.map(d => d.artifact.id)).toEqual([30, 31]);
    expect(split.documents[0]!.deliverable!.title).toBe('Proposal v2.0');
    expect(split.documents[0]!.state).toBe('sent');
    // The PDF nobody promised is still a document; the deliverable pointing
    // somewhere else is still visible rather than silently dropped.
    expect(split.documents[1]).toMatchObject({ state: 'drafted', deliverable: null });
    expect(split.promised.map(d => d.title)).toEqual(['Deck']);
  });
});

describe('deliverableIndex', () => {
  const list = [
    { title: 'Proposal v2.0 (4-month scope)', artifactId: 30, status: 'drafted' as const },
    { title: 'Case study', status: 'planned' as const },
  ];

  it('replaces the line for the same ARTIFACT however the prose changed', () => {
    expect(deliverableIndex(list, { title: 'Proposal v3.0 (6-month scope)', artifactId: 30, status: 'sent' })).toBe(0);
  });

  it('turns a promise into the document line when the artifact arrives under the same name', () => {
    expect(deliverableIndex(list, { title: 'case study', artifactId: 77, status: 'drafted' })).toBe(1);
  });

  it('is a new line when neither the artifact nor the name is known', () => {
    expect(deliverableIndex(list, { title: 'SOW', artifactId: 88 })).toBe(-1);
    expect(deliverableIndex(list, { title: 'SOW' })).toBe(-1);
    expect(deliverableIndex([], { title: 'Proposal', artifactId: 30 })).toBe(-1);
  });

  it('a promise with no artifact still matches on its title, as it always did', () => {
    expect(deliverableIndex(list, { title: 'Case study', status: 'planned' })).toBe(1);
  });
});

describe('mergeRules', () => {
  it('removes first, then adds — so replacing the list keeps a rule present in both', () => {
    const existing = ['Call the product Managed AI.', 'Never quote headcount.'];

    expect(mergeRules(existing, ['Call the product Managed AI.', 'Openings are ~20 a month.'], existing)).toEqual(['Call the product Managed AI.', 'Openings are ~20 a month.']);
    expect(mergeRules(existing, ['  Never quote headcount. '], undefined)).toEqual(existing);
    expect(mergeRules(existing, undefined, ['Never quote headcount.'])).toEqual(['Call the product Managed AI.']);
    expect(mergeRules(undefined, ['a', '', 'a'], undefined)).toEqual(['a']);
  });
});

/**
 * The client's brand lives on the room, not on one document — so the logo is
 * fetched once and every later proposal written from that room uses the same
 * mark instead of inventing a wordmark (2026-09-19).
 */
describe('client brand on the room', () => {
  const logo = { dataUri: 'data:image/png;base64,iVBORw0KG', width: 240, height: 60, bytes: 3072, contentType: 'image/png', source: 'https://northwind.example/logo.png', fetchedAt: '2026-09-19T09:00:00Z', url: '/api/artifacts/x/y.png' };
  const mark = { ...logo, width: 64, height: 64, source: 'https://northwind.example/mark.svg', contentType: 'image/svg+xml', dataUri: 'data:image/svg+xml;base64,PHN2Zw' };

  it('replaces one slot and leaves the other alone', () => {
    expect(mergeBrand({ logo }, 'mark', mark)).toEqual({ logo, mark });
    expect(mergeBrand({ logo, mark }, 'logo', { ...logo, source: 'https://northwind.example/v2.png' }).logo?.source).toBe('https://northwind.example/v2.png');
    expect(mergeBrand(undefined, 'logo', logo)).toEqual({ logo });
  });

  it('prints the data URI in full, with where it came from and when', () => {
    const md = renderDataRoom({ ...detail, meta: { ...detail.meta, brand: { logo } } });

    expect(md).toContain('## Client brand');
    expect(md).toContain(logo.dataUri);
    expect(md).toContain('240×60');
    expect(md).toContain('https://northwind.example/logo.png');
    expect(md).toContain('2026-09-19');
    expect(md).toContain('Do not redraw the mark as text');
  });

  it('says nothing at all when the room has no brand', () => {
    expect(renderDataRoom(detail)).not.toContain('## Client brand');
  });
});
