/**
 * get_drive_file suite — the read-through properties:
 *
 *   - Source-gated: absent without a drive source in ctx.connectorSources.
 *   - A synced copy answers with ZERO API calls, its chunks rejoined once
 *     (the chunker's overlap is not read twice).
 *   - A title finds the file; a link or `drive:<id>` resolves to the same doc.
 *   - No usable copy (or force_refresh) exports live and UPSERTS through
 *     ingestion.
 *   - Long text pages by offset.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/sources/drive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/sources/drive')>();
  return { ...actual, fetchDriveFileDoc: vi.fn() };
});
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));
vi.mock('@/libs/retrieval/embedder', () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, () => 0))),
}));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { fetchDriveFileDoc } = await import('@/libs/sources/drive');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { driveTools, driveFileIdFrom, joinWithoutOverlap, DRIVE_TEXT_PAGE_CHARS } = await import('./driveFile');

const ORG = 'org_drive_tool';
const ZERO_VEC = Array.from({ length: 1536 }, () => 0);
const CREDS = { refreshToken: 'r', clientId: 'c', clientSecret: 's' };
const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

function ctxFor(sources: string[] = ['drive']): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'financial-analyst',
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
  const [t] = driveTools(ctxFor(sources));
  return t as unknown as Invokable;
}

async function seedSource(slug = 'drive'): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: 'drive' } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function seedDeck(sourceId: number, chunks: string[]): Promise<number> {
  const [doc] = await db
    .insert(knowledgeDocumentSchema)
    .values({
      orgId: ORG,
      sourceId,
      externalId: `drive:${FILE_ID}`,
      title: 'Northwind Board · Q4 Meeting — Deck',
      contentHash: 'hash-deck',
      metadata: { kind: 'drive-file', mimeType: 'application/vnd.google-apps.presentation' },
    })
    .returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values(chunks.map((content, chunkIdx) => ({
    documentId: doc!.id,
    orgId: ORG,
    chunkIdx,
    content,
    contentTokens: 8,
    embedding: ZERO_VEC,
  })));
  return doc!.id;
}

function liveDeck(content: string) {
  return {
    externalId: `drive:${FILE_ID}`,
    title: 'Northwind Board · Q4 Meeting — Deck',
    content,
    lastModifiedAt: new Date('2026-10-05T16:00:00Z'),
    metadata: { kind: 'drive-file', mimeType: 'application/vnd.google-apps.presentation' },
  };
}

beforeEach(async () => {
  vi.mocked(fetchDriveFileDoc).mockReset();
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

describe('helpers', () => {
  it('rejoins chunks without repeating the overlap', () => {
    expect(joinWithoutOverlap(['Revenue 454,313 and operating', 'and operating income -42,355'])).toBe('Revenue 454,313 and operating income -42,355');
    expect(joinWithoutOverlap(['one', 'two'])).toBe('one\ntwo');
  });

  it('reads a file id out of a link or a drive: ref', () => {
    expect(driveFileIdFrom(`https://docs.google.com/presentation/d/${FILE_ID}/edit#slide=id.p`)).toBe(FILE_ID);
    expect(driveFileIdFrom(`https://drive.google.com/open?id=${FILE_ID}`)).toBe(FILE_ID);
    expect(driveFileIdFrom(`drive:${FILE_ID}`)).toBe(FILE_ID);
  });
});

describe('gating + input', () => {
  it('is absent without a drive source, present with one', () => {
    expect(driveTools(ctxFor(['zoom', 'gmail']))).toHaveLength(0);
    expect(driveTools(ctxFor(['google-drive'])).map(t => t.name)).toEqual(['get_drive_file']);
  });

  it('requires file or title', async () => {
    await seedSource();

    expect(await theTool().invoke({})).toMatch(/Pass file/);
  });

  it('reads only drive sources the agent holds', async () => {
    await seedSource('drive-other-team');

    expect(await theTool(['drive']).invoke({ file: FILE_ID })).toMatch(/No Google Drive source is connected/);
  });
});

describe('cache path', () => {
  it('answers from the synced copy with zero API calls, by id, link or title', async () => {
    const sourceId = await seedSource();
    const docId = await seedDeck(sourceId, ['Q3 review. September revenue 454,313 and operating', 'and operating income -42,355.']);

    for (const ref of [{ file: FILE_ID }, { file: `https://docs.google.com/presentation/d/${FILE_ID}/edit` }, { file: String(docId) }, { title: 'q4 meeting' }]) {
      const out = JSON.parse(await theTool().invoke(ref));

      expect(out.source).toBe('cache');
      expect(out.text).toBe('Q3 review. September revenue 454,313 and operating income -42,355.');
      expect(out.fileId).toBe(FILE_ID);
    }

    expect(fetchDriveFileDoc).not.toHaveBeenCalled();
    expect(getCredentialsForSource).not.toHaveBeenCalled();
  });

  it('pages a long file by offset', async () => {
    const sourceId = await seedSource();
    await seedDeck(sourceId, ['x'.repeat(DRIVE_TEXT_PAGE_CHARS + 10)]);

    const first = JSON.parse(await theTool().invoke({ file: FILE_ID }));

    expect(first.text).toHaveLength(DRIVE_TEXT_PAGE_CHARS);
    expect(first.nextOffset).toBe(DRIVE_TEXT_PAGE_CHARS);

    const rest = JSON.parse(await theTool().invoke({ file: FILE_ID, offset: first.nextOffset }));

    expect(rest.text).toHaveLength(10);
    expect(rest.nextOffset).toBeUndefined();
  });

  it('says so when no synced file matches the title', async () => {
    await seedSource();

    expect(await theTool().invoke({ title: 'Kestrel offsite' })).toMatch(/No synced Drive file has a title containing/);
  });
});

describe('live path', () => {
  it('exports live on force_refresh and upserts the copy', async () => {
    const sourceId = await seedSource();
    await seedDeck(sourceId, ['old text']);
    vi.mocked(getCredentialsForSource).mockResolvedValue(CREDS);
    vi.mocked(fetchDriveFileDoc).mockResolvedValue(liveDeck('new text with the financial slide'));

    const out = JSON.parse(await theTool().invoke({ file: FILE_ID, force_refresh: true }));

    expect(out.source).toBe('live');
    expect(out.upserted).toBe('updated');
    expect(out.text).toBe('new text with the financial slide');
    expect(vi.mocked(fetchDriveFileDoc).mock.calls[0]![0].fileId).toBe(FILE_ID);
  });

  it('exports a file the mirror does not hold', async () => {
    await seedSource();
    vi.mocked(getCredentialsForSource).mockResolvedValue(CREDS);
    vi.mocked(fetchDriveFileDoc).mockResolvedValue(liveDeck('fresh deck'));

    const out = JSON.parse(await theTool().invoke({ file: FILE_ID }));

    expect(out.source).toBe('live');
    expect(out.upserted).toBe('created');
  });

  it('degrades with a reason: no credentials, unknown file, export failure', async () => {
    await seedSource();
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);

    expect(await theTool().invoke({ file: FILE_ID })).toMatch(/No Drive credentials/);

    vi.mocked(getCredentialsForSource).mockResolvedValue(CREDS);
    vi.mocked(fetchDriveFileDoc).mockResolvedValue(null);

    expect(await theTool().invoke({ file: FILE_ID })).toMatch(/Drive has no file/);

    vi.mocked(fetchDriveFileDoc).mockRejectedValue(new Error('Drive export failed: 500'));

    expect(await theTool().invoke({ file: FILE_ID })).toMatch(/could not be read; do not guess/);
  });
});
