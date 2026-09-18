import type { ArtifactRow } from '@/services/ArtifactService';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  acceptUpload,
  attachmentFromArtifact,
  attachmentsForWire,
  composeUserContent,
  composeUserText,
  extractText,
  historyMarker,
  loadedFromArtifact,
  MAX_DOCUMENT_CHARS,
  MAX_IMAGE_BYTES,
} from './attachments';

describe('acceptUpload — what may be attached', () => {
  it('takes images, PDFs and text files by reported type', () => {
    expect(acceptUpload({ name: 'shot.png', type: 'image/png', size: 1000 })).toMatchObject({ ok: true, accepted: { contentType: 'image/png', ext: 'png', kind: 'image' } });
    expect(acceptUpload({ name: 'deck.pdf', type: 'application/pdf', size: 1000 })).toMatchObject({ ok: true, accepted: { contentType: 'application/pdf', kind: 'document' } });
    expect(acceptUpload({ name: 'notes.txt', type: 'text/plain', size: 10 })).toMatchObject({ ok: true, accepted: { kind: 'document' } });
  });

  it('falls back to the extension when the browser reports octet-stream — .md and .csv do', () => {
    expect(acceptUpload({ name: 'README.md', type: 'application/octet-stream', size: 10 })).toMatchObject({ ok: true, accepted: { contentType: 'text/markdown', ext: 'md' } });
    expect(acceptUpload({ name: 'leads.CSV', type: '', size: 10 })).toMatchObject({ ok: true, accepted: { contentType: 'text/csv' } });
  });

  it('refuses what it does not read, with the reason', () => {
    const v = acceptUpload({ name: 'model.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 10 });

    expect(v.ok).toBe(false);
    expect((v as { reason: string }).reason).toContain('model.xlsx');
    expect(acceptUpload({ name: 'empty.txt', type: 'text/plain', size: 0 })).toMatchObject({ ok: false });
  });

  it('caps an image tighter than a document', () => {
    expect(acceptUpload({ name: 'big.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toMatchObject({ ok: false });
    expect(acceptUpload({ name: 'big.pdf', type: 'application/pdf', size: MAX_IMAGE_BYTES + 1 })).toMatchObject({ ok: true });
  });
});

describe('extractText', () => {
  it('decodes a text file and tidies its whitespace', async () => {
    expect(await extractText(Buffer.from('a  \r\nb\r\n\r\n\r\n\r\nc'), 'text/plain')).toBe('a\nb\n\nc');
  });
});

const row = (over: Partial<ArtifactRow> & { spec?: Record<string, unknown> }): ArtifactRow => ({
  id: 7,
  title: 'deck.pdf',
  kind: 'file',
  spec: { contentType: 'application/pdf', bytes: 1234, filename: 'org-abc.pdf', text: 'Q3 plan' },
  ...over,
} as unknown as ArtifactRow);

describe('attachments from artifact rows', () => {
  it('builds the chip from the row, pointing at the authenticated route', () => {
    expect(attachmentFromArtifact(row({}))).toEqual({ id: 7, title: 'deck.pdf', contentType: 'application/pdf', bytes: 1234, url: '/api/artifacts/7', kind: 'document' });
    expect(attachmentFromArtifact(row({ spec: { contentType: 'image/png', bytes: 9 } })).kind).toBe('image');
  });

  it('carries the extracted text for a document and the stored filename for an image', () => {
    expect(loadedFromArtifact(row({}))).toMatchObject({ text: 'Q3 plan', filename: 'org-abc.pdf' });
    expect(loadedFromArtifact(row({ spec: { contentType: 'image/png', bytes: 9, filename: 'org-img.png', text: 'never' } }))).not.toHaveProperty('text');
  });
});

describe('composeUserContent — what the model is handed', () => {
  const noFs = async () => null;

  it('is the plain message when nothing is attached', async () => {
    expect(await composeUserContent('hi', [])).toBe('hi');
  });

  it('inlines a document\'s text under a header naming the file', async () => {
    const out = await composeUserContent('Summarise this.', [loadedFromArtifact(row({}))], noFs);

    expect(typeof out).toBe('string');

    expect(out).toContain('Summarise this.');
    expect(out).toContain('--- attached: deck.pdf (application/pdf, 1234 bytes) ---\nQ3 plan');
  });

  it('says when a document had no text rather than sending nothing', async () => {
    const out = await composeUserContent('Read it.', [loadedFromArtifact(row({ spec: { contentType: 'application/pdf', bytes: 1, text: '' } }))], noFs);

    expect(out).toContain('no text could be extracted');
  });

  it('cuts a long document at the cap and says so', async () => {
    const long = 'x'.repeat(MAX_DOCUMENT_CHARS + 500);
    const out = await composeUserContent('Read it.', [loadedFromArtifact(row({ spec: { contentType: 'text/plain', bytes: long.length, text: long } }))], noFs) as string;

    expect(out).toContain('the rest was cut');
    expect(out.length).toBeLessThan(long.length);
  });

  it('sends an image as an inline block after the text, reading its bytes from the store', async () => {
    const img = loadedFromArtifact(row({ id: 8, title: 'shot.png', spec: { contentType: 'image/png', bytes: 3, filename: 'org-shot.png' } }));
    const out = await composeUserContent('What is this?', [img], async name => (name === 'org-shot.png' ? Buffer.from('abc') : null));

    const blocks = out as Array<{ type: string; text?: string; image_url?: { url: string } }>;

    expect(Array.isArray(out)).toBe(true);
    expect(blocks[0]).toMatchObject({ type: 'text' });
    expect(blocks[0]!.text).toContain('One image is attached below — shot.png');
    expect(blocks[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('abc').toString('base64')}` } });
  });

  it('names an image it could not read instead of dropping it silently', async () => {
    const img = loadedFromArtifact(row({ id: 8, title: 'gone.png', spec: { contentType: 'image/png', bytes: 3, filename: 'org-gone.png' } }));
    const out = await composeUserContent('?', [img], noFs);

    expect(out).toContain('Attached but unreadable here: gone.png');
  });

  it('has a text-only form for a harness that takes a string', async () => {
    const img = loadedFromArtifact(row({ id: 8, title: 'shot.png', spec: { contentType: 'image/png', bytes: 3, filename: 'org-shot.png' } }));
    const out = await composeUserText('Look.', [loadedFromArtifact(row({})), img]);

    expect(out).toContain('Q3 plan');
    expect(out).toContain('Attached but unreadable here: shot.png');
  });
});

describe('attachmentsForWire — what crosses to the container', () => {
  it('carries text for documents and a data URL for images', async () => {
    const img = loadedFromArtifact(row({ id: 8, title: 'shot.png', spec: { contentType: 'image/png', bytes: 3, filename: 'org-shot.png' } }));
    const wire = await attachmentsForWire([loadedFromArtifact(row({})), img], async () => Buffer.from('abc'));

    expect(wire).toEqual([
      { title: 'deck.pdf', contentType: 'application/pdf', text: 'Q3 plan' },
      { title: 'shot.png', contentType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from('abc').toString('base64')}` },
    ]);
  });
});

describe('historyMarker', () => {
  it('names the files a past message carried, and nothing when it carried none', () => {
    expect(historyMarker([{ title: 'a.pdf' }, { title: 'b.png' }])).toBe('\n\n[Attached: a.pdf, b.png]');
    expect(historyMarker([])).toBe('');
  });
});
