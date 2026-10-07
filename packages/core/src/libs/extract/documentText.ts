/**
 * The text inside a PDF or Word (.docx) file, for a connector that found one
 * in a person's Drive or mail.
 *
 * One reader for every place a file arrives as bytes: the Drive connector,
 * Gmail attachments, and a chat upload's PDF (`services/chat/attachments.ts`).
 * Each result says what happened, so the document that lands in search can say
 * it too — a scan is "no text layer, so nothing to search", never an empty
 * document that looks like a blank page.
 *
 * - **PDF** goes through `pdf-parse` (already a dependency). There is no OCR:
 *   a scanned PDF has no text layer, and the result says so, page by page.
 * - **Word (.docx)** is a zip of XML. `docx.ts` reads `word/document.xml` with
 *   `node:zlib` and nothing else, so no dependency is added for it.
 * - **Size limits** keep one file from swamping a sync: bytes are checked
 *   before anything is downloaded where the caller knows the size
 *   (`tooLargeToRead`), and the text is cut at `MAX_EXTRACTED_CHARS` with the
 *   cut recorded.
 *
 * Never throws for a bad file: a damaged, encrypted or unreadable file is a
 * result with a reason, so one bad attachment never fails a sync.
 */

import { Buffer } from 'node:buffer';
import { docxText } from './docx';

/** The largest file a connector downloads to read: 25 MB. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** The most text kept from one file. Past it the text is cut, and the result says so. */
export const MAX_EXTRACTED_CHARS = 500_000;

/** The most PDF pages read from one file; the rest are counted, not read. */
export const MAX_PDF_PAGES = 500;

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The file kinds this module reads. */
export type DocumentKind = 'pdf' | 'docx';

/** Why a file yielded no text, or only some. */
export type ExtractionStatus
  = | 'ok'
  /** Some PDF pages had text and some did not: the empty ones are probably scanned. */
    | 'partial'
  /** A PDF with no text on any page: a scan or an image. No OCR is run. */
    | 'no_text_layer'
  /** Bigger than `MAX_DOCUMENT_BYTES`: not downloaded, not read. */
    | 'too_large'
  /** Password-protected. */
    | 'encrypted'
  /** Damaged, or not the format its type claims. */
    | 'unreadable';

/** What reading one file found, written so it can sit on the document's metadata. */
export type ExtractionResult = {
  status: ExtractionStatus;
  kind: DocumentKind;
  /** The text, normalised; empty when nothing could be read. */
  text: string;
  /** Pages in the file (PDF only), when known. */
  pages?: number;
  /** PDF pages that carried no text, when any did not. */
  pagesWithoutText?: number;
  /** True when the text was cut at `MAX_EXTRACTED_CHARS` or the PDF at `MAX_PDF_PAGES`. */
  truncated?: boolean;
  /** One sentence for a person, when the status is not `ok`. */
  note?: string;
};

/**
 * Which of the readable kinds a file is, from its MIME type or, for a sender
 * that labels everything `application/octet-stream`, its file extension.
 * Null for anything else.
 * @param mimeType - The type the upstream reported.
 * @param filename - The file's name, when known.
 */
export function documentKindOf(mimeType: string | null | undefined, filename?: string | null): DocumentKind | null {
  const type = (mimeType ?? '').toLowerCase().split(';')[0]!.trim();
  if (type === PDF_MIME) {
    return 'pdf';
  }
  if (type === DOCX_MIME) {
    return 'docx';
  }
  if (type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream') {
    const ext = (filename ?? '').toLowerCase().split('.').pop();
    if (ext === 'pdf') {
      return 'pdf';
    }
    if (ext === 'docx') {
      return 'docx';
    }
  }
  return null;
}

/**
 * Megabytes, for a sentence.
 * @param bytes - A size.
 */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/**
 * The result for a file too big to download, or null when it is within the
 * limit (or its size is unknown, which the read itself then checks).
 * @param kind - What the file is.
 * @param bytes - Its size as the upstream reported it.
 */
export function tooLargeToRead(kind: DocumentKind, bytes: number | null | undefined): ExtractionResult | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= MAX_DOCUMENT_BYTES) {
    return null;
  }
  return {
    status: 'too_large',
    kind,
    text: '',
    note: `This file is ${mb(bytes)}; files over ${mb(MAX_DOCUMENT_BYTES)} are not read, so its contents are not searchable.`,
  };
}

/**
 * Line endings, trailing spaces and runs of blank lines tidied.
 * @param text - Raw extracted text.
 */
export function normaliseText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Cut text at the limit, saying whether it was cut.
 * @param text - Normalised text.
 */
function capped(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_EXTRACTED_CHARS
    ? { text: text.slice(0, MAX_EXTRACTED_CHARS), truncated: true }
    : { text, truncated: false };
}

/**
 * The text of a PDF, page by page. No OCR: a page that is a picture of text
 * has no text layer and reads as empty, and the result counts those pages.
 * @param bytes - The file.
 */
