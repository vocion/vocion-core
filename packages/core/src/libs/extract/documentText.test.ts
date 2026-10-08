/**
 * Reading PDFs and Word files for the connectors: real files built in memory
 * (`libs/fixtures/documentFiles.ts`), no parser mocks. A scan says it is a
 * scan, a big file is never read, a damaged one is a reason rather than a
 * thrown sync.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { docxWithBody, pdfWithPages, wordParagraph, zipOf } from '@/libs/fixtures/documentFiles';
import {
  contentFor,
  documentKindOf,
  DOCX_MIME,
  extractDocumentText,
  extractionMetadata,
  MAX_DOCUMENT_BYTES,
  MAX_EXTRACTED_CHARS,
  readDocxText,
  readPdfText,
  tooLargeToRead,
} from './documentText';
import { wordprocessingText, zipEntry } from './docx';

describe('documentKindOf', () => {
  it('knows PDF and Word by type, and by extension when the sender says octet-stream', () => {
    expect(documentKindOf('application/pdf')).toBe('pdf');
    expect(documentKindOf('application/PDF; name=x.pdf')).toBe('pdf');
    expect(documentKindOf(DOCX_MIME)).toBe('docx');
    expect(documentKindOf('application/octet-stream', 'Invoice-1042.PDF')).toBe('pdf');
    expect(documentKindOf('', 'brief.docx')).toBe('docx');
  });

  it('reads nothing else, including the old binary .doc and images', () => {
    expect(documentKindOf('application/msword', 'old.doc')).toBeNull();
    expect(documentKindOf('image/png', 'scan.png')).toBeNull();
    expect(documentKindOf('text/plain', 'notes.pdf')).toBeNull();
    expect(documentKindOf('application/octet-stream', 'archive.zip')).toBeNull();
  });
});

describe('readPdfText', () => {
  it('reads every page, without page markers', async () => {
    const result = await readPdfText(pdfWithPages(['Invoice 1042 for Contoso Supply', 'Net 30 terms (see page one)']));

    expect(result.status).toBe('ok');
    expect(result.pages).toBe(2);
    expect(result.text).toBe('Invoice 1042 for Contoso Supply\n\nNet 30 terms (see page one)');
    expect(result.note).toBeUndefined();
  });

  it('says a PDF with no text layer is probably a scan, and that there is no OCR', async () => {
    const result = await readPdfText(pdfWithPages(['', '']));

    expect(result.status).toBe('no_text_layer');
    expect(result.text).toBe('');
    expect(result.pagesWithoutText).toBe(2);
    expect(result.note).toMatch(/no text layer/);
    expect(result.note).toMatch(/does not run OCR/);
  });

  it('reads the pages that have text and counts the ones that do not', async () => {
    const result = await readPdfText(pdfWithPages(['Signed statement of work', '', '']));

    expect(result.status).toBe('partial');
    expect(result.text).toBe('Signed statement of work');
    expect(result.pagesWithoutText).toBe(2);
    expect(result.note).toBe('2 of 3 pages had no text layer (probably scanned) and were not read; Vocion does not run OCR.');
  });

  it('turns a damaged file into a reason, never a throw', async () => {
    const result = await readPdfText(Buffer.from('%PDF-1.4 this is not really a pdf'));

    expect(result.status).toBe('unreadable');
    expect(result.note).toMatch(/could not be read/);
  });
});

describe('readDocxText', () => {
  it('reads paragraphs, runs, tabs, breaks and table rows in order', () => {
    const body = [
      wordParagraph('Statement of work — ', 'Northwind'),
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Fee</w:t></w:r><w:r><w:tab/><w:t>12,500</w:t></w:r><w:r><w:br/><w:t>Due on signature</w:t></w:r></w:p>',
      `<w:tbl><w:tr><w:tc>${wordParagraph('Item')}</w:tc><w:tc>${wordParagraph('Amount')}</w:tc></w:tr><w:tr><w:tc>${wordParagraph('Discovery')}</w:tc><w:tc>${wordParagraph('4,000')}</w:tc></w:tr></w:tbl>`,
      wordParagraph('Fish &amp; chips &lt;3 &#x2013; &#8212; done'),
    ].join('');
    const result = readDocxText(docxWithBody(body));

    expect(result.status).toBe('ok');
    expect(result.text).toBe([
      'Statement of work — Northwind',
      'Fee\t12,500',
      'Due on signature',
      'Item',
      '\tAmount',
      '',
      'Discovery',
      '\t4,000',
      '',
      'Fish & chips <3 – — done',
    ].join('\n').replace(/\n{3,}/g, '\n\n'));
  });

  it('leaves out text deleted under tracked changes', () => {
    const body = '<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>removed</w:delText></w:r></w:del></w:p>';

    expect(readDocxText(docxWithBody(body)).text).toBe('Kept');
  });

  it('says a file that is not a .docx is unreadable, and names the old .doc', () => {
    const result = readDocxText(Buffer.from('\xD0\xCF\x11\xE0 an old binary Word file', 'latin1'));

    expect(result.status).toBe('unreadable');
    expect(result.note).toMatch(/older \.doc/);
  });

  it('says a zip without a Word body is unreadable', () => {
    expect(readDocxText(zipOf({ 'readme.txt': 'hello' })).status).toBe('unreadable');
  });
});

describe('zipEntry', () => {
  it('reads stored and deflated parts, and null for a part that is not there', () => {
    const zip = zipOf({ 'a.txt': 'stored text', 'b/c.xml': '<x>deflated</x>' }, ['a.txt']);

    expect(zipEntry(zip, 'a.txt')?.toString('utf8')).toBe('stored text');
    expect(zipEntry(zip, 'b/c.xml')?.toString('utf8')).toBe('<x>deflated</x>');
    expect(zipEntry(zip, 'missing.xml')).toBeNull();
    expect(zipEntry(Buffer.from('short'), 'a.txt')).toBeNull();
  });
});

describe('wordprocessingText', () => {
  it('ignores text outside w:t, such as instruction text and properties', () => {
    expect(wordprocessingText('<w:p><w:r><w:instrText> PAGE </w:instrText><w:t>Body</w:t></w:r></w:p>')).toBe('Body\n');
  });
});

describe('limits', () => {
  it('refuses to read a file over the size limit before downloading it, and says how big it was', () => {
    const result = tooLargeToRead('pdf', MAX_DOCUMENT_BYTES + 1);

    expect(result?.status).toBe('too_large');
    expect(result?.note).toMatch(/files over 25 MB are not read/);
    expect(tooLargeToRead('pdf', MAX_DOCUMENT_BYTES)).toBeNull();
    expect(tooLargeToRead('pdf', undefined)).toBeNull();
  });

  it('checks the size again when the caller could not know it in advance', async () => {
    const result = await extractDocumentText('docx', Buffer.alloc(MAX_DOCUMENT_BYTES + 1));

    expect(result.status).toBe('too_large');
  });

  it('cuts very long text at the limit and says so', () => {
    const long = 'x'.repeat(MAX_EXTRACTED_CHARS + 10);
    const result = readDocxText(docxWithBody(wordParagraph(long)));

    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.note).toMatch(/Only the first 500,000 characters were kept/);
  });
});

describe('what lands in search', () => {
  it('a readable file is its text', async () => {
    const result = await extractDocumentText('pdf', pdfWithPages(['Kestrel Capital term sheet']));

    expect(contentFor('term-sheet.pdf', result)).toBe('Kestrel Capital term sheet');
    expect(extractionMetadata(result)).toEqual({ status: 'ok', kind: 'pdf', chars: 26, pages: 1 });
  });

  it('a scan is its name and the reason, so it is still found and nobody reads a blank as an empty file', async () => {
    const result = await extractDocumentText('pdf', pdfWithPages(['']));

    expect(contentFor('signed-contract.pdf', result)).toBe('signed-contract.pdf\n\n[This PDF has no text layer, so it is probably a scan. Vocion does not run OCR, so its contents are not searchable.]');
    expect(extractionMetadata(result)).toMatchObject({ status: 'no_text_layer', chars: 0, pagesWithoutText: 1 });
  });

  it('a partial read keeps the text and the note beside it', async () => {
    const result = await extractDocumentText('pdf', pdfWithPages(['Page one', '']));

    expect(contentFor('mixed.pdf', result)).toBe('Page one\n\n[1 of 2 pages had no text layer (probably scanned) and were not read; Vocion does not run OCR.]');
  });
});
