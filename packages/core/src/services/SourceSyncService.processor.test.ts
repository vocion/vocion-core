/**
 * The document processor hook in `runSync`.
 *
 * A processor is a per-tenant stage that runs AFTER a document is ingested —
 * usually expensive, usually a model call. The whole design of the hook is
 * about containment, so that is what these tests pin:
 *
 *   - it runs for created and updated documents only;
 *   - a processor that throws, or hangs, costs its own document and nothing
 *     else: the sync still completes, `errors` stays where it was, the
 *     watermark still advances and documents gone from the source are still
 *     tombstoned;
 *   - its budget is per SYNC, even with eight documents in flight;
 *   - a source that declares no processor is byte-for-byte unaffected.
 *
 * `ingestDocument` is mocked on the pattern of `SourceSyncService.concurrency.test.ts`,
 * extended to return the `documentId` a real ingest returns; the processor
 * registry is patched so a fixture processor stands in for the real one.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(async () => undefined),
}));

/** What the fake ingest returns, and what the fake processor did. */
type ProcessorLog = {
  /** Every document the processor was handed, in call order. */
  ran: Array<{ externalId: string; status: string }>;
  /** How many processor invocations are in flight right now. */
  active: number;
  peakActive: number;
  /** How many times the registry's lazy loader was called. */
  loads: number;
  /** The last context the processor was given, for assertions about it. */
  lastSignal: AbortSignal | null;
  /** The ingest outcome a document gets, so a test can pick created/updated/unchanged. */
  outcomeFor: (externalId: string) => Record<string, unknown>;
  /** What the processor does when it runs. */
  behaviour: (ctx: any) => Promise<{ produced: number; skipped: number; counts?: Record<string, number> }>;
  /** Whether the delete-what's-gone step ran. */
  deleteWasCalled: boolean;
};

const processorLog: ProcessorLog = {
  ran: [],
  active: 0,
  peakActive: 0,
  loads: 0,
  lastSignal: null,
  outcomeFor: () => ({ status: 'created', documentId: 41, chunks: 1 }),
  behaviour: async () => ({ produced: 1, skipped: 0 }),
  deleteWasCalled: false,
};

vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {}),
  deleteDocumentsGoneFromSource: vi.fn(async () => {
    processorLog.deleteWasCalled = true;
    return { deleted: 2 };
  }),
  ingestDocument: vi.fn(async (_source: unknown, doc: { externalId: string }) => processorLog.outcomeFor(doc.externalId)),
}));

const { z } = await import('zod');

const FIXTURE_SLUG = 'fixture-processor';

const fixtureProcessor = {
  slug: FIXTURE_SLUG,
  name: 'Fixture processor',
  description: 'test',
  configSchema: z.object({
    label: z.string().optional(),
    limits: z.object({ maxModelCalls: z.number().int().nonnegative().optional() }).strict().optional(),
  }).strict(),
  load: async () => {
    processorLog.loads += 1;
    return {
      run: async (ctx: any) => {
        processorLog.ran.push({ externalId: ctx.document.externalId, status: ctx.outcome.status });
        processorLog.lastSignal = ctx.signal;
        processorLog.active += 1;
        processorLog.peakActive = Math.max(processorLog.peakActive, processorLog.active);
        try {
          return await processorLog.behaviour(ctx);
        } finally {
          processorLog.active -= 1;
        }
      },
    };
  },
};

vi.mock('@/libs/processors/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/processors/registry')>();
  return {
    ...actual,
    getProcessor: (slug: string) => (slug === FIXTURE_SLUG ? fixtureProcessor : actual.getProcessor(slug)),
    listProcessorSlugs: () => [...actual.listProcessorSlugs(), FIXTURE_SLUG],
  };
});

const { eq } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { runSync, supersedeRunningSync, SyncSupersededError } = await import('@/services/SourceSyncService');

const ORG_ID = 'org_processor_test';

/**
 * Register a connector yielding the given document ids, in order.
 * @param slug - Connector slug to register under.
 * @param externalIds - The document ids to yield.
 */
function registerFixtureConnector(slug: string, externalIds: string[]) {
  registerConnector({
    slug,
    name: 'Fixture',
    description: 'test',
    icon: 'File',
    authKind: 'none',
    configSchema: z.object({}).passthrough(),
    async* sync() {
      for (const externalId of externalIds) {
        yield {
          externalId,
          uri: `https://example.test/${externalId}`,
          title: externalId,
          content: `body of ${externalId}`,
        };
      }
    },
  });
}

/**
 * Create a knowledge source, optionally declaring a processor.
 * @param connectorSlug - Connector the source uses.
 * @param processor - The `_processor` blob to stamp, or undefined for none.
 * @param processor.slug - Processor slug the source declares.
 * @param processor.config - Its authored config blob.
 */
