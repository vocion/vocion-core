import { Buffer } from 'node:buffer';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
// These are about the HTTP contract, not pixels: the engines record "renderer unavailable" and move on.
vi.mock('@/libs/documents/render', async orig => ({ ...(await orig<object>()), renderAvailable: async () => ({ ok: false, reason: 'not in this test' }) }));

const { clerkAuth } = await import('@/libs/Auth');
const { createDocument, reviseDocument } = await import('@/services/documents/DocumentEngine');
const { createDeck } = await import('@/services/decks/DeckEngine');
const { documentToDocx } = await import('@/libs/documents/docx/export');
const { GET: exportGet } = await import('./export/route');
const { POST: importPost } = await import('./import/route');

const mockSession = vi.mocked(clerkAuth);
const ORG = 'org_deliverable_routes_a';
const OTHER = 'org_deliverable_routes_b';
const AGENT = { kind: 'agent' as const, id: 'agent:proposal-writer' };
const DOC_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Contoso Supply - Scope</title></head><body>
<article class="sheet"><div class="body"><h1>Contoso Supply scope</h1><p>We start with the intake flow for Northwind.</p></div></article>
</body></html>`;

function session(orgId: string) {
  mockSession.mockResolvedValue({ userId: 'usr-1', orgId, role: 'member' } as never);
}
const params = (artifactId: number | string) => ({ params: Promise.resolve({ artifactId: String(artifactId) }) });

function upload(id: number, file: Buffer, name: string, baseVersion?: number) {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(file)]), name);
  if (baseVersion !== undefined) {
    form.set('baseVersion', String(baseVersion));
  }
  return new NextRequest(`http://localhost/api/deliverables/${id}/import`, { method: 'POST', body: form });
}

beforeAll(async () => {
  process.env.VOCION_ARTIFACTS_DIR = await mkdtemp(path.join(tmpdir(), 'vocion-deliverable-routes-'));
});

beforeEach(() => {
  mockSession.mockReset();
});

afterAll(() => {
  delete process.env.VOCION_ARTIFACTS_DIR;
});

describe('GET /api/deliverables/:id/export', () => {
  it('streams a DOCX as a download named from the title', async () => {
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    session(ORG);
    const res = await exportGet(new NextRequest(`http://localhost/api/deliverables/${doc.id}/export?format=docx`), params(doc.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers.get('content-disposition')).toContain('filename="Contoso Supply - Scope.docx"');
    expect(res.headers.get('cache-control')).toMatch(/private/);

    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));

    expect(zip.file('word/document.xml')).toBeTruthy();
  });

  it('refuses a format that does not fit the kind, and is a 404 for another workspace', async () => {
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    session(ORG);
    const wrong = await exportGet(new NextRequest(`http://localhost/api/deliverables/${doc.id}/export?format=pptx`), params(doc.id));

    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ ok: false, reason: 'A document downloads as PDF or DOCX, not PPTX.' });

    session(OTHER);
    const other = await exportGet(new NextRequest(`http://localhost/api/deliverables/${doc.id}/export?format=docx`), params(doc.id));

    expect(other.status).toBe(404);
  });

  it('is a 401 when signed out', async () => {
    mockSession.mockResolvedValue({ userId: null, orgId: null } as never);
    const res = await exportGet(new NextRequest('http://localhost/api/deliverables/1/export?format=pdf'), params(1));

    expect(res.status).toBe(401);
  });
});

describe('POST /api/deliverables/:id/import', () => {
  it('brings an edited DOCX back as a new version with the report and receipt', async () => {
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    const docx = await documentToDocx({ html: DOC_HTML, title: 'Scope' });
    const zip = await JSZip.loadAsync(docx);
    zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('Northwind', 'Acme'));
    session(ORG);
    const res = await importPost(upload(doc.id, await zip.generateAsync({ type: 'nodebuffer' }), 'scope.docx', 1), params(doc.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, version: 2, report: { kept: expect.any(Number), unplaced: [] } });
    expect(body.receipt).toContain('→ "We start with the intake flow for Acme."');
  });

  it('refuses a stale baseVersion with 409 and the diff', async () => {
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    await reviseDocument({ orgId: ORG, id: doc.id, author: AGENT, changeSummary: 'renamed', html: DOC_HTML.replace('Northwind', 'Bellwater Hall') });
    session(ORG);
    const res = await importPost(upload(doc.id, await documentToDocx({ html: DOC_HTML, title: 'Scope' }), 'scope.docx', 1), params(doc.id));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('changed in Vocion since v1');
    expect(body.diff).toContain('Sheet 1');
  });

  it('refuses the wrong kind of file with 415 and a sentence, whatever its name', async () => {
    const { artifact: deck } = await createDeck({ orgId: ORG, author: AGENT, deck: { title: 'Northwind review', order: ['cover'], slides: { cover: '<section id="cover"><h1>Northwind</h1></section>' } } });
    session(ORG);
    const res = await importPost(upload(deck.id, await documentToDocx({ html: DOC_HTML, title: 'Scope' }), 'review.pptx'), params(deck.id));

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, reason: 'That is a Word file; a deck takes back a PowerPoint file (.pptx).' });
  });

  it('asks for the file when none was sent', async () => {
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    session(ORG);
    const res = await importPost(new NextRequest(`http://localhost/api/deliverables/${doc.id}/import`, { method: 'POST', body: new FormData() }), params(doc.id));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toContain('.docx');
  });
});
