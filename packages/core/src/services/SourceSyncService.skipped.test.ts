/**
 * What a run read and did not keep is recorded, with the reason.
 *
 * A connector reports a document its rule set aside as a `skipped` progress
 * event — the github source does this for a pull request outside the branch
 * prefix. Until 2026-10-01 the event reached the caller's listener and was
 * dropped, so a run that read twelve pull requests and kept none ended as
 * "0 documents" with nothing on the checkpoint to say why (Noco, 2026-09-30).
 * These pin that the skips land on the checkpoint, that the total is counted
 * past the stored sample, and that a run-level remark with no `uri` is not
 * counted as an item.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(async () => undefined),
}));
vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {}),
  deleteDocumentsGoneFromSource: vi.fn(async () => ({ deleted: 0 })),
  ingestDocument: vi.fn(async () => ({ status: 'created', documentId: 7, chunks: 1, contentHash: 'h7' })),
  markProcessorRun: vi.fn(async () => 0),
}));

const { z } = await import('zod');
const { eq } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { runSync } = await import('@/services/SourceSyncService');

const ORG_ID = 'org_skipped_test';

/**
 * A connector that reads `seen` items, keeps the ones in `keep`, and reports
 * every other one as skipped by rule — plus one run-level remark with no uri.
 * @param slug - Connector slug to register under.
 * @param seen - Every externalId the connector reads.
 * @param keep - The ones it yields as documents.
 */
function registerFilteringConnector(slug: string, seen: string[], keep: Set<string>) {
  registerConnector({
    slug,
    name: 'Filtering fixture',
    description: 'test',
    icon: 'File',
    authKind: 'none',
    configSchema: z.object({}).passthrough(),
    async* sync(ctx) {
      for (const externalId of seen) {
        if (!keep.has(externalId)) {
          ctx.onProgress?.({ kind: 'skipped', uri: `https://example.test/${externalId}`, message: `branch ${externalId} is outside the factory/ prefix` });
          continue;
        }
        yield { externalId, uri: `https://example.test/${externalId}`, title: externalId, content: `body of ${externalId}` };
      }
      ctx.onProgress?.({ kind: 'skipped', message: 'a remark about the run, not an item' });
    },
  });
}

async function createSource(connectorSlug: string): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG_ID, slug: `kb-${connectorSlug}`, kind: 'plugin', configJson: { _connector: connectorSlug } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function checkpointFor(sourceId: number) {
  const [checkpoint] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId)).limit(1);
  return checkpoint;
}

beforeEach(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('what a sync read and did not keep', () => {
  it('lands on the checkpoint with the reason, and a run that kept nothing says how much it read', async () => {
    registerFilteringConnector('filter-all', ['a', 'b', 'c'], new Set());
    const sourceId = await createSource('filter-all');

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(result.created).toBe(0);

    const checkpoint = await checkpointFor(sourceId);

    expect(checkpoint?.status).toBe('completed');
    expect(checkpoint?.counts.skipped).toBe(3);
    expect(checkpoint?.skipped.map(s => s.uri)).toEqual(['https://example.test/a', 'https://example.test/b', 'https://example.test/c']);
    expect(checkpoint?.skipped[0]?.message).toBe('branch a is outside the factory/ prefix');
    // The uri-less remark is neither an item nor a failure.
    expect(checkpoint?.skipped.some(s => s.message.includes('remark'))).toBe(false);
    expect(checkpoint?.failures).toEqual([]);
    expect(checkpoint?.counts.errors).toBe(0);
  });

  it('counts past the stored sample, so the total is never the sample\'s length', async () => {
    const seen = Array.from({ length: 40 }, (_, i) => `pr-${i}`);
    registerFilteringConnector('filter-many', seen, new Set(['pr-0']));
    const sourceId = await createSource('filter-many');

    await runSync({ orgId: ORG_ID, sourceId });
    const checkpoint = await checkpointFor(sourceId);

    expect(checkpoint?.counts.created).toBe(1);
    expect(checkpoint?.counts.skipped).toBe(39);
    expect(checkpoint?.skipped).toHaveLength(25);
  });
});
