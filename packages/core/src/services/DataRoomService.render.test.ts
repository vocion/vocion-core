import type { DataRoomDetail } from './DataRoomService';
import type { ArtifactRow } from '@/services/ArtifactService';
import type { Ask } from '@/services/AskService';
import { describe, expect, it } from 'vitest';
import { mergeRules, renderDataRoom, roomAnchor } from './DataRoomService';

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
    const order = ['## Rules for this room', '> **Status as of 2026-09-16.**', '## Notes', '## Sources', '## Timeline', '## Highlights', '## Open items', '## 2026-09-16 · weekly sync — decision log', '## Documents', '## Working files'].map(at);

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
    expect(md).toContain('- Proposal · v3 · 9 sheets · verified');
    expect(md).toContain('- Platform architecture v0.2 · markdown · v1 · architecture:v0.2');
    // A pasted source is a source, listed once with its weight — not a working file.
    expect(md.split('Pasted scope note').length - 1).toBe(1);
  });
});

describe('roomAnchor', () => {
  it('reads the new shape first and the legacy deal as an anchor of type deal', () => {
    expect(roomAnchor({ anchor: { type: 'project', id: 'p1' } })).toEqual({ type: 'project', id: 'p1' });
    expect(roomAnchor({ deal: { system: 'hubspot', id: '9', amount: 5 } })).toEqual({ type: 'deal', system: 'hubspot', id: '9', amount: 5 });
    expect(roomAnchor({})).toBeNull();
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
