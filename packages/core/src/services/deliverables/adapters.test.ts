import { Buffer } from 'node:buffer';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { renderAvailable, closeRenderer } = await import('@/libs/documents/render');
const { createDeck, reviseDeck } = await import('@/services/decks/DeckEngine');
const { createDocument, reviseDocument } = await import('@/services/documents/DocumentEngine');
const { getArtifact } = await import('@/services/ArtifactService');
const { deckToPptx } = await import('@/libs/decks/pptx/export');
const { documentToDocx } = await import('@/libs/documents/docx/export');
const { AdapterFileError, exportDeckPptx, exportDocumentDocx, importDeckPptx, importDocumentDocx, officeKindOf } = await import('./adapters');

const available = await renderAvailable();

const ORG = 'org_deliverable_adapters_test';
const AGENT = { kind: 'agent' as const, id: 'agent:proposal-writer' };
const PERSON = { kind: 'human' as const, id: 'usr-dana' };

const slide = (id: string, body: string) => `<section id="${id}" style="padding:120px;background:#0F1B2D;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif">${body}<aside>From the Contoso Supply kickoff.</aside></section>`;
const DECK = {
  title: 'Northwind quarterly review',
  order: ['cover', 'plan'],
  slides: {
    cover: slide('cover', '<h1 style="font-size:96px;margin:0">Northwind quarterly review</h1>'),
    plan: slide('plan', '<h2 style="font-size:64px;margin:0">The plan</h2><p style="font-size:40px">Three phases for Kestrel Capital.</p>'),
  },
  playbook: 'concept',
};

