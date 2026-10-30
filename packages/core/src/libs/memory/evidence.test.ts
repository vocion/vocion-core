/**
 * The evidence graph (ADR 0012): cited claims, typed source edges, freshness
 * read without a model, and the locate / expand walk the agents use.
 */
import type { SourceDoc } from './evidence';
import { describe, expect, it } from 'vitest';
import { CORPUS_DOCS, CORPUS_WIKI, corpusGraph } from '@/services/evals/wikiEvidence/corpus';
import { citeToken, claimsOf, EvidenceGraph, normaliseRef, overviewOf, pageChecks, passageFreshness, passageHash, renderExpanded, sourceEdges, stripCiteTokens, wikiEdges, wikiLinksOf } from './evidence';

const doc = (id: number, title: string, ...passages: string[]): SourceDoc => ({ id, title, uri: `https://docs.example.com/d/${id}`, passages });

describe('tokens and refs', () => {
  it('writes and strips cite tokens, and normalises the ways an agent names a node', () => {
    expect(citeToken(12, 3)).toBe('[src:12.3]');
    expect(citeToken(12)).toBe('[src:12]');
    expect(stripCiteTokens('Refunds take 14 days [src:104.0].')).toBe('Refunds take 14 days.');
    expect(normaliseRef('12')).toBe('doc:12');
    expect(normaliseRef('12.3')).toBe('passage:12.3');
    expect(normaliseRef('[src:12.3]')).toBe('passage:12.3');
    expect(normaliseRef('doc 12')).toBe('doc:12');
    expect(normaliseRef('wiki:travel')).toBe('wiki:travel');
  });

  it('hashes a passage the same whatever its whitespace', () => {
    expect(passageHash('a  b\n c')).toBe(passageHash('a b c'));
    expect(passageHash('a b c')).toHaveLength(16);
  });
});

describe('wiki claims', () => {
  it('reads sentences and list items that carry a token, keeping a token after the full stop with its sentence', () => {
    const md = '# Refunds\n\nCustomers get 14 days. [src:104.0] Nothing cited here.\n\n- Refunds go back to the card [src:104.1]\n\nSee [travel](/wiki/travel.md).';
    const claims = claimsOf('refunds', md);

    expect(claims.map(c => c.text)).toEqual(['Customers get 14 days.', 'Refunds go back to the card']);
    expect(claims[0]!.cites).toEqual([{ docId: 104, chunkIdx: 0 }]);
    expect(wikiLinksOf(md)).toEqual(['travel']);
  });

  it('records the passage hash at write time and drops a cite to a passage that does not exist', () => {
    const { edges, dropped } = wikiEdges({ slug: 'p', md: 'A fact [src:1.0]. A guess [src:9.9].' }, (id, idx) => (id === 1 && idx === 0 ? 'The fact.' : null));
    const cite = edges.find(e => e.edge === 'cites')!;

    expect(cite).toMatchObject({ from: 'claim:p#1', to: 'passage:1.0', toHash: passageHash('The fact.') });
    expect(dropped).toEqual(['[src:9.9]']);
  });
});

describe('source edges', () => {
  it('finds supersedes and amends from a cue and an exact title, and refers_to from a title mention or a link', () => {
    const docs = [
      doc(1, 'Travel Policy 2025', 'Old rules.'),
      doc(2, 'Travel Policy 2026', 'This policy supersedes the Travel Policy 2025.'),
      doc(3, 'Expense Memo', 'This memo amends the Travel Policy 2026 for contractors.'),
      doc(4, 'Hotel Guide', 'Book a hotel within the Travel Policy 2026, see https://docs.example.com/d/3 too.'),
    ];
    const edges = sourceEdges(docs).map(e => `${e.from} ${e.edge} ${e.to}`);

    expect(edges).toContain('doc:2 supersedes doc:1');
    expect(edges).toContain('doc:3 amends doc:2');
    expect(edges).toContain('doc:4 refers_to doc:2');
    expect(edges).toContain('doc:4 refers_to doc:3');
    // a typed edge to the same document is not repeated as refers_to
    expect(edges).not.toContain('doc:2 refers_to doc:1');
    expect(edges).not.toContain('doc:3 refers_to doc:2');
  });

  it('ignores short or one-word titles', () => {
    const edges = sourceEdges([doc(1, 'Policy', 'x'), doc(2, 'Other', 'Read the Policy first.')]);

    expect(edges).toEqual([]);
  });
});

