/**
 * Ingest → Retrieve round-trip against PGlite + bundled pgvector.
 *
 * Mocks `embed()` so we can run deterministic vectors and avoid
 * hitting the OpenAI API in CI. The actual embedder.ts shape is
 * covered separately by its own targeted tests.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Pick up the PGlite-backed auto-mock at src/libs/__mocks__/DB.ts.
vi.mock('@/libs/DB');

// Mock the embedder before any module under test loads it. Returns
// deterministic 1536-d vectors derived from the input text so the
// "vector" arm of search can still rank meaningfully.
vi.mock('@/libs/retrieval/embedder', () => {
  return {
    embed: vi.fn(async (texts: string[]) => {
      return texts.map((t) => {
        const vec: number[] = new Array(1536).fill(0);
        // Trivial bag-of-chars projection: pin a few stable dims off
        // the text so similar strings get similar vectors. Good
        // enough for "the planet doc is closer to 'mars' than the
        // recipe doc" assertions.
        for (let i = 0; i < t.length; i++) {
          const idx = t.charCodeAt(i) % 1536;
          vec[idx] = (vec[idx] ?? 0) + 1;
        }
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
      });
    }),
  };
});

vi.mock('@/libs/Langfuse', () => ({
  langfuse: { flushAsync: vi.fn(async () => {}) },
  traceFor: () => ({
    update: vi.fn(),
    generation: () => ({ end: vi.fn() }),
  }),
}));

const { db } = await import('@/libs/DB');
const {
  knowledgeChunkSchema,
  knowledgeDocumentSchema,
  knowledgeSourceSchema,
} = await import('@/models/Schema');
const { ensureSource, ingestDocument, tombstoneMissing } = await import(
  '@/services/IngestionService',
);
const { search } = await import('@/services/RetrievalService');

const ORG = 'org_retrieval_test';

beforeEach(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('IngestionService + RetrievalService', () => {
  it('round-trips a doc through ingest → hybrid search', async () => {
    const src = await ensureSource({ orgId: ORG, slug: 'docs' });
    const res = await ingestDocument(src, {
      externalId: 'mars',
      title: 'Mars',
      content:
        'Mars is the fourth planet from the Sun. It has a thin atmosphere and two moons, Phobos and Deimos.',
    });

    expect(res.status).toBe('created');

    if (res.status !== 'created') {
      throw new Error('unreachable');
    }

    expect(res.chunks).toBeGreaterThan(0);

    const hits = await search('Tell me about Mars', { orgId: ORG, k: 3 });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.content.toLowerCase()).toContain('mars');
    expect(hits[0]?.sourceSlug).toBe('docs');
  });

  it('is idempotent on identical re-ingest', async () => {
    const src = await ensureSource({ orgId: ORG, slug: 'docs' });
    await ingestDocument(src, {
      externalId: 'mars',
      title: 'Mars',
      content: 'Mars is the fourth planet from the Sun.',
    });
    const again = await ingestDocument(src, {
      externalId: 'mars',
      title: 'Mars',
      content: 'Mars is the fourth planet from the Sun.',
    });

    expect(again.status).toBe('unchanged');
  });

  it('replaces chunks when content changes (update path)', async () => {
    const src = await ensureSource({ orgId: ORG, slug: 'docs' });
    const first = await ingestDocument(src, {
      externalId: 'mars',
      title: 'Mars',
      content: 'Mars is the fourth planet from the Sun.',
    });
    if (first.status !== 'created') {
      throw new Error('expected created on first ingest');
    }
    const second = await ingestDocument(src, {
      externalId: 'mars',
      title: 'Mars (revised)',
      content: 'Mars is now described in much greater detail than before, with information about Olympus Mons and Valles Marineris.',
    });

    expect(second.status).toBe('updated');

    if (second.status !== 'updated') {
      throw new Error('unreachable');
    }

    expect(second.documentId).toBe(first.documentId);
    expect(second.chunks).toBeGreaterThan(0);
  });

  it('isolates results by orgId', async () => {
    const aSrc = await ensureSource({ orgId: 'org_a', slug: 'docs' });
    const bSrc = await ensureSource({ orgId: 'org_b', slug: 'docs' });
    await ingestDocument(aSrc, { externalId: 'mars', content: 'Mars is red.' });
    await ingestDocument(bSrc, { externalId: 'mars', content: 'Mars is red.' });

    const aHits = await search('Mars', { orgId: 'org_a' });
    const bHits = await search('Mars', { orgId: 'org_b' });

    expect(aHits.every(h => h.sourceSlug === 'docs')).toBe(true);
    expect(bHits.every(h => h.sourceSlug === 'docs')).toBe(true);
    // Distinct doc ids per tenant.
    expect(aHits[0]?.documentId).not.toBe(bHits[0]?.documentId);
  });

  it('keyword arm finds exact matches RRF would otherwise miss', async () => {
    const src = await ensureSource({ orgId: ORG, slug: 'docs' });
    await ingestDocument(src, {
      externalId: 'error-codes',
      title: 'Error codes',
      content:
        'When ECONNREFUSED appears, the upstream socket was actively rejected. Distinct from ECONNRESET, which is mid-stream.',
    });
    const hits = await search('ECONNREFUSED', {
      orgId: ORG,
      mode: 'keyword',
      k: 3,
    });

    expect(hits[0]?.content).toContain('ECONNREFUSED');
  });

  it('tombstones missing documents after a sync window', async () => {
    const src = await ensureSource({ orgId: ORG, slug: 'docs' });
    await ingestDocument(src, { externalId: 'mars', content: 'Mars is the fourth planet.' });
    await ingestDocument(src, { externalId: 'venus', content: 'Venus is the second planet.' });
    // Simulate the venus doc not being seen this sync round: advance
    // cutoff past its last_seen_at.
    const cutoff = new Date(Date.now() + 1000);
    // Touch mars so it survives.
    await ingestDocument(src, { externalId: 'mars', content: 'Mars is the fourth planet.' });
    const { deleted } = await tombstoneMissing(src, cutoff);

    expect(deleted).toBeGreaterThanOrEqual(1);

    const allHits = await search('planet', { orgId: ORG, k: 5 });

    expect(allHits.every(h => !h.content.toLowerCase().includes('venus'))).toBe(true);
  });
});