const DOC_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Larkfield Systems - Scope</title></head><body>
<article class="sheet"><div class="body"><h1>Larkfield Systems scope</h1><p>We start with the intake flow for Bellwater Hall.</p></div></article>
</body></html>`;

async function editZip(buf: Buffer, file: string, fn: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  zip.file(file, fn(await zip.file(file)!.async('string')));
  return zip.generateAsync({ type: 'nodebuffer' });
}

beforeAll(async () => {
  process.env.VOCION_ARTIFACTS_DIR = await mkdtemp(path.join(tmpdir(), 'vocion-adapters-'));
});

afterAll(async () => {
  delete process.env.VOCION_ARTIFACTS_DIR;
  await closeRenderer();
});

describe('office file kind, from the bytes', () => {
  it('tells PowerPoint from Word from anything else, whatever the name says', async () => {
    const pptx = await deckToPptx({ deck: DECK, layouts: [] });
    const docx = await documentToDocx({ html: DOC_HTML, title: 'Scope' });

    expect(await officeKindOf(pptx)).toBe('pptx');
    expect(await officeKindOf(docx)).toBe('docx');
    expect(await officeKindOf(Buffer.from('%PDF-1.7 not a zip'))).toBeNull();
  });

  it('refuses the wrong kind of file for a deck and for a document, with a sentence', async () => {
    const { artifact: deck } = await createDeck({ orgId: ORG, author: AGENT, deck: DECK, verify: { screenshots: false, pdf: false } });
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    const docx = await documentToDocx({ html: DOC_HTML, title: 'Scope' });
    const pptx = await deckToPptx({ deck: DECK, layouts: [] });

    await expect(importDeckPptx(ORG, deck.id, docx, { author: PERSON })).rejects.toThrow('That is a Word file; a deck takes back a PowerPoint file (.pptx).');
    await expect(importDocumentDocx(ORG, doc.id, pptx, { author: PERSON })).rejects.toBeInstanceOf(AdapterFileError);
    await expect(importDocumentDocx(ORG, doc.id, Buffer.from('plain text'), { author: PERSON })).rejects.toThrow('not a PowerPoint or Word file');
    expect((await getArtifact({ orgId: ORG, id: deck.id }))!.currentVersion).toBe(1);
  }, 120_000);
});

describe('DOCX round trip through the document engine', () => {
  it('exports a file artifact that records where it went, and brings an edit back as one version', async () => {
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    const out = await exportDocumentDocx({ orgId: ORG, id: doc.id, author: PERSON });

    expect(out.filename).toBe('Larkfield Systems - Scope.docx');
    expect(out.file.kind).toBe('file');
    expect((out.file.spec as { exportedFrom?: unknown }).exportedFrom).toMatchObject({ artifactId: doc.id, version: 1, format: 'docx' });
    // Exporting is not an edit.
    expect((await getArtifact({ orgId: ORG, id: doc.id }))!.currentVersion).toBe(1);

    const edited = await editZip(out.data, 'word/document.xml', xml => xml.replace('Bellwater Hall', 'Acme'));
    const res = await importDocumentDocx(ORG, doc.id, edited, { baseVersion: 1, author: PERSON });

    expect(res.status).toBe('written');
    expect(res.status !== 'stale' && res.version).toBe(2);
    expect(res.status !== 'stale' && res.receipt).toContain('Sheet 1: "We start with the intake flow for Bellwater Hall." → "We start with the intake flow for Acme."');

    const row = await getArtifact({ orgId: ORG, id: doc.id });

    expect((row!.spec as { html: string }).html).toContain('intake flow for Acme.');
  }, 120_000);

  it('refuses a stale baseVersion with the sheet-by-sheet diff and writes nothing', async () => {
    const { artifact: doc } = await createDocument({ orgId: ORG, author: AGENT, html: DOC_HTML });
    const out = await exportDocumentDocx({ orgId: ORG, id: doc.id, author: PERSON });
    await reviseDocument({ orgId: ORG, id: doc.id, author: AGENT, changeSummary: 'renamed the venue', html: DOC_HTML.replace('Bellwater Hall', 'Northwind') });

    const res = await importDocumentDocx(ORG, doc.id, out.data, { baseVersion: 1, author: PERSON });

    expect(res.status).toBe('stale');
    expect(res.status === 'stale' && res.diff).toContain('Sheet 1');
    expect((await getArtifact({ orgId: ORG, id: doc.id }))!.currentVersion).toBe(2);
  }, 120_000);
});

describe('PPTX stale refusal (no renderer needed)', () => {
  it('refuses a stale baseVersion with the slide-by-slide diff, like deck_checkin', async () => {
    const { artifact: deck } = await createDeck({ orgId: ORG, author: AGENT, deck: DECK, verify: { screenshots: false, pdf: false } });
    await reviseDeck({ orgId: ORG, id: deck.id, author: AGENT, changeSummary: 'tightened the plan', ops: [{ op: 'replace_text', find: 'Three phases', replace: 'Two phases' }], verify: { screenshots: false, pdf: false } });
    const pptx = await deckToPptx({ deck: DECK, layouts: [] });

    const res = await importDeckPptx(ORG, deck.id, pptx, { baseVersion: 1, author: PERSON });

    expect(res.status).toBe('stale');
    expect(res.status === 'stale' && res.diff).toContain('Slide 2 [plan]');
    expect((await getArtifact({ orgId: ORG, id: deck.id }))!.currentVersion).toBe(2);
  }, 120_000);
});

describe.skipIf(!available.ok)('PPTX round trip through the deck engine (real Chromium)', () => {
  it('exports from the engine\'s own render and brings a text edit back as one re-verified version', async () => {
    const { artifact: deck } = await createDeck({ orgId: ORG, author: AGENT, deck: DECK, verify: { screenshots: false, pdf: false } });
    const out = await exportDeckPptx({ orgId: ORG, id: deck.id, author: PERSON });

    expect(out.filename).toBe('Northwind quarterly review.pptx');
    expect(await officeKindOf(out.data)).toBe('pptx');
    expect((await getArtifact({ orgId: ORG, id: deck.id }))!.currentVersion).toBe(1);

    // The engine's page wraps each section in .vocion-slide; the layout pass still finds and names every object.
    const slide2 = await (await JSZip.loadAsync(out.data)).file('ppt/slides/slide2.xml')!.async('string');

    expect(slide2).toContain('vocion:plan:');

    const unchanged = await importDeckPptx(ORG, deck.id, out.data, { baseVersion: 1, author: PERSON });

    expect(unchanged.status).toBe('unchanged');

    const edited = await editZip(out.data, 'ppt/slides/slide2.xml', xml => xml.replace('Three phases for Kestrel Capital.', 'Three phases for Contoso Supply.'));
    const res = await importDeckPptx(ORG, deck.id, edited, { baseVersion: 1, author: PERSON, tool: 'PowerPoint' });

    expect(res.status).toBe('written');
    expect(res.status === 'written' && res.report.map(r => [r.slideId, r.status])).toEqual([['cover', 'kept'], ['plan', 'text-edited']]);
    expect(res.status === 'written' && res.receipt).toContain('Slide 2 (plan): text edited');

    const row = await getArtifact({ orgId: ORG, id: deck.id });
    const spec = row!.spec as { slides: Record<string, string>; origin?: unknown; verification?: { slides: unknown[] } };

    expect(row!.currentVersion).toBe(2);
    expect(spec.slides.plan).toContain('Three phases for Contoso Supply.');
    expect(spec.slides.cover).toBe(DECK.slides.cover);
    expect(spec.origin).toEqual({ kind: 'import', tool: 'PowerPoint', baseVersion: 1 });
    expect(spec.verification?.slides).toHaveLength(2);
  }, 180_000);
});
