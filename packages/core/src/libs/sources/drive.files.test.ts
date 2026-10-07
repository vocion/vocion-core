/**
 * Google Drive reads PDFs and Word files it used to land as empty documents:
 * the text is downloaded and read, a scan says it is a scan, a file over the
 * size limit is never downloaded, and a failed download is reported without
 * ending the sync. Drive is a stub serving real files built in memory.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCX_MIME, MAX_DOCUMENT_BYTES } from '@/libs/extract/documentText';
import { docxWithBody, pdfWithPages, wordParagraph } from '@/libs/fixtures/documentFiles';
import { driveConnector } from './drive';

const BASE = 'https://drive.example/drive/v3';

type DriveFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string };

/**
 * Stub Drive: one page of files, and each file's bytes at `alt=media`.
 * @param files - The listing.
 * @param bodies - File id to the bytes (or a status) its download answers with.
 */
function stubDrive(files: DriveFile[], bodies: Record<string, Uint8Array | number>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/files')) {
      return new Response(JSON.stringify({ files }), { status: 200 });
    }
    const id = parsed.pathname.split('/').pop()!;
    const body = bodies[id];
    if (typeof body === 'number' || body === undefined) {
      return new Response('nope', { status: typeof body === 'number' ? body : 404 });
    }
    return new Response(Buffer.from(body), { status: 200 });
  }));
  return calls;
}

/**
 * Drain a sync, collecting documents and progress errors.
 * @param ctx - Extra context fields.
 * @param ctx.since - Incremental watermark.
 */
async function sync(ctx: { since?: Date } = {}) {
  const docs: IngestDoc[] = [];
  const errors: string[] = [];
  for await (const doc of driveConnector.sync({
    sourceId: 1,
    orgId: 'org_drive_files',
    config: { baseUrl: BASE },
    credentials: { token: 'access-token' },
    onProgress: event => event.kind === 'error' && errors.push(event.message ?? ''),
    ...ctx,
  })) {
    docs.push(doc);
  }
  return { docs, errors };
}

afterEach(() => vi.unstubAllGlobals());

describe('drive: PDF and Word files', () => {
  it('asks Drive for each file\'s size, so a big one is never downloaded', async () => {
    const calls = stubDrive([], {});
    await sync();

    expect(new URL(calls[0]!).searchParams.get('fields')).toBe('nextPageToken,files(id,name,mimeType,modifiedTime,size)');
  });

  it('reads a PDF and a Word file into searchable text, and records what was read', async () => {
    const pdf = pdfWithPages(['Invoice 1042 from Larkfield Systems', 'Total due 12,500']);
    const docx = docxWithBody(wordParagraph('Engagement letter for Northwind'));
    stubDrive([
      { id: 'f-pdf', name: 'invoice-1042.pdf', mimeType: 'application/pdf', size: String(pdf.length) },
      { id: 'f-docx', name: 'engagement.docx', mimeType: DOCX_MIME, size: String(docx.length) },
    ], { 'f-pdf': pdf, 'f-docx': docx });
    const { docs, errors } = await sync();

    expect(errors).toEqual([]);
    expect(docs.map(doc => [doc.externalId, doc.content])).toEqual([
      ['drive:f-pdf', 'Invoice 1042 from Larkfield Systems\n\nTotal due 12,500'],
      ['drive:f-docx', 'Engagement letter for Northwind'],
    ]);
    expect(docs[0]!.metadata).toEqual({ kind: 'drive-file', mimeType: 'application/pdf', textExtraction: { status: 'ok', kind: 'pdf', chars: 53, pages: 2 } });
    expect(docs[1]!.metadata?.textExtraction).toMatchObject({ status: 'ok', kind: 'docx' });
  });

  it('lands a scanned PDF as its name and the reason, not as an empty document', async () => {
    const scan = pdfWithPages(['']);
    stubDrive([{ id: 'f-scan', name: 'signed-lease.pdf', mimeType: 'application/pdf', size: String(scan.length) }], { 'f-scan': scan });
    const { docs } = await sync();

    expect(docs[0]!.content).toBe('signed-lease.pdf\n\n[This PDF has no text layer, so it is probably a scan. Vocion does not run OCR, so its contents are not searchable.]');
    expect(docs[0]!.metadata?.textExtraction).toMatchObject({ status: 'no_text_layer' });
  });

  it('does not download a file over the size limit, and says how big it was', async () => {
    const calls = stubDrive([{ id: 'f-big', name: 'board-pack.pdf', mimeType: 'application/pdf', size: String(MAX_DOCUMENT_BYTES * 2) }], {});
    const { docs } = await sync();

    expect(calls.some(url => url.includes('f-big'))).toBe(false);
    expect(docs[0]!.content).toMatch(/^board-pack\.pdf\n\n\[This file is 50 MB; files over 25 MB are not read/);
    expect(docs[0]!.metadata?.textExtraction).toMatchObject({ status: 'too_large', chars: 0 });
  });

  it('reports a failed download and carries on with the next file', async () => {
    const pdf = pdfWithPages(['Second file reads fine']);
    stubDrive([
      { id: 'f-gone', name: 'gone.pdf', mimeType: 'application/pdf', size: '100' },
      { id: 'f-ok', name: 'ok.pdf', mimeType: 'application/pdf', size: String(pdf.length) },
    ], { 'f-gone': 403, 'f-ok': pdf });
    const { docs, errors } = await sync();

    expect(errors).toEqual(['download f-gone: 403']);
    expect(docs.map(doc => doc.content)).toEqual(['', 'Second file reads fine']);
    expect(docs[0]!.metadata?.textExtraction).toBeUndefined();
  });

  it('leaves other binary files as they were: metadata only, nothing downloaded', async () => {
    const calls = stubDrive([{ id: 'f-img', name: 'logo.png', mimeType: 'image/png', size: '2048' }], {});
    const { docs } = await sync();

    expect(calls).toHaveLength(1);
    expect(docs[0]).toMatchObject({ content: '', metadata: { kind: 'drive-file', mimeType: 'image/png' } });
  });
});