describe('freshness', () => {
  it('is fresh when the passage is unchanged or moved, changed when its text changed, gone when the document is', () => {
    const edge = { to: 'passage:1.0', toHash: passageHash('Refunds in 30 days.') };

    expect(passageFreshness(edge, ['Refunds in 30 days.'])).toBe('fresh');
    expect(passageFreshness(edge, ['Intro.', 'Refunds in 30 days.'])).toBe('fresh');
    expect(passageFreshness(edge, ['Refunds in 14 days.'])).toBe('changed');
    expect(passageFreshness(edge, null)).toBe('gone');
  });

  it('flags the made-up workspace\'s stale claims and leaves the rest holding', async () => {
    const g = corpusGraph();
    const byRef = new Map((await g.claimStatuses()).map(s => [s.ref, s]));

    expect(byRef.get('claim:refunds#1')).toMatchObject({ freshness: 'changed' });
    expect(byRef.get('claim:travel#1')).toMatchObject({ freshness: 'superseded', supersededBy: 'doc:102' });
    expect(byRef.get('claim:refunds#2')).toMatchObject({ freshness: 'fresh', amendedBy: ['doc:105'] });
    expect([...new Set([...byRef.values()].filter(s => s.freshness !== 'fresh').map(s => s.slug))].sort()).toEqual(['data-retention', 'refunds', 'travel']);
  });

  it('tells the agent on read which claims need a check, and when a source has an amendment', async () => {
    const g = corpusGraph();
    const refunds = await pageChecks(g, 'refunds');

    expect(refunds).toMatch(/1 of 2 cited claims need a check/);
    expect(refunds).toMatch(/AMENDED by doc:105/);
    expect(await pageChecks(g, 'pricing')).toMatch(/all \d+ cited claims hold/);
  });
});

describe('locate and expand', () => {
  it('locates nodes by words, titles counting double', () => {
    const g = corpusGraph();
    const hits = g.locate('refund policy');

    expect(hits[0]?.ref).toMatch(/^(doc:104|wiki:refunds)$/);
  });

  it('walks a single-type chain on its own and shows the old words beside the new', async () => {
    const g = corpusGraph();
    const x = (await g.expand('claim:refunds#1'))!;
    const text = renderExpanded(x, g);

    expect(text).toMatch(/SOURCE CHANGED/);
    expect(text).toMatch(/was:.*30 days/i);
    expect(text).toMatch(/now:.*14 days/i);

    const chain = (await g.expand('doc:102', { edges: ['supersedes'], hops: 6 }))!;

    expect(renderExpanded(chain, g)).toMatch(/doc:101/);
  });

  it('answers unknown nodes with null', async () => {
    expect(await corpusGraph().expand('doc:999')).toBeNull();
  });
});

describe('overview', () => {
  it('counts claims, checks with was/now, and replacements for the page', async () => {
    const g = corpusGraph();
    const docs = CORPUS_DOCS.map(d => ({ id: d.id, title: d.title, uri: d.uri }));
    const o = await overviewOf(g, CORPUS_WIKI, docs);

    expect(o.totals.pages).toBe(CORPUS_WIKI.length);
    // four travel claims and two retention claims rest on replaced documents; one refund passage changed
    expect(o.totals.needCheck).toBe(7);
    expect(o.totals.holding + o.totals.needCheck).toBe(o.totals.claims);

    const refund = o.checks.find(c => c.slug === 'refunds')!;

    expect(refund.was).toMatch(/30 days/);
    expect(refund.now).toMatch(/14 days/);
    expect(o.replaced.map(r => `${r.newer.id}>${r.older.id}`)).toEqual(expect.arrayContaining(['102>101', '118>119', '105>104']));
  });

  it('is empty for an empty graph', async () => {
    const g = new EvidenceGraph({ edges: [], pages: [], docs: [], passages: async () => null });
    const o = await overviewOf(g, [], []);

    expect(o.totals.claims).toBe(0);
    expect(o.checks).toEqual([]);
  });
});
