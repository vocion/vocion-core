/**
 * Gmail with `attachments: true`: every PDF and Word attachment becomes a
 * document of its own, read from the bytes; a credential with metadata access
 * only is told once and the run carries on; with the setting off, nothing
 * changes from before. Gmail is a stub; the files are real, built in memory.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCX_MIME, MAX_DOCUMENT_BYTES } from '@/libs/extract/documentText';
import { docxWithBody, pdfWithPages, wordParagraph } from '@/libs/fixtures/documentFiles';
import { gmailConnector, readableAttachments } from './gmail';

const BASE = 'https://gmail.example/gmail/v1';

const HEADERS = [
  { name: 'Subject', value: 'October invoice' },
  { name: 'From', value: 'Billing <billing@larkfield.example>' },
];

/**
 * A full message with the given parts under a multipart/mixed top part.
 * @param id - The message id.
 * @param parts - The parts after the text body.
 */
function fullMessage(id: string, parts: unknown[]) {
  return {
    id,
    threadId: `t-${id}`,
    snippet: 'Please find the invoice attached.',
    internalDate: '1790000000000',
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: HEADERS,
      parts: [{ partId: '0', mimeType: 'text/plain', filename: '', body: { size: 30, data: Buffer.from('Please find the invoice attached.').toString('base64url') } }, ...parts],
    },
  };
}

type Answer = { status?: number; body: unknown };

/**
 * Stub Gmail. `messages` answers by message id and format; `attachments` by attachment id.
 * @param input - What each URL answers.
 * @param input.ids - The message ids the list returns.
 * @param input.full - Message id to the full message, or a status.
 * @param input.metadata - Message id to the metadata message.
 * @param input.attachments - Attachment id to its body, or a status.
 */
function stubGmail(input: { ids: string[]; full?: Record<string, unknown>; metadata?: Record<string, unknown>; attachments?: Record<string, Answer> }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    const json = (answer: Answer) => new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
    if (path.endsWith('/users/me/messages')) {
      return json({ body: { messages: input.ids.map(id => ({ id })) } });
    }
    const attachment = path.match(/\/messages\/([^/]+)\/attachments\/([^/]+)$/);
    if (attachment) {
      return json(input.attachments?.[decodeURIComponent(attachment[2]!)] ?? { status: 404, body: {} });
    }
    const id = path.split('/').pop()!;
    if (parsed.searchParams.get('format') === 'full') {
      const full = input.full?.[id];
      return typeof full === 'number' ? json({ status: full, body: { error: { code: full } } }) : json({ body: full });
    }
    return json({ body: input.metadata?.[id] ?? { id, payload: { headers: HEADERS } } });
  }));
  return calls;
}

/**
 * Drain a Gmail sync.
 * @param config - Source config on top of the stub base URL.
 */
async function sync(config: Record<string, unknown>) {
  const docs: IngestDoc[] = [];
  const errors: string[] = [];
  for await (const doc of gmailConnector.sync({
    sourceId: 1,
    orgId: 'org_gmail_attachments',
    config: { baseUrl: BASE, ...config },
    credentials: { token: 'access-token' },
    onProgress: event => event.kind === 'error' && errors.push(event.message ?? ''),
  })) {
    docs.push(doc);
  }
  return { docs, errors };
}

afterEach(() => vi.unstubAllGlobals());

describe('readableAttachments', () => {
  it('finds PDF and Word attachments at any depth, by type or by extension, and skips the rest', () => {
    const found = readableAttachments({
      partId: '',
      parts: [
        { partId: '0', mimeType: 'text/plain', filename: '' },
        { partId: '1', mimeType: 'multipart/alternative', parts: [{ partId: '1.0', mimeType: 'application/pdf', filename: 'nested.pdf', body: { attachmentId: 'a1', size: 10 } }] },
        { partId: '2', mimeType: 'application/octet-stream', filename: 'statement.PDF', body: { attachmentId: 'a2' } },
        { partId: '3', mimeType: DOCX_MIME, filename: 'sow.docx', body: { data: 'abc', size: 3 } },
        { partId: '4', mimeType: 'image/png', filename: 'logo.png', body: { attachmentId: 'a4' } },
        { partId: '5', mimeType: 'application/pdf', filename: '', body: { attachmentId: 'a5' } },
      ],
    });

    expect(found.map(a => [a.partId, a.filename, a.kind, a.attachmentId ?? null, a.inlineData ?? null])).toEqual([
      ['1.0', 'nested.pdf', 'pdf', 'a1', null],
      ['2', 'statement.PDF', 'pdf', 'a2', null],
      ['3', 'sow.docx', 'docx', null, 'abc'],
    ]);
  });
});

