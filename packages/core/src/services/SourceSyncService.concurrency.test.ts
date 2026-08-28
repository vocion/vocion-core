/**
 * Concurrent document ingestion in `runSync` (issue #43).
 *
 * The loop used to await each document in turn, so a 5,000-document sync
 * meant 5,000 OpenAI requests back to back — roughly 17 minutes, almost all
 * of it spent waiting on the network, with the caller's request held open
 * throughout. It now keeps up to `MAX_CONCURRENT_INGESTS` documents in
 * progress at once.
 *
 * `ingestDocument` is mocked so these tests can watch how work gets
 * scheduled — how many documents run at once, and whether everything
 * finishes before cleanup starts — without needing OpenAI or timing
 * anything for real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(async () => undefined),
}));

/** Records how ingestion was scheduled, so tests can make assertions about it. */
type SchedulingLog = {
  /** How many ingests are running at this instant. */
  activeCount: number;
  /** The highest `activeCount` reached during the sync. */
  peakActiveCount: number;
  /** External ids of documents that finished successfully, in completion order. */
  completed: string[];
  /** How many documents had finished at the moment cleanup began. */
  completedWhenCleanupStarted: number;
  /** External ids that should fail instead of succeeding. */
  shouldFail: Set<string>;
  /** Document ids currently being ingested. */
  activeIds: Set<string>;
  /** Ids seen being ingested twice at once — must always stay empty. */
  overlappingIds: string[];
  /** Whether the delete-what's-gone step ran at all. */
  deleteWasCalled: boolean;
  /** Ids the sync asked the delete step to spare. */
  keptFromDeletion: string[];
  /**
   * How long the given document takes to ingest, in milliseconds. Lets a test
   * make a later document finish ahead of an earlier one.
   */
  durationFor: (externalId: string) => number;
};

const schedulingLog: SchedulingLog = {
  activeCount: 0,
  peakActiveCount: 0,
  completed: [],
  completedWhenCleanupStarted: 0,
  shouldFail: new Set(),
  activeIds: new Set(),
  overlappingIds: [],
  deleteWasCalled: false,
  keptFromDeletion: [],
  durationFor: () => 0,
};

vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {}),
  deleteDocumentsGoneFromSource: vi.fn(async (
    _source: unknown,
    _syncStartedAt: Date,
    keptExternalIds?: ReadonlySet<string>,
  ) => {
    // Record how many ingests had finished by the time cleanup started.
    // Anything still running here is a document whose row could be deleted
    // and then written back by the ingest that is still finishing.
    schedulingLog.completedWhenCleanupStarted = schedulingLog.completed.length;
    schedulingLog.deleteWasCalled = true;
    schedulingLog.keptFromDeletion = [...(keptExternalIds ?? [])].toSorted();
    return { deleted: 0 };
  }),
  ingestDocument: vi.fn(async (_source: unknown, doc: { externalId: string }) => {
    schedulingLog.activeCount += 1;
    schedulingLog.peakActiveCount = Math.max(
      schedulingLog.peakActiveCount,
      schedulingLog.activeCount,
    );
    // The real ingestDocument checks whether the document already exists
    // before embedding, so two copies of one id running together would both
    // insert and the second would hit the unique index.
    if (schedulingLog.activeIds.has(doc.externalId)) {
      schedulingLog.overlappingIds.push(doc.externalId);
    }
    schedulingLog.activeIds.add(doc.externalId);
    await new Promise(resolve => setTimeout(resolve, schedulingLog.durationFor(doc.externalId)));
    schedulingLog.activeIds.delete(doc.externalId);
    schedulingLog.activeCount -= 1;
    if (schedulingLog.shouldFail.has(doc.externalId)) {
      throw new Error(`embed failed for ${doc.externalId}`);
    }
    schedulingLog.completed.push(doc.externalId);
    return { status: 'created' as const };
  }),
}));

const { eq } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { MAX_CONCURRENT_INGESTS, runSync, SyncAlreadyRunningError } = await import('@/services/SourceSyncService');
const { z } = await import('zod');

const ORG_ID = 'org_concurrency_test';

/**
 * Register a connector that yields the given document ids, in order. Repeat an
 * id to imitate a connector that returns the same document twice — a URL
 * listed twice in the config, or paginated pages that overlap by one item.
 * @param slug - Connector slug to register under.
 * @param externalIds - The document ids to yield, in order.
 */
function registerRepeatingConnector(slug: string, externalIds: string[]) {
  registerConnector({
    slug,
    name: 'Fixture',
    description: 'test',
    icon: 'File',
    authKind: 'none',
    configSchema: z.object({}).passthrough(),
    async* sync() {
      for (const [index, externalId] of externalIds.entries()) {
        yield {
          externalId,
          uri: `https://example.test/${externalId}`,
          title: externalId,
          // Distinct content per yield, so a repeat is a genuine change.
          content: `body ${index}`,
        };
      }
    },
  });
}

