/**
 * A failure the run survives is kept with what it said about itself, and is
 * written to the log once: the checkpoint carries a failed fetch's `detail`
 * beside its message, and every error event becomes exactly one warn line
 * (with the source's slug, so a log search finds it). A clean run logs none.
 * A page a fallback reader read is counted (`readVia.firecrawl`) and logged
 * once at info; a run that read every page itself carries no such count.
 *
 * Style follows `SourceSyncService.events.test.ts`: PGlite, ingestion stubbed.
 */
import type { FetchFailureDetail } from '@/libs/sources/fetchFailure';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
const warn = vi.fn();
const error = vi.fn();

vi.mock('@/libs/DB');
vi.mock('@/libs/Logger', () => ({ logger: { info, warn, error } }));
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 911 })),
}));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(async () => undefined),
}));
vi.mock('@/services/IngestionService', () => ({
  ensureSource: vi.fn(async () => ({ sourceId: 1, orgId: 'org', sourceSlug: 'kb' })),
  markSourceSynced: vi.fn(async () => {}),
  deleteDocumentsGoneFromSource: vi.fn(async () => ({ deleted: 0 })),
  // One document refuses to save, so the document path is covered too.
  ingestDocument: vi.fn(async (_ctx: unknown, doc: { externalId: string }) => {
    if (doc.externalId === 'will-not-save') {
      throw new Error('embedding rate limited');
    }
    return { status: 'created', documentId: 1, chunks: 1 };
  }),
}));