describe('gmail with attachments on', () => {
  it('yields the message as before, then each attachment as its own document with its text', async () => {
    const pdf = pdfWithPages(['Invoice 2207 Larkfield Systems', 'Amount due 4,800']);
    const docx = docxWithBody(wordParagraph('Change order 3 for Northwind'));
    stubGmail({
      ids: ['m1'],
      full: { m1: fullMessage('m1', [
        { partId: '1', mimeType: 'application/pdf', filename: 'invoice-2207.pdf', body: { attachmentId: 'att-pdf', size: pdf.length } },
        { partId: '2', mimeType: DOCX_MIME, filename: 'change-order.docx', body: { attachmentId: 'att-docx', size: docx.length } },
      ]) },
      attachments: {
        'att-pdf': { body: { size: pdf.length, data: pdf.toString('base64url') } },
        'att-docx': { body: { size: docx.length, data: docx.toString('base64url') } },
      },
    });
    const { docs, errors } = await sync({ attachments: true });

    expect(errors).toEqual([]);
    expect(docs.map(doc => doc.externalId)).toEqual(['gmail:m1', 'gmail-attachment:m1:1', 'gmail-attachment:m1:2']);
    expect(docs[0]!.content).toBe('From: Billing <billing@larkfield.example>\nSubject: October invoice\n\nPlease find the invoice attached.');
    expect(docs[1]).toMatchObject({
      title: 'invoice-2207.pdf — October invoice',
      content: 'Attachment: invoice-2207.pdf\nFrom: Billing <billing@larkfield.example>\nSubject: October invoice\n\nInvoice 2207 Larkfield Systems\n\nAmount due 4,800',
      lastModifiedAt: new Date(1790000000000),
      metadata: { kind: 'gmail-attachment', messageId: 'm1', threadId: 't-m1', filename: 'invoice-2207.pdf', mimeType: 'application/pdf', bytes: pdf.length, textExtraction: { status: 'ok', kind: 'pdf', pages: 2 } },
    });
    expect(docs[2]!.content).toContain('Change order 3 for Northwind');
  });

  it('reads an attachment that arrived inline without a second call', async () => {
    const docx = docxWithBody(wordParagraph('Inline memo'));
    const calls = stubGmail({ ids: ['m2'], full: { m2: fullMessage('m2', [{ partId: '1', mimeType: DOCX_MIME, filename: 'memo.docx', body: { size: docx.length, data: docx.toString('base64url') } }]) } });
    const { docs } = await sync({ attachments: true });

    expect(calls.some(url => url.includes('/attachments/'))).toBe(false);
    expect(docs[1]!.content).toContain('Inline memo');
  });

  it('lands a scanned PDF and an oversized one with their reasons, and never downloads the big one', async () => {
    const scan = pdfWithPages(['']);
    const calls = stubGmail({
      ids: ['m3'],
      full: { m3: fullMessage('m3', [
        { partId: '1', mimeType: 'application/pdf', filename: 'scan.pdf', body: { attachmentId: 'att-scan', size: scan.length } },
        { partId: '2', mimeType: 'application/pdf', filename: 'huge.pdf', body: { attachmentId: 'att-huge', size: MAX_DOCUMENT_BYTES + 1 } },
      ]) },
      attachments: { 'att-scan': { body: { data: scan.toString('base64url') } } },
    });
    const { docs } = await sync({ attachments: true });

    expect(calls.some(url => url.includes('att-huge'))).toBe(false);
    expect(docs[1]!.content).toMatch(/scan\.pdf\n\n\[This PDF has no text layer, so it is probably a scan\. Vocion does not run OCR/);
    expect(docs[2]!.metadata?.textExtraction).toMatchObject({ status: 'too_large' });
  });

  it('reports an attachment it could not download and keeps the rest', async () => {
    const pdf = pdfWithPages(['Remittance advice']);
    stubGmail({
      ids: ['m4'],
      full: { m4: fullMessage('m4', [
        { partId: '1', mimeType: 'application/pdf', filename: 'gone.pdf', body: { attachmentId: 'att-gone', size: 10 } },
        { partId: '2', mimeType: 'application/pdf', filename: 'remittance.pdf', body: { attachmentId: 'att-ok', size: pdf.length } },
      ]) },
      attachments: { 'att-gone': { status: 500, body: {} }, 'att-ok': { body: { data: pdf.toString('base64url') } } },
    });
    const { docs, errors } = await sync({ attachments: true });

    expect(errors).toEqual(['attachment gone.pdf on m4: 500']);
    expect(docs.map(doc => doc.externalId)).toEqual(['gmail:m4', 'gmail-attachment:m4:2']);
  });

  it('says once that the login holds metadata access only, and carries on without attachments', async () => {
    const calls = stubGmail({ ids: ['m5', 'm6'], full: { m5: 403, m6: 403 } });
    const { docs, errors } = await sync({ attachments: true });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/metadata access only/);
    expect(docs.map(doc => doc.externalId)).toEqual(['gmail:m5', 'gmail:m6']);
    // One full fetch was refused; every fetch after it asked for metadata.
    expect(calls.filter(url => url.includes('format=full'))).toHaveLength(1);
  });
});

describe('gmail with attachments off (the default)', () => {
  it('fetches metadata only and yields no attachment documents, as before', async () => {
    const calls = stubGmail({ ids: ['m7'] });
    const { docs } = await sync({});

    expect(calls.some(url => url.includes('format=full'))).toBe(false);
    expect(calls.some(url => url.includes('format=metadata'))).toBe(true);
    expect(docs.map(doc => doc.externalId)).toEqual(['gmail:m7']);
  });
});
