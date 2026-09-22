/**
 * Metadata refresh on the unchanged-content path.
 *
 * The content hash governs EMBEDDING, not metadata. Metadata is a projection
 * of the source record, so a connector that widens what it stamps yields
 * identical content with richer metadata. That used to be discarded, which
 * meant new filterable fields could never land on existing rows and no
 * re-sync could fix it. These tests pin the corrected contract, because it is
 * what makes a field-widening backfill possible without paying to re-embed.
 *
 * The unchanged path also carries a document's processor state, pinned at the end.
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
const { ensureSource, ingestDocument, markProcessorRun } = await import('@/services/IngestionService');

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

describe('processor state on a document', () => {
  async function stateOf(id: number) {
    const [row] = await db
      .select({
        processedHash: knowledgeDocumentSchema.processedHash,
        processorAttempts: knowledgeDocumentSchema.processorAttempts,
        processorError: knowledgeDocumentSchema.processorError,
      })
      .from(knowledgeDocumentSchema)
      .where(eq(knowledgeDocumentSchema.id, id));
    return row;
  }

  it('counts a try in SQL, carries it into the next unchanged ingest, and clears it on a finished run', async () => {
    const ref = await src();
    const doc = { externalId: 'deals:9', title: 'Acme', content: 'dealname: Acme\namount: 9000' };
    const created = await ingestDocument(ref, doc);

    expect(created.status).toBe('created');
    expect(await markProcessorRun(created.documentId, { kind: 'started' })).toBe(1);
    expect(await markProcessorRun(created.documentId, { kind: 'failed', error: `throttled ${'x'.repeat(600)}` })).toBe(1);
    expect((await stateOf(created.documentId))?.processorError).toHaveLength(500);

    const again = await ingestDocument(ref, doc);

    expect(again).toMatchObject({ status: 'unchanged', processorAttempts: 1, processorDue: true, contentHash: created.contentHash });

    await markProcessorRun(created.documentId, { kind: 'started' });

    expect(await markProcessorRun(created.documentId, { kind: 'finished', contentHash: created.contentHash })).toBe(0);
    expect(await stateOf(created.documentId)).toEqual({ processedHash: created.contentHash, processorAttempts: 0, processorError: null });
  });

  it('gives a claimed try back when no work was spent, and still reads as due', async () => {
    const ref = await src();
    const doc = { externalId: 'deals:10', title: 'Beta', content: 'dealname: Beta' };
    const created = await ingestDocument(ref, doc);
    await markProcessorRun(created.documentId, { kind: 'started' });

    expect(await markProcessorRun(created.documentId, { kind: 'deferred', error: 'throttled', claimed: true })).toBe(0);
    expect(await markProcessorRun(created.documentId, { kind: 'deferred', error: 'out of time', claimed: false })).toBe(0);
    expect(await ingestDocument(ref, doc)).toMatchObject({ status: 'unchanged', processorAttempts: 0, processorDue: true });
  });

  it('does not let a run that finished on replaced content clear the new content', async () => {
    const ref = await src();
    const created = await ingestDocument(ref, { externalId: 'deals:12', title: 'Delta', content: 'dealname: Delta' });
    await ingestDocument(ref, { externalId: 'deals:12', title: 'Delta', content: 'dealname: Delta\namount: 2' });
    await markProcessorRun(created.documentId, { kind: 'started' });

    await markProcessorRun(created.documentId, { kind: 'finished', contentHash: created.contentHash });

    expect(await stateOf(created.documentId)).toMatchObject({ processorAttempts: 1, processedHash: null });
  });

  it('reads a legacy row, with no processor history, as not due', async () => {
    const ref = await src();
    const doc = { externalId: 'deals:13', title: 'Epsilon', content: 'dealname: Epsilon' };
    await ingestDocument(ref, doc);

    expect(await ingestDocument(ref, doc)).toMatchObject({ status: 'unchanged', processorAttempts: 0, processorDue: false });
  });

  it('starts the count over when the content changes', async () => {
    const ref = await src();
    const created = await ingestDocument(ref, { externalId: 'deals:11', title: 'Gamma', content: 'dealname: Gamma' });
    await markProcessorRun(created.documentId, { kind: 'started' });
    await markProcessorRun(created.documentId, { kind: 'failed', error: 'throttled' });

    const changed = await ingestDocument(ref, { externalId: 'deals:11', title: 'Gamma', content: 'dealname: Gamma\namount: 1' });

    expect(changed.status).toBe('updated');
    expect(await stateOf(created.documentId)).toMatchObject({ processorAttempts: 0, processorError: null });
  });
});
