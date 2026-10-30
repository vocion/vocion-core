/**
 * The evidence graph on PGlite (ADR 0012): edges rebuilt from wiki pages and
 * ingested documents, and the graph a person sees, limited to workspace-wide
 * documents in the sources they may read. A document out of scope leaves no
 * trace; a document that is gone keeps its citations, so they read "gone".
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const PAGES = vi.hoisted(() => [] as Array<{ id: number; slug: string; title: string; md: string; summary: string; version: number; updatedAt: Date; createdAt: Date }>);
vi.mock('@/services/wiki/WikiService', () => ({ listWikiPages: vi.fn(async () => PAGES) }));
vi.mock('@/services/PluginService', () => ({ pluginEnabled: vi.fn(async (_org: string, slug: string) => ['wiki', 'wiki-evidence'].includes(slug)) }));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema, memoryEdgeSchema } = await import('@/models/Schema');
const svc = await import('./EvidenceGraphService');

const ORG = 'org_evidence_test';
const ids: Record<string, number> = {};

async function addDoc(key: string, sourceId: number, title: string, passages: string[], extra: { clientId?: string } = {}) {
  const [d] = await db.insert(knowledgeDocumentSchema).values({ orgId: ORG, sourceId, externalId: key, title, uri: `https://docs.example.com/${key}`, contentHash: `h-${key}`, ...extra }).returning({ id: knowledgeDocumentSchema.id });
  ids[key] = d!.id;
  await db.insert(knowledgeChunkSchema).values(passages.map((content, chunkIdx) => ({ orgId: ORG, documentId: d!.id, chunkIdx, content, contentTokens: 10, embedding: Array.from({ length: 1536 }, () => 0) })));
}

beforeAll(async () => {
  const [drive] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'drive' }).returning({ id: knowledgeSourceSchema.id });
  const [hr] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hr', accessPolicy: { visibility: 'restricted', users: ['hr@example.com'] } }).returning({ id: knowledgeSourceSchema.id });
  await addDoc('old', drive!.id, 'Travel Policy 2025', ['The per diem is $60.', 'Hotels up to $180.']);
  await addDoc('new', drive!.id, 'Travel Policy 2026', ['This policy supersedes the Travel Policy 2025.', 'The per diem is $75.']);
  await addDoc('pay', hr!.id, 'Pay Bands Guide', ['Band 3 starts at a set rate.']);
  await addDoc('client', drive!.id, 'Client Rate Sheet', ['Client rates.'], { clientId: 'client-1' });
  const md = [
    `The per diem is $60. [src:${ids.old}.0]`,
    `Bands start at a set rate. [src:${ids.pay}.0]`,
    `Client rates apply. [src:${ids.client}.0]`,
  ].join('\n\n');
  PAGES.push({ id: 1, slug: 'travel', title: 'Travel', md, summary: 'Travel rules', version: 1, updatedAt: new Date(), createdAt: new Date() });
});

afterAll(async () => {
  await db.delete(memoryEdgeSchema).where(eq(memoryEdgeSchema.orgId, ORG));
});

describe('EvidenceGraphService', () => {
  it('is on only with both plugins', async () => {
    expect(await svc.evidenceEnabled(ORG)).toBe(true);
  });

  it('builds wiki and source edges, leaving client-scoped documents out of the citations', async () => {
    const r = await svc.rebuildEvidenceGraph(ORG);

    expect(r.pages).toBe(1);
    expect(r.claims).toBe(3);

    const rows = await db.select().from(memoryEdgeSchema).where(eq(memoryEdgeSchema.orgId, ORG));
    const edges = rows.map(e => `${e.fromRef} ${e.edge} ${e.toRef}`);

    expect(edges).toContain(`doc:${ids.new} supersedes doc:${ids.old}`);
    expect(edges).toContain(`claim:travel#1 cites passage:${ids.old}.0`);
    expect(rows.some(e => e.toRef.includes(`${ids.client}.`))).toBe(false);
  });

  it('rebuilding is idempotent', async () => {
    const before = (await db.select().from(memoryEdgeSchema).where(eq(memoryEdgeSchema.orgId, ORG))).length;
    await svc.rebuildEvidenceGraph(ORG);

    expect((await db.select().from(memoryEdgeSchema).where(eq(memoryEdgeSchema.orgId, ORG))).length).toBe(before);
  });

  it('shows a person only the sources they may read, and flags the replaced claim', async () => {
    const everyone = await svc.loadEvidenceGraph(ORG, { allowedSourceSlugs: ['drive'] });
    const statuses = await everyone.claimStatuses();

    expect(statuses.map(s => s.ref)).toEqual(['claim:travel#1']);
    expect(statuses[0]).toMatchObject({ freshness: 'superseded', supersededBy: `doc:${ids.new}` });

    const hr = await svc.loadEvidenceGraph(ORG, { allowedSourceSlugs: ['drive', 'hr'] });

    expect((await hr.claimStatuses()).map(s => s.ref).sort()).toEqual(['claim:travel#1', 'claim:travel#2']);
  });

  it('keeps a citation to a deleted document, as gone', async () => {
    await db.delete(knowledgeChunkSchema).where(eq(knowledgeChunkSchema.documentId, ids.pay!));
    await db.delete(knowledgeDocumentSchema).where(eq(knowledgeDocumentSchema.id, ids.pay!));
    const g = await svc.loadEvidenceGraph(ORG, { allowedSourceSlugs: ['drive', 'hr'] });

    expect((await g.claimStatuses()).find(s => s.ref === 'claim:travel#2')).toMatchObject({ freshness: 'gone' });
  });

  it('summarises for the page', async () => {
    const o = await svc.loadEvidenceOverview(ORG, { allowedSourceSlugs: ['drive'] });

    // the replaced travel claim, and the claim whose source was deleted above (only the wiki's own words show)
    expect(o.totals.claims).toBe(2);
    expect(o.checks.map(c => c.freshness).sort()).toEqual(['gone', 'superseded']);
    expect(o.replaced.map(r => r.edge)).toEqual(['supersedes']);
  });
});

describe('evidenceEdgeVisible', () => {
  const scope = { slugs: new Set(['p']), readable: new Set([1]), existing: new Set([1, 2]) };

  it('hides edges to pages that are gone and to documents out of scope, and keeps citations to deleted documents', () => {
    expect(svc.evidenceEdgeVisible({ from: 'claim:p#1', edge: 'cites', to: 'passage:1.0' }, scope)).toBe(true);
    expect(svc.evidenceEdgeVisible({ from: 'claim:q#1', edge: 'cites', to: 'passage:1.0' }, scope)).toBe(false);
    expect(svc.evidenceEdgeVisible({ from: 'claim:p#1', edge: 'cites', to: 'passage:2.0' }, scope)).toBe(false);
    expect(svc.evidenceEdgeVisible({ from: 'claim:p#1', edge: 'cites', to: 'passage:3.0' }, scope)).toBe(true);
    expect(svc.evidenceEdgeVisible({ from: 'doc:1', edge: 'supersedes', to: 'doc:3' }, scope)).toBe(false);
  });
});
