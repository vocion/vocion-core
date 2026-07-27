/**
 * Bounded-concurrency document loop in `runSync` (issue #43).
 *
 * The loop used to `await ingestDocument` per yield, so a 5,000-doc sync
 * was 5,000 sequential OpenAI round-trips — ~17 minutes of near-total
 * idle wait, with the caller's request hanging for the duration. It now
 * keeps up to `VOCION_INGEST_CONCURRENCY` ingests in flight.
 *
 * `ingestDocument` is mocked so the test can observe the *shape* of the
 * scheduling (peak in-flight, drain-before-tombstone) without needing
 * OpenAI or measuring wall-clock.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(async () => undefined),
}));

/** Records how ingest was scheduled, so tests can assert on the shape. */
const probe = {
  inflight: 0,
  peakInflight: 0,
  ingested: [] as string[],
  settledBeforeTombstone: 0,
  /** Externals that should throw instead of resolving. */
  failOn: new Set<string>(),
  /**
   * Resolved ms delay per doc — lets a later doc finish before an earlier one.
   * @param _externalId
   */
  delayFor: (_externalId: string) => 0,
};

vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {}),
  tombstoneMissing: vi.fn(async () => {
    // Snapshot how many ingests had completed at the moment tombstoning
    // began. Anything still in flight here is a document whose row could
    // be deleted and then resurrected by the completing ingest.
    probe.settledBeforeTombstone = probe.ingested.length;
    return { deleted: 0 };
  }),
  ingestDocument: vi.fn(async (_src: unknown, doc: { externalId: string }) => {
    probe.inflight += 1;
    probe.peakInflight = Math.max(probe.peakInflight, probe.inflight);
    await new Promise(resolve => setTimeout(resolve, probe.delayFor(doc.externalId)));
    probe.inflight -= 1;
    if (probe.failOn.has(doc.externalId)) {
      throw new Error(`embed failed for ${doc.externalId}`);
    }
    probe.ingested.push(doc.externalId);
    return { status: 'created' as const };
  }),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { runSync } = await import('@/services/SourceSyncService');
const { z } = await import('zod');

const ORG = 'org_concurrency_test';

/**
 * Register a connector that yields `count` synthetic documents.
 * @param slug
 * @param count
 */
function registerFixtureConnector(slug: string, count: number) {
  registerConnector({
    slug,
    name: 'Fixture',
    description: 'test',
    icon: 'File',
    authKind: 'none',
    configSchema: z.object({}).passthrough(),
    async* sync() {
      for (let i = 0; i < count; i++) {
        yield {
          externalId: `doc-${i}`,
          uri: `https://example.test/doc-${i}`,
          title: `Doc ${i}`,
          content: `body ${i}`,
        };
      }
    },
  });
}

async function makeSource(connectorSlug: string): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({
      orgId: ORG,
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
  probe.inflight = 0;
  probe.peakInflight = 0;
  probe.ingested = [];
  probe.settledBeforeTombstone = -1;
  probe.failOn = new Set();
  probe.delayFor = () => 0;
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('runSync concurrency window', () => {
  it('keeps VOCION_INGEST_CONCURRENCY ingests in flight, and no more', async () => {
    vi.stubEnv('VOCION_INGEST_CONCURRENCY', '4');
    registerFixtureConnector('fixture-window', 20);
    const sourceId = await makeSource('fixture-window');
    // Every doc takes a real tick, so the window can actually fill.
    probe.delayFor = () => 5;

    await runSync({ orgId: ORG, sourceId });

    expect(probe.peakInflight).toBe(4);
  });

  it('runs serially when the window is set to 1', async () => {
    vi.stubEnv('VOCION_INGEST_CONCURRENCY', '1');
    registerFixtureConnector('fixture-serial', 6);
    const sourceId = await makeSource('fixture-serial');
    probe.delayFor = () => 2;

    await runSync({ orgId: ORG, sourceId });

    expect(probe.peakInflight).toBe(1);
  });

  it('drains every in-flight ingest before tombstoning', async () => {
    vi.stubEnv('VOCION_INGEST_CONCURRENCY', '8');
    registerFixtureConnector('fixture-drain', 25);
    const sourceId = await makeSource('fixture-drain');
    // Make the last docs the slowest, so a missing drain leaves work
    // in flight exactly when tombstoneMissing fires.
    probe.delayFor = id => (Number(id.split('-')[1]) >= 20 ? 25 : 1);

    await runSync({ orgId: ORG, sourceId });

    // tombstoneMissing must have observed all 25 ingests as settled.
    expect(probe.settledBeforeTombstone).toBe(25);
  });

  it('loses no document when the window is saturated', async () => {
    vi.stubEnv('VOCION_INGEST_CONCURRENCY', '8');
    registerFixtureConnector('fixture-nodrop', 50);
    const sourceId = await makeSource('fixture-nodrop');
    // Jittered durations force out-of-order completion.
    probe.delayFor = id => (Number(id.split('-')[1]) % 7);

    const result = await runSync({ orgId: ORG, sourceId });

    expect(result.created).toBe(50);
    expect(new Set(probe.ingested).size).toBe(50);
  });

  it('counts a failed document as an error without aborting the rest', async () => {
    vi.stubEnv('VOCION_INGEST_CONCURRENCY', '4');
    registerFixtureConnector('fixture-partial', 10);
    const sourceId = await makeSource('fixture-partial');
    probe.failOn = new Set(['doc-3', 'doc-7']);

    const result = await runSync({ orgId: ORG, sourceId });

    expect(result.errors).toBe(2);
    expect(result.created).toBe(8);
  });
});
