/**
 * Metadata refresh on the unchanged-content path.
 *
 * The content hash governs EMBEDDING, not metadata. Metadata is a projection
 * of the source record, so a connector that widens what it stamps yields
 * identical content with richer metadata. That used to be discarded, which
 * meant new filterable fields could never land on existing rows and no
 * re-sync could fix it. These tests pin the corrected contract, because it is
 * what makes a field-widening backfill possible without paying to re-embed.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const embed = vi.fn(async (texts: string[]) =>
  texts.map(() => Array.from<number>({ length: 1536 }).fill(0.1)));
vi.mock('@/libs/retrieval/embedder', () => ({ embed: (t: string[]) => embed(t) }));

vi.mock('@/libs/Langfuse', () => ({
  flushTraces: vi.fn(async () => {}),
  traceFor: () => ({ update: vi.fn(), generation: () => ({ end: vi.fn() }) }),
}));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { ensureSource, ingestDocument } = await import('@/services/IngestionService');

const ORG = 'org_ingest_meta';

async function src() {
  return ensureSource({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' } });
}

async function storedMetadata(externalId: string) {
  const [row] = await db
    .select({ metadata: knowledgeDocumentSchema.metadata, title: knowledgeDocumentSchema.title })
    .from(knowledgeDocumentSchema)
    .where(eq(knowledgeDocumentSchema.externalId, externalId));
  return row;
}

beforeEach(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  embed.mockClear();
});

afterAll(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('unchanged content, widened metadata', () => {
  it('rewrites metadata without re-embedding', async () => {
    const ref = await src();
    const doc = { externalId: 'deals:1', title: 'Acme', content: 'dealname: Acme\namount: 5000' };

    const created = await ingestDocument(ref, { ...doc, metadata: { objectType: 'deals', hubspotId: '1' } });

    expect(created.status).toBe('created');

    const embedCallsAfterCreate = embed.mock.calls.length;

    expect(embedCallsAfterCreate).toBeGreaterThan(0);

    // Same content, richer metadata — the field-widening case.
    const again = await ingestDocument(ref, {
      ...doc,
      metadata: { objectType: 'deals', hubspotId: '1', amount: 5000, pipeline: 'default' },
    });

    expect(again.status).toBe('unchanged');
    expect(again).toMatchObject({ metadataRefreshed: true });
    // The whole point: no additional embedding was paid for.
    expect(embed.mock.calls.length).toBe(embedCallsAfterCreate);

    const row = await storedMetadata('deals:1');

    expect(row?.metadata).toMatchObject({ amount: 5000, pipeline: 'default' });
  });

  it('reports metadataRefreshed false when nothing actually changed', async () => {
    const ref = await src();
    const doc = {
      externalId: 'deals:2',
      title: 'Beta',
      content: 'dealname: Beta',
      metadata: { objectType: 'deals', hubspotId: '2' },
    };
    await ingestDocument(ref, doc);

    const again = await ingestDocument(ref, doc);

    expect(again.status).toBe('unchanged');
    expect(again).toMatchObject({ metadataRefreshed: false });
  });

  it('refreshes a changed title on unchanged content', async () => {
    const ref = await src();
    const base = { externalId: 'deals:3', content: 'dealname: Gamma', metadata: { objectType: 'deals', hubspotId: '3' } };
    await ingestDocument(ref, { ...base, title: 'Old name' });

    const again = await ingestDocument(ref, { ...base, title: 'Renamed in HubSpot' });

    expect(again).toMatchObject({ status: 'unchanged', metadataRefreshed: true });
    expect((await storedMetadata('deals:3'))?.title).toBe('Renamed in HubSpot');
  });
});
