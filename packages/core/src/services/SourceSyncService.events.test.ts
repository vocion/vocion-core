/**
 * A finished sync reaches the automations that subscribed to it.
 *
 * `AutomationManifestSchema` has always accepted `when: { event }`, and
 * `EventService.emitEvent` has always fanned an event out to the matching
 * automations — but nothing in the sync path emitted one, so an automation
 * subscribed to a finished sync was an unreachable path that validated,
 * stored, and never ran. These tests pin the wire between the two: the event
 * type, the payload keys a `filter` can match on, and the promise that a
 * failure to dispatch never fails the sync that already succeeded.
 *
 * Style follows `EventService.test.ts` — PGlite, a mocked workflow starter,
 * assertions on what `emitEvent` triggered.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 910 })),
}));
// Connectors under test need no credentials; the real one would reach for the vault.
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(async () => undefined),
}));
// Ingestion is stubbed for the same reason the concurrency suite stubs it: the
// real module pulls in the embedding backend, and this file is about what the
// sync announces when it finishes, not about what it ingested.
vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {}),
  deleteDocumentsGoneFromSource: vi.fn(async () => ({ deleted: 0 })),
  ingestDocument: vi.fn(async () => ({ status: 'created' })),
}));

const { z } = await import('zod');
const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, eventLogSchema, knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema, workflowSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { startWorkflow } = await import('@/services/WorkflowService');
const { SOURCE_SYNC_COMPLETED } = await import('@/services/EventService');
const { runSync } = await import('@/services/SourceSyncService');

const ORG = 'org_sync_events';
const mockStart = vi.mocked(startWorkflow);

/** A connector that yields nothing: the run still completes, which is all this file is about. */
registerConnector({
  slug: 'sync-events-fixture',
  name: 'Sync events fixture',
  description: 'test',
  icon: 'File',
  authKind: 'none',
  configSchema: z.object({}).passthrough(),
  async* sync() {},
});

async function seedSource(slug: string): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: 'sync-events-fixture' } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function seedAutomation(slug: string, whenConfig: Record<string, unknown>): Promise<void> {
  await db.insert(automationSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    status: 'active',
    whenConfig: whenConfig as never,
    doConfig: { workflow: 'reindex_summary' } as never,
  });
}

async function clean(): Promise<void> {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  await db.delete(workflowSchema);
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
}

beforeEach(async () => {
  await clean();
  vi.clearAllMocks();
});

afterAll(clean);

describe('runSync → source.sync_completed', () => {
  it('dispatches to an automation subscribed to a completed sync', async () => {
    const sourceId = await seedSource('handbook');
    await seedAutomation('reindex-on-sync', { event: SOURCE_SYNC_COMPLETED });

    await runSync({ orgId: ORG, sourceId });

    const [logged] = await db.select().from(eventLogSchema);

    expect(logged?.type).toBe('source.sync_completed');
    expect(logged?.triggered).toEqual([{ slug: 'automation:reindex-on-sync', runId: 910 }]);
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, slug: 'reindex_summary' }),
    );
  });

  it('carries the payload keys a when-filter can match on', async () => {
    const sourceId = await seedSource('handbook');

    await runSync({ orgId: ORG, sourceId, incremental: true });

    const [logged] = await db.select().from(eventLogSchema);

    expect(logged?.payload).toMatchObject({
      sourceId,
      sourceSlug: 'handbook',
      connector: 'sync-events-fixture',
      incremental: true,
      created: 0,
      updated: 0,
      unchanged: 0,
      tombstoned: 0,
      errors: 0,
    });
    expect(typeof (logged?.payload as { completedAt?: unknown }).completedAt).toBe('string');
  });

  it('only fires automations whose filter matches the source that synced', async () => {
    const sourceId = await seedSource('handbook');
    await seedAutomation('handbook-only', { event: SOURCE_SYNC_COMPLETED, filter: { sourceSlug: 'handbook' } });
    await seedAutomation('other-source-only', { event: SOURCE_SYNC_COMPLETED, filter: { sourceSlug: 'pricing' } });

    await runSync({ orgId: ORG, sourceId });

    const [logged] = await db.select().from(eventLogSchema);

    expect(logged?.triggered).toEqual([{ slug: 'automation:handbook-only', runId: 910 }]);
  });

  it('still completes the sync when dispatch throws', async () => {
    const sourceId = await seedSource('handbook');
    await seedAutomation('reindex-on-sync', { event: SOURCE_SYNC_COMPLETED });
    mockStart.mockRejectedValueOnce(new Error('workflow engine down'));

    const result = await runSync({ orgId: ORG, sourceId });

    expect(result.errors).toBe(0);

    const [checkpoint] = await db.select().from(sourceSyncCheckpointSchema);

    expect(checkpoint?.status).toBe('completed');
  });
});
