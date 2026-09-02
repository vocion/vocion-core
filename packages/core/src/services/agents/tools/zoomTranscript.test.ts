/**
 * get_zoom_transcript suite — the read-through cache properties:
 *
 *   - Source-gated: absent without a zoom source in ctx.connectorSources.
 *   - Cache hit (synced transcript) answers with ZERO connector calls.
 *   - Miss / not-yet-transcribed / force_refresh goes live and UPSERTS the
 *     fetched doc through the normal ingestion path (search benefits too).
 *   - Degrades honestly when credentials or the recording are missing.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/sources/zoom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/sources/zoom')>();
  return { ...actual, fetchZoomMeetingTranscript: vi.fn() };
});
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));
vi.mock('@/libs/retrieval/embedder', () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, () => 0))),
}));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { fetchZoomMeetingTranscript } = await import('@/libs/sources/zoom');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { zoomTools } = await import('./zoomTranscript');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_zoom_tool';
const ZERO_VEC = Array.from({ length: 1536 }, () => 0);

function ctxFor(sources: string[] = ['zoom']): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: sources,
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function theTool(sources?: string[]): Invokable {
  const [t] = zoomTools(ctxFor(sources));
  return t as unknown as Invokable;
}

async function seedSource(slug = 'zoom'): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: 'zoom' } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function seedTranscriptDoc(sourceId: number, uuid: string, hasTranscript: boolean): Promise<number> {
  const [doc] = await db
    .insert(knowledgeDocumentSchema)
    .values({
      orgId: ORG,
      sourceId,
      externalId: `zoom:${uuid}`,
      title: `Weekly sync — 2026-08-20`,
      contentHash: `hash-${uuid}`,
      metadata: { kind: 'zoom-recording', meetingId: 12345, hasTranscript, shareUrl: 'https://zoom.us/rec/x' },
    })
    .returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values([
    { documentId: doc!.id, orgId: ORG, chunkIdx: 0, content: 'CHRIS: hello', contentTokens: 3, embedding: ZERO_VEC },
    { documentId: doc!.id, orgId: ORG, chunkIdx: 1, content: 'ANDREW: hi there', contentTokens: 4, embedding: ZERO_VEC },
  ]);
  return doc!.id;
}

beforeEach(async () => {
  vi.mocked(fetchZoomMeetingTranscript).mockReset();
  vi.mocked(getCredentialsForSource).mockReset();
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('gating', () => {
  it('is absent without a zoom source, present with one', () => {
    expect(zoomTools(ctxFor(['gmail', 'hubspot']))).toHaveLength(0);
    expect(zoomTools(ctxFor(['zoom'])).map(t => t.name)).toEqual(['get_zoom_transcript']);
    expect(buildDomainTools(ctxFor(['zoom-sales'])).some(t => t.name === 'get_zoom_transcript')).toBe(true);
  });
});

describe('cache path', () => {
  it('answers from the synced mirror with zero connector calls', async () => {
    const sourceId = await seedSource();
    await seedTranscriptDoc(sourceId, 'uuid-1', true);

    const out = JSON.parse(await theTool().invoke({ meeting: 'uuid-1' }));

    expect(out.source).toBe('cache');
    expect(out.transcript).toContain('CHRIS: hello');
    expect(out.transcript).toContain('ANDREW: hi there');
    expect(out.shareUrl).toBe('https://zoom.us/rec/x');
    expect(fetchZoomMeetingTranscript).not.toHaveBeenCalled();
    expect(getCredentialsForSource).not.toHaveBeenCalled();
  });

  it('matches by numeric meetingId metadata too', async () => {
    const sourceId = await seedSource();
    await seedTranscriptDoc(sourceId, 'uuid-1', true);

    const out = JSON.parse(await theTool().invoke({ meeting: '12345' }));

    expect(out.source).toBe('cache');
    expect(fetchZoomMeetingTranscript).not.toHaveBeenCalled();
  });

  it('treats a transcript-less synced doc as a miss', async () => {
    const sourceId = await seedSource();
    await seedTranscriptDoc(sourceId, 'uuid-1', false);
    vi.mocked(getCredentialsForSource).mockResolvedValue({ accountId: 'a', clientId: 'b', clientSecret: 'c' });
    vi.mocked(fetchZoomMeetingTranscript).mockResolvedValue({
      doc: {
        externalId: 'zoom:uuid-1',
        title: 'Weekly sync — 2026-08-20',
        content: 'Meeting: Weekly sync\n\nTranscript:\nCHRIS: now transcribed',
        lastModifiedAt: null,
        metadata: { kind: 'zoom-recording', meetingId: 12345, hasTranscript: true, shareUrl: null },
      },
      hasTranscript: true,
    });

    const out = JSON.parse(await theTool().invoke({ meeting: 'uuid-1' }));

    expect(out.source).toBe('live');
    expect(out.upserted).toBe('updated');
    expect(fetchZoomMeetingTranscript).toHaveBeenCalledOnce();
  });
});

describe('live path', () => {
  it('fetches, upserts into the mirror, and reports provenance', async () => {
    await seedSource();
    vi.mocked(getCredentialsForSource).mockResolvedValue({ accountId: 'a', clientId: 'b', clientSecret: 'c' });
    vi.mocked(fetchZoomMeetingTranscript).mockResolvedValue({
      doc: {
        externalId: 'zoom:uuid-live',
        title: 'Discovery call — 2026-08-25',
        content: 'Meeting: Discovery call\n\nTranscript:\nPROSPECT: tell me more',
        lastModifiedAt: null,
        metadata: { kind: 'zoom-recording', meetingId: 999, hasTranscript: true, shareUrl: null },
      },
      hasTranscript: true,
    });

    const out = JSON.parse(await theTool().invoke({ meeting: 'uuid-live' }));

    expect(out.source).toBe('live');
    expect(out.upserted).toBe('created');
    expect(out.transcript).toContain('PROSPECT: tell me more');

    const docs = await db.select().from(knowledgeDocumentSchema);

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('zoom:uuid-live');
  });

  it('force_refresh skips a valid cache and re-fetches', async () => {
    const sourceId = await seedSource();
    await seedTranscriptDoc(sourceId, 'uuid-1', true);
    vi.mocked(getCredentialsForSource).mockResolvedValue({ accountId: 'a', clientId: 'b', clientSecret: 'c' });
    vi.mocked(fetchZoomMeetingTranscript).mockResolvedValue({
      doc: {
        externalId: 'zoom:uuid-1',
        title: 'Weekly sync — 2026-08-20',
        content: 'Meeting: Weekly sync\n\nTranscript:\nCHRIS: hello',
        lastModifiedAt: null,
        metadata: { kind: 'zoom-recording', meetingId: 12345, hasTranscript: true, shareUrl: null },
      },
      hasTranscript: true,
    });

    const out = JSON.parse(await theTool().invoke({ meeting: 'uuid-1', force_refresh: true }));

    expect(out.source).toBe('live');
    expect(fetchZoomMeetingTranscript).toHaveBeenCalledOnce();
  });

  it('reports a recording without a ready transcript honestly', async () => {
    await seedSource();
    vi.mocked(getCredentialsForSource).mockResolvedValue({ accountId: 'a', clientId: 'b', clientSecret: 'c' });
    vi.mocked(fetchZoomMeetingTranscript).mockResolvedValue({
      doc: {
        externalId: 'zoom:uuid-fresh',
        title: 'Just ended — 2026-08-26',
        content: 'Meeting: Just ended\n\n(no transcript available)',
        lastModifiedAt: null,
        metadata: { kind: 'zoom-recording', meetingId: 1, hasTranscript: false, shareUrl: null },
      },
      hasTranscript: false,
    });

    const out = await theTool().invoke({ meeting: 'uuid-fresh' });

    expect(out).toMatch(/transcript is not ready yet/);
    expect(await db.select().from(knowledgeDocumentSchema)).toHaveLength(0);
  });
});

describe('degradation', () => {
  it('says so when no recording exists', async () => {
    await seedSource();
    vi.mocked(getCredentialsForSource).mockResolvedValue({ accountId: 'a', clientId: 'b', clientSecret: 'c' });
    vi.mocked(fetchZoomMeetingTranscript).mockResolvedValue(null);

    const out = await theTool().invoke({ meeting: 'nope' });

    expect(out).toMatch(/no cloud recording/);
  });

  it('says so when no zoom source / no credentials exist', async () => {
    expect(await theTool().invoke({ meeting: 'x' })).toMatch(/No zoom source is connected/);

    await seedSource();
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);

    expect(await theTool().invoke({ meeting: 'x' })).toMatch(/No zoom credentials/);
    expect(fetchZoomMeetingTranscript).not.toHaveBeenCalled();
  });
});