/**
 * Register a connector that yields a fixed number of made-up documents.
 * @param slug - Connector slug to register under.
 * @param documentCount - How many documents the connector should yield.
 * @param throwAfter - Stop and throw once this many documents have been
 * yielded, standing in for an upstream failure part-way through a crawl.
 */
function registerFixtureConnector(slug: string, documentCount: number, throwAfter?: number) {
  registerConnector({
    slug,
    name: 'Fixture',
    description: 'test',
    icon: 'File',
    authKind: 'none',
    configSchema: z.object({}).passthrough(),
    async* sync() {
      for (let index = 0; index < documentCount; index++) {
        if (index === throwAfter) {
          throw new Error('upstream API failed mid-crawl');
        }
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
 * Register a connector that reports a non-fatal failure partway through and
 * keeps yielding — the shape the Strapi connector uses when one collection
 * fails and its siblings still have documents to give.
 * @param slug - Connector slug to register under.
 * @param documentCount - How many documents to yield in total.
 * @param reportErrorAfter - Index at which to report the failure.
 */
function registerReportingFixtureConnector(slug: string, documentCount: number, reportErrorAfter: number) {
  registerConnector({
    slug,
    name: 'Reporting fixture',
    description: 'test',
    icon: 'File',
    authKind: 'none',
    configSchema: z.object({}).passthrough(),
    async* sync(ctx) {
      for (let index = 0; index < documentCount; index++) {
        if (index === reportErrorAfter) {
          ctx.onProgress?.({
            kind: 'error',
            uri: 'https://cms.partner.test/api/venues',
            message: 'Strapi venues fetch failed: 500',
          });
          continue;
        }
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

/**
 * Read the numeric suffix off a `doc-N` external id.
 * @param externalId - An external id in the form `doc-N`.
 */
function documentNumber(externalId: string): number {
  return Number(externalId.split('-')[1]);
}

beforeEach(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
  schedulingLog.activeCount = 0;
  schedulingLog.peakActiveCount = 0;
  schedulingLog.completed = [];
  schedulingLog.completedWhenCleanupStarted = -1;
  schedulingLog.shouldFail = new Set();
  schedulingLog.activeIds = new Set();
  schedulingLog.overlappingIds = [];
  schedulingLog.deleteWasCalled = false;
  schedulingLog.keptFromDeletion = [];
  schedulingLog.durationFor = () => 0;
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('runSync concurrent ingestion', () => {
  it('runs several documents at once, but never more than the limit', async () => {
    registerFixtureConnector('fixture-window', MAX_CONCURRENT_INGESTS * 3);
    const sourceId = await createSource('fixture-window');
    // Give every document a real pause, so documents can pile up.
    schedulingLog.durationFor = () => 5;

    await runSync({ orgId: ORG_ID, sourceId });

    // A literal floor, not just the constant: comparing only against
    // MAX_CONCURRENT_INGESTS would still pass if it were set to 1, which is
    // the serial behaviour this whole change exists to replace.
    expect(schedulingLog.peakActiveCount).toBeGreaterThan(1);
    expect(schedulingLog.peakActiveCount).toBe(MAX_CONCURRENT_INGESTS);
  });

  it('waits for every document to finish before cleaning up removed ones', async () => {
    registerFixtureConnector('fixture-drain', 25);
    const sourceId = await createSource('fixture-drain');
    // Make the last few documents the slowest, so that skipping the wait
    // would leave work running exactly when cleanup begins.
    schedulingLog.durationFor = id => (documentNumber(id) >= 20 ? 25 : 1);

    await runSync({ orgId: ORG_ID, sourceId });

    expect(schedulingLog.completedWhenCleanupStarted).toBe(25);
  });

  it('ingests every document even when the limit stays saturated', async () => {
    registerFixtureConnector('fixture-nodrop', 50);
    const sourceId = await createSource('fixture-nodrop');
    // Varying durations make documents finish out of order.
    schedulingLog.durationFor = id => documentNumber(id) % 7;

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(result.created).toBe(50);
    expect(new Set(schedulingLog.completed).size).toBe(50);
  });

  it('counts a failed document as an error and keeps going', async () => {
    registerFixtureConnector('fixture-partial', 10);
    const sourceId = await createSource('fixture-partial');
    schedulingLog.shouldFail = new Set(['doc-3', 'doc-7']);

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(result.errors).toBe(2);
    expect(result.created).toBe(8);
  });

  it('leaves nothing running when the connector fails part-way through', async () => {
    // The connector throws while several documents are still being ingested.
    // Those must finish before runSync reports the failure, otherwise they go
    // on writing rows after the caller's request has already ended.
    registerFixtureConnector('fixture-connector-throws', 40, 12);
    const sourceId = await createSource('fixture-connector-throws');
    schedulingLog.durationFor = () => 5;

    await expect(runSync({ orgId: ORG_ID, sourceId })).rejects.toThrow('upstream API failed mid-crawl');

    expect(schedulingLog.activeCount).toBe(0);
    // The 12 documents yielded before the failure all got ingested.
    expect(schedulingLog.completed).toHaveLength(12);
  });

  it('ingests a repeated document only once', async () => {
    // doc-a appears three times and doc-b twice, mixed in with unique ids.
    // Ingesting any of those copies twice would race on the same row, and
    // repeating the work would be pointless even if it were safe.
    registerRepeatingConnector('fixture-repeats', [
      'doc-a',
      'doc-b',
      'doc-a',
      'doc-c',
      'doc-b',
      'doc-a',
      'doc-d',
    ]);
    const sourceId = await createSource('fixture-repeats');
    schedulingLog.durationFor = () => 5;

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(schedulingLog.overlappingIds).toEqual([]);
    expect(schedulingLog.completed.toSorted()).toEqual(['doc-a', 'doc-b', 'doc-c', 'doc-d']);
    expect(result.created).toBe(4);
    expect(result.errors).toBe(0);
  });

  it('tells the caller when it skipped a repeat', async () => {
    registerRepeatingConnector('fixture-repeats-progress', ['doc-a', 'doc-a']);
    const sourceId = await createSource('fixture-repeats-progress');
    const events: Array<{ kind: string; uri?: string }> = [];

    await runSync({ orgId: ORG_ID, sourceId, onProgress: e => void events.push(e) });

    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'skipped', uri: 'doc-a' }),
    );
  });

  it('deletes nothing when the source comes back empty', async () => {
    // A source that hands back nothing usually means it broke, not that the
    // customer deleted everything — an expired token, an outage, a listing
    // call that failed without throwing. Deleting on that basis would erase
    // everything we have for that source.
    registerRepeatingConnector('fixture-empty-listing', []);
    const sourceId = await createSource('fixture-empty-listing');

    await runSync({ orgId: ORG_ID, sourceId });

    expect(schedulingLog.deleteWasCalled).toBe(false);
  });

  it('deletes nothing when the source reported a failure while fetching', async () => {
    // A partial listing is just as untrustworthy as an empty one: the
    // documents that failed to fetch were never seen, so they would look
    // deleted even though the source still has them.
    registerConnector({
      slug: 'fixture-partial-listing',
      name: 'Fixture',
      description: 'test',
      icon: 'File',
      authKind: 'none',
      configSchema: z.object({}).passthrough(),
      async* sync(ctx) {
        yield {
          externalId: 'doc-ok',
          uri: 'https://example.test/ok',
          title: 'Fine',
          content: 'body',
        };
        // Exactly what the web connector does when a page returns 503.
        ctx.onProgress?.({ kind: 'error', uri: 'https://example.test/down', message: 'HTTP 503' });
      },
    });
    const sourceId = await createSource('fixture-partial-listing');

    await runSync({ orgId: ORG_ID, sourceId });

    expect(schedulingLog.deleteWasCalled).toBe(false);
  });

  it('spares documents it saw but could not save', async () => {
    // These documents are still at the source. Their saved copy just wasn't
    // refreshed, which makes them indistinguishable from a deleted document
    // unless the delete step is told to leave them alone.
    registerFixtureConnector('fixture-spare-failed', 6);
    const sourceId = await createSource('fixture-spare-failed');
    schedulingLog.shouldFail = new Set(['doc-2', 'doc-4']);

    await runSync({ orgId: ORG_ID, sourceId });

    expect(schedulingLog.deleteWasCalled).toBe(true);
    expect(schedulingLog.keptFromDeletion).toEqual(['doc-2', 'doc-4']);
  });

  it('still deletes when the whole run went cleanly', async () => {
    // The feature has to keep working: a clean full run is exactly when
    // documents removed at the source should be cleared out.
    registerFixtureConnector('fixture-clean-run', 5);
    const sourceId = await createSource('fixture-clean-run');

    await runSync({ orgId: ORG_ID, sourceId });

    expect(schedulingLog.deleteWasCalled).toBe(true);
    expect(schedulingLog.keptFromDeletion).toEqual([]);
  });

  it('refuses to start a second sync while one is already running', async () => {
    // What a second browser tab, or an impatient reload, would do. Two syncs of
    // one source would each pay to embed the same documents and would both
    // write to the single checkpoint row.
    registerFixtureConnector('fixture-one-at-a-time', 10);
    const sourceId = await createSource('fixture-one-at-a-time');
    schedulingLog.durationFor = () => 5;

    const [first, second] = await Promise.allSettled([
      runSync({ orgId: ORG_ID, sourceId }),
      runSync({ orgId: ORG_ID, sourceId }),
    ]);

    // Exactly one wins; the other is turned away with a recognisable error.
    const outcomes = [first.status, second.status].toSorted();

    expect(outcomes).toEqual(['fulfilled', 'rejected']);

    const refusal = [first, second].find(r => r.status === 'rejected');

    expect((refusal as PromiseRejectedResult).reason).toBeInstanceOf(SyncAlreadyRunningError);
    // The winner did the work once, not twice.
    expect(schedulingLog.completed).toHaveLength(10);
  });

  it('refuses a second sync on a source that has synced before', async () => {
    // The harder case. With no checkpoint row yet, the unique index catches a
    // duplicate on its own. Once a row exists both syncs take the update path,
    // so the claim itself has to be what rejects one of them.
    registerFixtureConnector('fixture-claim-existing', 8);
    const sourceId = await createSource('fixture-claim-existing');
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG_ID,
      sourceId,
      status: 'completed',
      startedAt: new Date(Date.now() - 60_000),
    });
    schedulingLog.durationFor = () => 5;

    const outcomes = await Promise.allSettled([
      runSync({ orgId: ORG_ID, sourceId }),
      runSync({ orgId: ORG_ID, sourceId }),
    ]);

    expect(outcomes.map(o => o.status).toSorted()).toEqual(['fulfilled', 'rejected']);

    const refusal = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;

    expect(refusal.reason).toBeInstanceOf(SyncAlreadyRunningError);
    // The documents were embedded once, not twice.
    expect(schedulingLog.completed).toHaveLength(8);
  });

  it('allows a new sync once the previous one has finished', async () => {
    registerFixtureConnector('fixture-sequential-runs', 4);
    const sourceId = await createSource('fixture-sequential-runs');

    await runSync({ orgId: ORG_ID, sourceId });
    const second = await runSync({ orgId: ORG_ID, sourceId });

    expect(second.errors).toBe(0);
    expect(schedulingLog.completed).toHaveLength(8);
  });

  it('takes over a sync that was left running long ago', async () => {
    // A crashed process leaves the source marked busy. Without a takeover rule
    // that source could never be synced again.
    registerFixtureConnector('fixture-abandoned', 3);
    const sourceId = await createSource('fixture-abandoned');
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG_ID,
      sourceId,
      status: 'running',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(result.created).toBe(3);
  });

  it('records what got through on the checkpoint when the sync fails', async () => {
    // runSync throws on failure, so the caller never sees the counts. The
    // checkpoint row is the only record of partial progress.
    registerFixtureConnector('fixture-partial-counts', 40, 12);
    const sourceId = await createSource('fixture-partial-counts');
    schedulingLog.durationFor = () => 5;

    await expect(runSync({ orgId: ORG_ID, sourceId })).rejects.toThrow('upstream API failed mid-crawl');

    const [checkpoint] = await db
      .select()
      .from(sourceSyncCheckpointSchema)
      .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId))
      .limit(1);

    expect(checkpoint?.status).toBe('failed');
    expect(checkpoint?.counts).toMatchObject({ created: 12, errors: 0 });
  });

  it('records a survivable failure on the checkpoint and still completes', async () => {
    // A connector that loses one collection but delivers the rest must leave a
    // trace of what was skipped — a lower document count alone tells nobody
    // which collection went missing.
    registerReportingFixtureConnector('fixture-reported-failure', 5, 2);
    const sourceId = await createSource('fixture-reported-failure');

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(result.created).toBe(4);
    expect(result.errors).toBe(1);

    const [checkpoint] = await db
      .select()
      .from(sourceSyncCheckpointSchema)
      .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId))
      .limit(1);

    // The run finished, so status is completed and `error` — the fatal one —
    // stays empty. The survivable failure lives in `failures`.
    expect(checkpoint?.status).toBe('completed');
    expect(checkpoint?.error).toBeNull();
    expect(checkpoint?.failures).toHaveLength(1);
    expect(checkpoint?.failures?.[0]).toMatchObject({
      uri: 'https://cms.partner.test/api/venues',
      message: 'Strapi venues fetch failed: 500',
    });
    expect(typeof checkpoint?.failures?.[0]?.at).toBe('string');
  });

  it('leaves failures empty on a clean run', async () => {
    registerFixtureConnector('fixture-no-failures', 3);
    const sourceId = await createSource('fixture-no-failures');

    await runSync({ orgId: ORG_ID, sourceId });

    const [checkpoint] = await db
      .select()
      .from(sourceSyncCheckpointSchema)
      .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId))
      .limit(1);

    expect(checkpoint?.failures).toEqual([]);
  });
});