export async function readPdfText(bytes: Buffer): Promise<ExtractionResult> {
  let parser: { destroy: () => Promise<void> } | null = null;
  try {
    const { PDFParse } = await import('pdf-parse');
    const pdf = new PDFParse({ data: new Uint8Array(bytes) });
    parser = pdf;
    const result = await pdf.getText({ first: MAX_PDF_PAGES, pageJoiner: '' });
    const pageTexts = result.pages.map(page => normaliseText(page.text ?? ''));
    const empty = pageTexts.filter(text => text.length === 0).length;
    const { text, truncated } = capped(normaliseText(pageTexts.filter(Boolean).join('\n\n')));
    const total = typeof result.total === 'number' ? result.total : pageTexts.length;
    const pagesCut = total > pageTexts.length;
    const base = { kind: 'pdf' as const, pages: total, ...(empty > 0 ? { pagesWithoutText: empty } : {}), ...(truncated || pagesCut ? { truncated: true } : {}) };
    if (text.length === 0) {
      return { ...base, status: 'no_text_layer', text: '', note: 'This PDF has no text layer, so it is probably a scan. Vocion does not run OCR, so its contents are not searchable.' };
    }
    if (empty > 0) {
      return { ...base, status: 'partial', text, note: `${empty} of ${pageTexts.length} pages had no text layer (probably scanned) and were not read; Vocion does not run OCR.` };
    }
    return { ...base, status: 'ok', text, ...(truncated || pagesCut ? { note: truncationNote(pagesCut ? pageTexts.length : null) } : {}) };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      return { status: 'encrypted', kind: 'pdf', text: '', note: 'This PDF is password-protected, so it was not read.' };
    }
    return { status: 'unreadable', kind: 'pdf', text: '', note: 'This PDF could not be read; it may be damaged.' };
  } finally {
    await parser?.destroy().catch(() => {});
  }
}

/**
 * The sentence for text that was cut.
 * @param pagesRead - How many PDF pages were read, when the page cap was hit.
 */
function truncationNote(pagesRead: number | null): string {
  return pagesRead === null
    ? `Only the first ${MAX_EXTRACTED_CHARS.toLocaleString('en-US')} characters were kept.`
    : `Only the first ${pagesRead} pages were read.`;
}

/**
 * The text of a Word (.docx) file: paragraphs, table cells and line breaks
 * from the document body.
 * @param bytes - The file.
 */
export function readDocxText(bytes: Buffer): ExtractionResult {
  try {
    const raw = docxText(bytes);
    if (raw === null) {
      return { status: 'unreadable', kind: 'docx', text: '', note: 'This Word file could not be read; it may be damaged, or be an older .doc saved with a .docx name.' };
    }
    const { text, truncated } = capped(normaliseText(raw));
    return { status: 'ok', kind: 'docx', text, ...(truncated ? { truncated: true, note: truncationNote(null) } : {}) };
  } catch {
    return { status: 'unreadable', kind: 'docx', text: '', note: 'This Word file could not be read; it may be damaged or password-protected.' };
  }
}

/**
 * Read a file of a known kind. The size is checked again here, so a caller
 * that could not know it in advance still never reads past the limit.
 * @param kind - From `documentKindOf`.
 * @param bytes - The file.
 */
export async function extractDocumentText(kind: DocumentKind, bytes: Buffer): Promise<ExtractionResult> {
  const big = tooLargeToRead(kind, bytes.length);
  if (big) {
    return big;
  }
  return kind === 'pdf' ? readPdfText(bytes) : readDocxText(bytes);
}

/**
 * What a document's content is when its file gave no text: the file's name
 * and the one sentence saying why, so the file is still found by name and
 * whoever finds it learns why its contents are not there. Empty for a file
 * that read fine.
 * @param name - The file's name.
 * @param result - What reading it found.
 */
export function contentFor(name: string, result: ExtractionResult): string {
  if (result.text.length > 0) {
    return result.note ? `${result.text}\n\n[${result.note}]` : result.text;
  }
  return `${name}\n\n[${result.note ?? 'No text could be read from this file.'}]`;
}

/**
 * The extraction as document metadata: what was read and what was not,
 * without the text.
 * @param result - What reading the file found.
 */
export function extractionMetadata(result: ExtractionResult): Record<string, unknown> {
  return {
    status: result.status,
    kind: result.kind,
    chars: result.text.length,
    ...(result.pages !== undefined ? { pages: result.pages } : {}),
    ...(result.pagesWithoutText !== undefined ? { pagesWithoutText: result.pagesWithoutText } : {}),
    ...(result.truncated ? { truncated: true } : {}),
    ...(result.note ? { note: result.note } : {}),
  };
}

/**
 * Bytes from a base64 or base64url string, as Gmail sends attachment bodies.
 * @param data - The encoded body.
 */
export function bytesFromBase64(data: string): Buffer {
  return Buffer.from(data, 'base64url');
}