async function createSource(
  connectorSlug: string,
  processor?: { slug: string; config: Record<string, unknown> },
): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({
      orgId: ORG_ID,
      slug: `kb-${connectorSlug}`,
      kind: 'plugin',
      configJson: processor
        ? { _connector: connectorSlug, _processor: processor }
        : { _connector: connectorSlug },
    })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

/**
 * The stored checkpoint for a source.
 * @param sourceId - Source whose checkpoint to read.
 */
async function checkpointFor(sourceId: number) {
  const [checkpoint] = await db
    .select()
    .from(sourceSyncCheckpointSchema)
    .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId))
    .limit(1);
  return checkpoint;
}

beforeEach(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
  processorLog.ran = [];
  processorLog.active = 0;
  processorLog.peakActive = 0;
  processorLog.loads = 0;
  processorLog.lastSignal = null;
  processorLog.outcomeFor = () => ({ status: 'created', documentId: 41, chunks: 1 });
  processorLog.behaviour = async () => ({ produced: 1, skipped: 0 });
  processorLog.deleteWasCalled = false;
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('the document processor hook', () => {
  it('runs for created and updated documents, and for no other outcome', async () => {
    registerFixtureConnector('proc-outcomes', ['made', 'changed', 'same', 'refreshed']);
    const sourceId = await createSource('proc-outcomes', { slug: FIXTURE_SLUG, config: {} });
    const outcomes: Record<string, Record<string, unknown>> = {
      made: { status: 'created', documentId: 1, chunks: 1 },
      changed: { status: 'updated', documentId: 2, chunks: 1 },
      same: { status: 'unchanged', documentId: 3 },
      // The shape a metadata backfill takes: same content, rewritten metadata.
      // Still `unchanged`, so still nothing for a processor to re-read.
      refreshed: { status: 'unchanged', documentId: 4, metadataRefreshed: true },
    };
    processorLog.outcomeFor = id => outcomes[id]!;

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(processorLog.ran.map(r => r.externalId)).toEqual(['made', 'changed']);
    expect(result.errors).toBe(0);
    expect(result.metadataRefreshed).toBe(1);
  });

  it('skips a document the ingest gave no id for, rather than failing it', async () => {
    registerFixtureConnector('proc-no-id', ['a', 'b']);
    const sourceId = await createSource('proc-no-id', { slug: FIXTURE_SLUG, config: {} });
    // A stubbed ingest can answer without an id; the hook has nothing to hang
    // work off, and must treat that as a skip rather than an error.
    processorLog.outcomeFor = () => ({ status: 'created' });

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(processorLog.ran).toEqual([]);
    expect(result.errors).toBe(0);
    expect((await checkpointFor(sourceId))?.counts.processorErrors).toBe(0);
  });

  it('completes the sync when the processor throws, without touching the ingest error total', async () => {
    registerFixtureConnector('proc-throws', ['a', 'b', 'c']);
    const sourceId = await createSource('proc-throws', { slug: FIXTURE_SLUG, config: {} });
    processorLog.behaviour = async (ctx) => {
      if (ctx.document.externalId === 'b') {
        throw new Error('the model refused');
      }
      return { produced: 1, skipped: 0 };
    };

    const result = await runSync({ orgId: ORG_ID, sourceId });

    // `errors` gates tombstoning, the watermark and SyncSavedNothingError. A
    // processor failure must reach none of them.
    expect(result.errors).toBe(0);
    expect(result.created).toBe(3);
    expect(result.firstProcessorError).toBe('the model refused');

    const checkpoint = await checkpointFor(sourceId);

    expect(checkpoint?.status).toBe('completed');
    expect(checkpoint?.counts.processorErrors).toBe(1);
    expect(checkpoint?.counts.errors).toBe(0);
    expect(checkpoint?.counts['extract.produced']).toBe(2);
    expect(checkpoint?.failures.filter(f => f.scope === 'processor')).toEqual([
      expect.objectContaining({ scope: 'processor', uri: 'b', message: 'the model refused' }),
    ]);
    // The two things a failed run withholds, both still done.
    expect(checkpoint?.since).not.toBeNull();
    expect(processorLog.deleteWasCalled).toBe(true);
    expect(result.tombstoned).toBe(2);
  });

  it('adds nothing at all to the counts when the source declares no processor', async () => {
    registerFixtureConnector('proc-none', ['a', 'b']);
    const sourceId = await createSource('proc-none');

    await runSync({ orgId: ORG_ID, sourceId });

    const checkpoint = await checkpointFor(sourceId);

    // toEqual, so an extra key fails: the six a processor-less run has always
    // written, and not one more. (Key ORDER is jsonb's business, not ours.)
    expect(checkpoint?.counts).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
      metadataRefreshed: 0,
      tombstoned: 2,
      errors: 0,
    });
    expect(processorLog.loads).toBe(0);
    expect(processorLog.ran).toEqual([]);
  });

  it('spends its caps once per sync, not once per document, with eight documents in flight', async () => {
    const documentIds = Array.from({ length: 20 }, (_, index) => `doc-${index}`);
    registerFixtureConnector('proc-caps', documentIds);
    const sourceId = await createSource('proc-caps', {
      slug: FIXTURE_SLUG,
      // A manifest may lower a cap; three model calls for the whole run.
      config: { limits: { maxModelCalls: 3 } },
    });
    processorLog.behaviour = async (ctx) => {
      // The slot is taken BEFORE the work, which is the only way a cap can
      // hold when eight documents are asking at once.
      if (!ctx.budget.take('maxModelCalls')) {
        return { produced: 0, skipped: 1 };
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      return { produced: 1, skipped: 0 };
    };

    await runSync({ orgId: ORG_ID, sourceId });

    const checkpoint = await checkpointFor(sourceId);

    expect(processorLog.peakActive).toBeGreaterThan(1);
    expect(checkpoint?.counts['extract.produced']).toBe(3);
    expect(checkpoint?.counts['extract.skipped']).toBe(17);
    expect(checkpoint?.counts.capHits).toBe(17);
    expect(checkpoint?.counts.processorErrors).toBe(0);
    // Seventeen hits, one line about them: the count says how often.
    expect(checkpoint?.failures.filter(f => f.scope === 'processor')).toHaveLength(1);
    expect(checkpoint?.failures[0]?.message).toContain('maxModelCalls');
  });

  it('abandons a processor that hangs, and tells it to stop', async () => {
    vi.stubEnv('VOCION_PROCESSOR_TIMEOUT_MS', '40');
    registerFixtureConnector('proc-hangs', ['a']);
    const sourceId = await createSource('proc-hangs', { slug: FIXTURE_SLUG, config: {} });
    processorLog.behaviour = async (ctx) => {
      // Stops when told to, which is the whole point of handing it the signal:
      // the run gives up waiting at the timeout either way, but the work only
      // stops spending if it listens.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve(null);
        }, { once: true });
      });
      return { produced: 1, skipped: 0 };
    };

    const result = await runSync({ orgId: ORG_ID, sourceId });

    expect(result.errors).toBe(0);
    expect(result.firstProcessorError).toContain('did not finish within');

    const checkpoint = await checkpointFor(sourceId);

    expect(checkpoint?.status).toBe('completed');
    expect(checkpoint?.counts.processorErrors).toBe(1);
    // The run stops waiting either way; the signal is what stops the work
    // itself from carrying on spending money.
    expect(processorLog.lastSignal?.aborted).toBe(true);
  });

  it('leaves no processor work running when an edit supersedes the sync', async () => {
    registerFixtureConnector('proc-superseded', Array.from({ length: 200 }, (_, i) => `doc-${i}`));
    const sourceId = await createSource('proc-superseded', { slug: FIXTURE_SLUG, config: {} });
    processorLog.behaviour = async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 400);
      });
      return { produced: 1, skipped: 0 };
    };

    const run = runSync({ orgId: ORG_ID, sourceId });
    await new Promise((resolve) => {
      setTimeout(resolve, 2200);
    });
    const stopped = await supersedeRunningSync(ORG_ID, sourceId, 'settings changed');

    expect(stopped).toBe(true);
    await expect(run).rejects.toThrow(SyncSupersededError);
    // The run waits for what it started, processors included, so nothing is
    // still writing after the caller has been told the run is over.
    expect(processorLog.active).toBe(0);
    expect(processorLog.ran.length).toBeGreaterThan(0);
  }, 30_000);

  it('refuses to start at all when the processor cannot be resolved', async () => {
    registerFixtureConnector('proc-unknown', ['a']);
    const unknownSlug = await createSource('proc-unknown', { slug: 'no-such-processor', config: {} });

    await expect(runSync({ orgId: ORG_ID, sourceId: unknownSlug })).rejects.toThrow('unknown processor');

    // Nothing claimed, so nothing is left marked running — the same promise
    // the unknown-connector throw above it makes.
    expect(await checkpointFor(unknownSlug)).toBeUndefined();
  });

  it('refuses to start when the processor config does not parse', async () => {
    registerFixtureConnector('proc-bad-config', ['a']);
    const sourceId = await createSource('proc-bad-config', {
      slug: FIXTURE_SLUG,
      config: { labell: 'typo' },
    });

    await expect(runSync({ orgId: ORG_ID, sourceId })).rejects.toThrow();

    expect(await checkpointFor(sourceId)).toBeUndefined();
  });
});