const { z } = await import('zod');
const { db } = await import('@/libs/DB');
const { eventLogSchema, knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema, workflowSchema } = await import('@/models/Schema');
const { registerConnector } = await import('@/libs/sources/registry');
const { runSync } = await import('@/services/SourceSyncService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_sync_failure_detail';
const BLOCKED = 'https://bellwater.test/whats-on';
const DETAIL: FetchFailureDetail = { status: 403, headers: { 'server': 'edge-proxy', 'cf-mitigated': 'challenge' }, title: 'Just a moment...' };
const MESSAGE = 'HTTP 403 · server: edge-proxy · cf-mitigated: challenge · title: Just a moment...';

registerConnector({
  slug: 'failure-detail-fixture',
  name: 'Failure detail fixture',
  description: 'test',
  icon: 'File',
  authKind: 'none',
  configSchema: z.object({}).passthrough(),
  async* sync(ctx) {
    ctx.onProgress?.({ kind: 'fetched', uri: 'https://bellwater.test/' });
    ctx.onProgress?.({ kind: 'error', uri: BLOCKED, message: MESSAGE, detail: DETAIL });
    // A page apart, as a real crawl reports them. Two log lines in one tick
    // left vitest's module runner holding the second lazy logger import for
    // longer than the test can wait (over 10 s here), a runner artifact.
    await new Promise(resolve => setTimeout(resolve, 0));
    ctx.onProgress?.({ kind: 'error', uri: 'https://bellwater.test/gone', message: 'fetch failed' });
    yield { externalId: 'kept', uri: 'https://bellwater.test/', title: 'Kept', content: 'A show.' };
    yield { externalId: 'will-not-save', uri: 'https://bellwater.test/x', title: 'X', content: 'Another show.' };
  },
});

registerConnector({
  slug: 'failure-detail-clean-fixture',
  name: 'Clean fixture',
  description: 'test',
  icon: 'File',
  authKind: 'none',
  configSchema: z.object({}).passthrough(),
  async* sync(ctx) {
    ctx.onProgress?.({ kind: 'fetched', uri: 'https://bellwater.test/' });
    ctx.onProgress?.({ kind: 'skipped', uri: 'https://bellwater.test/feed.ics', message: 'HTTP 404' });
    yield { externalId: 'kept', uri: 'https://bellwater.test/', title: 'Kept', content: 'A show.' };
  },
});

registerConnector({
  slug: 'read-via-fixture',
  name: 'Read via fixture',
  description: 'test',
  icon: 'File',
  authKind: 'none',
  configSchema: z.object({}).passthrough(),
  async* sync(ctx) {
    ctx.onProgress?.({ kind: 'fetched', uri: 'https://bellwater.test/shows', reader: 'firecrawl', blockedBy: 'HTTP 403', creditsUsed: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    ctx.onProgress?.({ kind: 'fetched', uri: 'https://bellwater.test/shows/quartet-night', reader: 'firecrawl', blockedBy: 'cf-mitigated: challenge', creditsUsed: 1 });
    // A tick between events: the service loads its logger with a dynamic import, and vitest can
    // resolve a third same-tick import of a mocked module to the real one, so the spy would miss it.
    await new Promise(resolve => setTimeout(resolve, 0));
    ctx.onProgress?.({ kind: 'skipped', uri: 'https://bellwater.test/shows/programme.pdf', message: 'unsupported content-type: application/pdf', reader: 'firecrawl', blockedBy: 'HTTP 403', creditsUsed: 1 });
    ctx.onProgress?.({ kind: 'fetched', uri: 'https://bellwater.test/about' });
    yield { externalId: 'kept', uri: 'https://bellwater.test/shows', title: 'Shows', content: 'A show.' };
  },
});

async function seedSource(slug: string, connector: string): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: connector } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

/**
 * The service loads the logger lazily, one dynamic import per line, and under
 * vitest's module runner such an import can resolve well after the run.
 * Wait until `count` lines arrived, then a little longer for any extra.
 * @param count - the lines expected.
 */
async function settleLogs(count: number): Promise<void> {
  await vi.waitFor(() => expect(warn.mock.calls.length).toBeGreaterThanOrEqual(count), { timeout: 10_000 });
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function clean(): Promise<void> {
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

describe('a failure the run survives', () => {
  it('keeps a failed fetch\'s detail on the checkpoint, and nothing extra on the others', async () => {
    const sourceId = await seedSource('bellwater-hall', 'failure-detail-fixture');

    await runSync({ orgId: ORG, sourceId });

    const [checkpoint] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));
    const failures = checkpoint?.failures ?? [];

    expect(failures).toHaveLength(3);
    expect(failures[0]).toMatchObject({ scope: 'connector', uri: BLOCKED, message: MESSAGE, detail: DETAIL });
    expect(failures[1]).toMatchObject({ scope: 'connector', message: 'fetch failed' });
    expect(failures[1]).not.toHaveProperty('detail');
    expect(failures[2]).toMatchObject({ scope: 'document', uri: 'will-not-save', message: 'embedding rate limited' });
    expect(failures[2]).not.toHaveProperty('detail');
  });

  it('writes one warn per error event, with the source slug and the detail', async () => {
    const sourceId = await seedSource('bellwater-hall', 'failure-detail-fixture');

    await runSync({ orgId: ORG, sourceId });
    await settleLogs(3);

    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('source sync reported a failure', {
      sourceId,
      sourceSlug: 'bellwater-hall',
      orgId: ORG,
      scope: 'connector',
      uri: BLOCKED,
      error: MESSAGE,
      status: 403,
      detail: DETAIL,
    });
    expect(warn).toHaveBeenCalledWith('source sync reported a failure', expect.objectContaining({ scope: 'connector', error: 'fetch failed' }));
    expect(warn).toHaveBeenCalledWith('source sync reported a failure', expect.objectContaining({ scope: 'document', uri: 'will-not-save' }));
  });

  it('writes no warn on a clean run, skips included', async () => {
    const sourceId = await seedSource('bellwater-clean', 'failure-detail-clean-fixture');

    await runSync({ orgId: ORG, sourceId });
    await settleLogs(0);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('pages read via a fallback reader', () => {
  it('counts the pages read via Firecrawl, and logs each once at info', async () => {
    const sourceId = await seedSource('bellwater-blocked', 'read-via-fixture');

    await runSync({ orgId: ORG, sourceId });
    await vi.waitFor(() => expect(info.mock.calls.filter(([message]) => message === 'source page read via fallback reader')).toHaveLength(2), { timeout: 10_000 });

    const [checkpoint] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(checkpoint?.counts).toMatchObject({ 'readVia.firecrawl': 2 });
    expect(info).toHaveBeenCalledWith('source page read via fallback reader', {
      sourceId,
      sourceSlug: 'bellwater-blocked',
      orgId: ORG,
      uri: 'https://bellwater.test/shows',
      reader: 'firecrawl',
      blockedBy: 'HTTP 403',
      creditsUsed: 1,
    });
  });

  it('logs the credits of a page Firecrawl read that the run then skipped, without counting it as read', async () => {
    const sourceId = await seedSource('bellwater-skipped-read', 'read-via-fixture');

    await runSync({ orgId: ORG, sourceId });
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('source page read via fallback reader, then skipped', {
      sourceId,
      sourceSlug: 'bellwater-skipped-read',
      orgId: ORG,
      uri: 'https://bellwater.test/shows/programme.pdf',
      reader: 'firecrawl',
      blockedBy: 'HTTP 403',
      creditsUsed: 1,
      reason: 'unsupported content-type: application/pdf',
    }), { timeout: 10_000 });

    const [checkpoint] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(checkpoint?.counts).toMatchObject({ 'readVia.firecrawl': 2 });
  });

  it('carries no readVia count on a run that read every page itself', async () => {
    const sourceId = await seedSource('bellwater-clean', 'failure-detail-clean-fixture');

    await runSync({ orgId: ORG, sourceId });

    const [checkpoint] = await db.select().from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(checkpoint?.counts).toBeDefined();
    expect(Object.keys(checkpoint?.counts ?? {}).filter(key => key.startsWith('readVia.'))).toEqual([]);
  });
});
