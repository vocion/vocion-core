/**
 * Editing, deleting and reporting on configured sources.
 *
 * These three are what the Sources page's Edit, Delete and per-row status
 * depend on, and each has a rule that is easy to get wrong: an edit must not
 * store a config a new source would have refused or silently change which
 * connector a source belongs to; a delete reports what went with it; and the
 * status report must call a run whose process died `abandoned` rather than
 * leaving the UI showing it as busy for ever.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { eq } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { deleteSource, latestSyncStateForOrg, updateSourceConfig } = await import('@/services/SourceSyncService');

/**
 * Long enough ago that a run still marked running counts as abandoned — the
 * service gives up on one after thirty minutes.
 */
const BEFORE_THE_TAKEOVER_WINDOW = new Date(Date.now() - 31 * 60_000);
const { z } = await import('zod');

const ORG = 'org_source_crud';

/** A connector whose config demands a baseUrl, so a bad edit has something to fail. */
registerConnector({
  slug: 'crud-fixture',
  name: 'Crud fixture',
  description: 'test',
  icon: 'File',
  authKind: 'apikey',
  configSchema: z.object({ baseUrl: z.string().url('baseUrl must be a URL') }).passthrough(),
  async* sync() {},
});

/**
 * Insert one configured source.
 * @param configJson - Config to store, including the internal `_connector` key.
 */
async function makeSource(configJson: Record<string, unknown>): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug: 'kb-crud', kind: 'plugin', configJson })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

/**
 * Read one source's stored config back.
 * @param sourceId - Source to read.
 */
async function readConfig(sourceId: number): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.id, sourceId));
  return row!.configJson as Record<string, unknown>;
}

beforeEach(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('updateSourceConfig', () => {
  it('replaces the config and keeps the connector it belongs to', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });

    const updated = await updateSourceConfig({
      orgId: ORG,
      sourceId,
      configJson: { baseUrl: 'https://new.example', collections: ['events'] },
    });

    expect(updated.id).toBe(sourceId);
    expect(await readConfig(sourceId)).toEqual({
      _connector: 'crud-fixture',
      baseUrl: 'https://new.example',
      collections: ['events'],
    });
  });

  it('drops a key the new config leaves out, rather than merging it forward', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example', populate: '*' });

    await updateSourceConfig({ orgId: ORG, sourceId, configJson: { baseUrl: 'https://new.example' } });

    expect(await readConfig(sourceId)).not.toHaveProperty('populate');
  });

  it('refuses a config the connector would have rejected on create', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });

    await expect(
      updateSourceConfig({ orgId: ORG, sourceId, configJson: { baseUrl: 'not-a-url' } }),
    ).rejects.toThrow(/must be a URL/);
    // The stored config must survive a refused edit untouched.
    expect(await readConfig(sourceId)).toMatchObject({ baseUrl: 'https://old.example' });
  });

  it('refuses a source belonging to another workspace', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });

    await expect(
      updateSourceConfig({ orgId: 'someone_else', sourceId, configJson: { baseUrl: 'https://new.example' } }),
    ).rejects.toThrow(/No source/);
  });

  it('refuses a source whose connector is no longer registered', async () => {
    const sourceId = await makeSource({ _connector: 'connector-that-was-removed', baseUrl: 'https://old.example' });

    await expect(
      updateSourceConfig({ orgId: ORG, sourceId, configJson: { baseUrl: 'https://new.example' } }),
    ).rejects.toThrow(/Unknown source connector/);
  });
});

describe('deleteSource', () => {
  it('removes the source and reports how many documents went with it', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });
    await db.insert(knowledgeDocumentSchema).values([
      { orgId: ORG, sourceId, externalId: 'a', uri: 'https://x/a', title: 'A', contentHash: 'hash-a' },
      { orgId: ORG, sourceId, externalId: 'b', uri: 'https://x/b', title: 'B', contentHash: 'hash-b' },
    ]);

    const { documentsDeleted } = await deleteSource(ORG, sourceId);

    expect(documentsDeleted).toBe(2);

    const remaining = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, sourceId));

    expect(remaining).toHaveLength(0);
  });

  it('takes the documents with it', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });
    await db.insert(knowledgeDocumentSchema).values(
      { orgId: ORG, sourceId, externalId: 'a', uri: 'https://x/a', title: 'A', contentHash: 'hash-a' },
    );

    await deleteSource(ORG, sourceId);

    const docs = await db
      .select()
      .from(knowledgeDocumentSchema)
      .where(eq(knowledgeDocumentSchema.sourceId, sourceId));

    expect(docs).toHaveLength(0);
  });

  it('refuses a source belonging to another workspace', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });

    await expect(deleteSource('someone_else', sourceId)).rejects.toThrow(/No source/);

    const remaining = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, sourceId));

    expect(remaining).toHaveLength(1);
  });
});

describe('latestSyncStateForOrg', () => {
  it('reports each source separately, with its own status and counts', async () => {
    const failedSource = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://a.example' });
    const [second] = await db
      .insert(knowledgeSourceSchema)
      .values({ orgId: ORG, slug: 'kb-crud-2', kind: 'plugin', configJson: { _connector: 'crud-fixture' } })
      .returning({ id: knowledgeSourceSchema.id });
    const doneSource = second!.id;
    await db.insert(sourceSyncCheckpointSchema).values([
      {
        orgId: ORG,
        sourceId: failedSource,
        status: 'failed',
        startedAt: new Date('2026-08-01T00:00:00.000Z'),
        error: 'nothing was saved',
        counts: { errors: 43 },
      },
      {
        orgId: ORG,
        sourceId: doneSource,
        status: 'completed',
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        counts: { created: 4 },
      },
    ]);

    const state = await latestSyncStateForOrg(ORG);

    expect(state[failedSource]?.status).toBe('failed');
    expect(state[failedSource]?.error).toBe('nothing was saved');
    expect(state[doneSource]?.status).toBe('completed');
    expect(state[doneSource]?.counts).toMatchObject({ created: 4 });
  });

  it('calls a run still marked running past the takeover window abandoned', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId,
      status: 'running',
      startedAt: BEFORE_THE_TAKEOVER_WINDOW,
      counts: {},
    });

    const state = await latestSyncStateForOrg(ORG);

    expect(state[sourceId]?.status).toBe('abandoned');
  });

  it('leaves a run inside the window reported as running', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId,
      status: 'running',
      startedAt: new Date(Date.now() - 60_000),
      counts: {},
    });

    const state = await latestSyncStateForOrg(ORG);

    expect(state[sourceId]?.status).toBe('running');
  });

  it('says nothing about a source that has never synced', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });

    expect(await latestSyncStateForOrg(ORG)).toEqual({});
    expect((await latestSyncStateForOrg(ORG))[sourceId]).toBeUndefined();
  });

  it('does not report another workspace\'s runs', async () => {
    const sourceId = await makeSource({ _connector: 'crud-fixture', baseUrl: 'https://old.example' });
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId,
      status: 'completed',
      startedAt: new Date(),
      counts: {},
    });

    expect(await latestSyncStateForOrg('someone_else')).toEqual({});
  });
});
