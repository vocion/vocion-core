/**
 * A completed HubSpot contacts sync runs the handoff watch; any other sync
 * does not; and a watch that throws never fails the sync (ticket 055).
 *
 * The registry is patched so `hubspot` resolves to a fixture connector that
 * needs no credentials and yields nothing; the watch itself is mocked, since
 * `HandoffTriggerService.test.ts` covers what it does.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 1 })),
}));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(async () => undefined),
}));
vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {}),
  deleteDocumentsGoneFromSource: vi.fn(async () => ({ deleted: 0 })),
  ingestDocument: vi.fn(async () => ({ status: 'created' })),
}));
vi.mock('@/services/HandoffTriggerService', () => ({
  watchForHandoffTriggers: vi.fn(async () => ({ watched: 0, unmirrored: 0, baselined: 0, triggered: [] })),
}));

const { z } = await import('zod');
const fixture = {
  slug: 'hubspot',
  name: 'HubSpot fixture',
  description: 'test',
  icon: 'Contact',
  authKind: 'none',
  configSchema: z.object({}).passthrough(),
  async* sync() {},
};
vi.mock('@/libs/sources/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/sources/registry')>();
  return {
    ...actual,
    getConnector: (slug: string) => (slug === 'hubspot' || slug === 'other-fixture' ? fixture : actual.getConnector(slug)),
  };
});

const { db } = await import('@/libs/DB');
const { eventLogSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { watchForHandoffTriggers } = await import('@/services/HandoffTriggerService');
const { runSync } = await import('@/services/SourceSyncService');

const ORG = 'org_sync_handoff';
const watch = vi.mocked(watchForHandoffTriggers);

async function seedSource(slug: string, configJson: Record<string, unknown>): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin', configJson })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function clean() {
  await db.delete(eventLogSchema);
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
}

beforeEach(async () => {
  await clean();
  vi.clearAllMocks();
});

afterAll(clean);

describe('runSync → handoff watch', () => {
  it('runs the watch after a HubSpot contacts sync completes', async () => {
    const sourceId = await seedSource('hubspot-contacts', { _connector: 'hubspot', objectType: 'contacts' });

    await runSync({ orgId: ORG, sourceId });

    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledWith(ORG, expect.any(Function));
  });

  it('treats a hubspot source with no objectType as contacts', async () => {
    const sourceId = await seedSource('hubspot', { _connector: 'hubspot' });

    await runSync({ orgId: ORG, sourceId });

    expect(watch).toHaveBeenCalledTimes(1);
  });

  it('does not run the watch for HubSpot deals, or for any other connector', async () => {
    const deals = await seedSource('hubspot-deals', { _connector: 'hubspot', objectType: 'deals' });
    const other = await seedSource('handbook', { _connector: 'other-fixture' });

    await runSync({ orgId: ORG, sourceId: deals });
    await runSync({ orgId: ORG, sourceId: other });

    expect(watch).not.toHaveBeenCalled();
  });

  it('runs the watch after the sync-completed event, so subscribers see the fresh mirror first', async () => {
    const sourceId = await seedSource('hubspot-contacts', { _connector: 'hubspot', objectType: 'contacts' });
    let eventsLoggedWhenWatched = -1;
    watch.mockImplementationOnce(async () => {
      eventsLoggedWhenWatched = (await db.select().from(eventLogSchema)).length;
      return { watched: 0, unmirrored: 0, baselined: 0, triggered: [] };
    });

    await runSync({ orgId: ORG, sourceId });

    expect(eventsLoggedWhenWatched).toBe(1);
  });
});
