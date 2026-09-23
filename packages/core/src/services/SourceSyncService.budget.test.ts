/**
 * What a sync does when a spend cap refuses a document.
 *
 * Every other per-document failure is counted and stepped over: one malformed
 * file must not cost a sync the other 4,999 documents. A hard spend cap is the
 * opposite — the next document would be refused for the same reason, and the
 * one after that — so carrying on only burns through the connector's pages
 * producing a run that is one long error list.
 *
 * #279 asks for the sync to "stop cleanly, not half-write". These tests pin
 * what clean means here: the run stops near the refusal rather than at the end
 * of the source, documents already in flight are allowed to finish, and the
 * checkpoint records `failed` with the cap's own words so the person reading
 * /dashboard/sources knows what to raise.
 *
 * `ingestDocument` is mocked, so no embedding and no OpenAI. The database is
 * PGlite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(async () => undefined),
}));

/** External ids handed to `ingestDocument`, in the order it was called. */
const attempted: string[] = [];

/** Ids that should be refused by the budget rather than ingested. */
const refused = new Set<string>();

/** How many times the run recorded the source as synced. */
const markedSynced = { count: 0 };

/** How many times the run deleted the documents the source no longer has. */
const deletedGoneDocuments = { count: 0 };

vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {
    markedSynced.count += 1;
  }),
  deleteDocumentsGoneFromSource: vi.fn(async () => {
    deletedGoneDocuments.count += 1;
    return { deleted: 0 };
  }),
  ingestDocument: vi.fn(async (_source: unknown, doc: { externalId: string }) => {
    attempted.push(doc.externalId);
    if (refused.has(doc.externalId)) {
      const { BudgetExceededError } = await import('@/services/BudgetService');
      throw new BudgetExceededError({
        ok: false,
        reason: 'hard_cents_exceeded',
        scope: 'org',
        agentSlug: 'platform:all',
        limit: 5000,
        current: 5200,
        limitFrom: 'own',
      });
    }
    return { status: 'created' as const };
  }),
}));

const { eq } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { runSync } = await import('@/services/SourceSyncService');
const { z } = await import('zod');

const ORG_ID = 'org_sync_budget_test';

/** How many documents the fixture source holds — far more than we expect to attempt. */
const DOCUMENT_COUNT = 60;

/**
 * Register a connector that yields `DOCUMENT_COUNT` made-up documents.
 * @param slug - Connector slug to register under.
 */
function registerFixtureConnector(slug: string) {
  registerConnector({
    slug,
    name: 'Fixture',
    description: 'test',
    icon: 'File',
    authKind: 'none',
    configSchema: z.object({}).passthrough(),
    async* sync() {
      for (let index = 0; index < DOCUMENT_COUNT; index++) {
        yield {
          externalId: `doc-${index}`,
          uri: `https://example.test/doc-${index}`,
          title: `Doc ${index}`,
          content: `body ${index}`,
        };
      }
    },
  });
}

/**
 * Create a knowledge source row pointing at the given connector.
 * @param connectorSlug - Slug of the connector the source should use.
 */
async function createSource(connectorSlug: string): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({
      orgId: ORG_ID,
      slug: `kb-${connectorSlug}`,
      kind: 'plugin',
      configJson: { _connector: connectorSlug },
    })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
  attempted.length = 0;
  refused.clear();
  markedSynced.count = 0;
  deletedGoneDocuments.count = 0;
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('a sync that hits a spend cap', () => {
  it('stops instead of walking the rest of the source', async () => {
    registerFixtureConnector('fixture-budget-stop');
    const sourceId = await createSource('fixture-budget-stop');
    // Everything from the third document on is over the cap, which is what a
    // real cap looks like: once crossed it stays crossed.
    for (let index = 2; index < DOCUMENT_COUNT; index++) {
      refused.add(`doc-${index}`);
    }

    await expect(runSync({ orgId: ORG_ID, sourceId })).rejects.toThrow(/Budget exceeded/);

    // A handful of documents were already in flight when the first refusal
    // landed, which is fine — the point is that it did not attempt all 60.
    expect(attempted.length).toBeLessThan(DOCUMENT_COUNT);
  });

  it('records the failure on the checkpoint in the cap\'s own words', async () => {
    registerFixtureConnector('fixture-budget-checkpoint');
    const sourceId = await createSource('fixture-budget-checkpoint');
    for (let index = 2; index < DOCUMENT_COUNT; index++) {
      refused.add(`doc-${index}`);
    }

    await expect(runSync({ orgId: ORG_ID, sourceId })).rejects.toThrow();

    const [checkpoint] = await db
      .select()
      .from(sourceSyncCheckpointSchema)
      .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(checkpoint?.status).toBe('failed');
    expect(checkpoint?.error).toMatch(/Budget exceeded/);
    // Names the row that refused, so the reader knows which cap to raise.
    expect(checkpoint?.error).toContain('platform:all');
  });

  it('does not record the source as synced, and deletes nothing on the strength of a stopped run', async () => {
    registerFixtureConnector('fixture-budget-watermark');
    const sourceId = await createSource('fixture-budget-watermark');
    for (let index = 2; index < DOCUMENT_COUNT; index++) {
      refused.add(`doc-${index}`);
    }

    await expect(runSync({ orgId: ORG_ID, sourceId })).rejects.toThrow();

    // A stopped run read only part of the source. Marking it synced would move
    // the incremental watermark past documents it never looked at, and the
    // delete step would treat every document it did not reach as gone from the
    // source and unpublish it from search.
    expect(markedSynced.count).toBe(0);
    expect(deletedGoneDocuments.count).toBe(0);
  });

  it('finishes the whole source when nothing is refused', async () => {
    registerFixtureConnector('fixture-budget-clear');
    const sourceId = await createSource('fixture-budget-clear');

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(result.created).toBe(DOCUMENT_COUNT);
    expect(attempted).toHaveLength(DOCUMENT_COUNT);
  });
});
