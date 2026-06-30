import { eq } from 'drizzle-orm';
/**
 * Durable-ingestion checkpoint logic against PGlite. Verifies the resumable
 * watermark: a completed sync records `since`, and the next incremental run
 * reads it back. (The full connector loop is covered by RetrievalService's
 * ingest round-trip; here we isolate the checkpoint state machine.)
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { beginSync, finishSync } = await import('@/services/SourceSyncService');

const ORG = 'org_sync_test';

async function makeSource(): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug: 'kb', kind: 'plugin', configJson: {} })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('SourceSyncService checkpoints', () => {
  it('full sync: no since, marks running then completed with a watermark', async () => {
    const sourceId = await makeSource();
    const begun = await beginSync(sourceId, ORG, false);

    expect(begun.since).toBeNull();

    const [running] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(running!.status).toBe('running');

    const watermark = new Date('2026-06-01T00:00:00.000Z');
    await finishSync(sourceId, ORG, { status: 'completed', watermark, counts: { created: 3 } });

    const [done] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(done!.status).toBe('completed');
    expect(done!.since?.getTime()).toBe(watermark.getTime());
    expect(done!.counts).toMatchObject({ created: 3 });
  });

  it('incremental run reads back the prior watermark as `since`', async () => {
    const sourceId = await makeSource();
    const watermark = new Date('2026-06-01T00:00:00.000Z');
    await beginSync(sourceId, ORG, false);
    await finishSync(sourceId, ORG, { status: 'completed', watermark });

    const next = await beginSync(sourceId, ORG, true);

    expect(next.since?.getTime()).toBe(watermark.getTime());
  });

  it('records failure without advancing the watermark', async () => {
    const sourceId = await makeSource();
    const watermark = new Date('2026-06-01T00:00:00.000Z');
    await beginSync(sourceId, ORG, false);
    await finishSync(sourceId, ORG, { status: 'completed', watermark });
    await beginSync(sourceId, ORG, true);
    await finishSync(sourceId, ORG, { status: 'failed', error: 'upstream 500' });

    const [cp] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(cp!.status).toBe('failed');
    expect(cp!.error).toBe('upstream 500');
    // watermark unchanged → a retry still picks up from the last good point.
    expect(cp!.since?.getTime()).toBe(watermark.getTime());
  });
});
