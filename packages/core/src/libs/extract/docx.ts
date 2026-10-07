/**
 * The text of a Word (.docx) file, read with `node:zlib` and nothing else.
 *
 * A .docx is a zip archive; the body is the XML part `word/document.xml`.
 * This reads the archive's central directory to find that part, inflates it,
 * and walks the XML for text runs (`w:t`), tabs, line breaks, paragraphs and
 * table cells. Why not a library: `mammoth` and its peers bring a zip library,
 * an XML DOM and a promise library to do this one walk, and this is all the
 * connectors need — text to search, not formatting.
 *
 * Structural parsing of a file format, not reading meaning from words: the
 * patterns below match XML tags, never the document's prose.
 */

import type { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054B50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014B50;
const LOCAL_FILE_HEADER = 0x04034B50;
/** The end record is 22 bytes plus a comment of up to 65535. */
const MAX_END_RECORD_SEARCH = 22 + 0xFFFF;
/** The body part may not inflate past this: a zip bomb stops here rather than filling memory. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

const BODY_PART = 'word/document.xml';

/**
 * Where the end-of-central-directory record starts, or -1.
 * @param zip - The archive.
 */
function endRecordOffset(zip: Buffer): number {
  const floor = Math.max(0, zip.length - MAX_END_RECORD_SEARCH);
  for (let at = zip.length - 22; at >= floor; at -= 1) {
    if (zip.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      return at;
    }
  }
  return -1;
}

/**
 * The uncompressed bytes of one named part of a zip archive, or null when the
 * archive has no such part or cannot be read.
 * @param zip - The archive.
 * @param name - The part's path inside it.
 */
export function zipEntry(zip: Buffer, name: string): Buffer | null {
  if (zip.length < 22) {
    return null;
  }
  const end = endRecordOffset(zip);
  if (end < 0) {
    return null;
  }
  const entries = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) {
      return null;
    }
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const entryName = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (entryName === name) {
      return readLocalEntry(zip, localOffset, method, compressedSize);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * The data of the entry whose local header starts at `offset`.
 * @param zip - The archive.
 * @param offset - The local header's offset, from the central directory.
 * @param method - 0 stored, 8 deflated; anything else is unreadable here.
 * @param compressedSize - From the central directory, which is right even when the local header defers it.
 */
function readLocalEntry(zip: Buffer, offset: number, method: number, compressedSize: number): Buffer | null {
  if (offset + 30 > zip.length || zip.readUInt32LE(offset) !== LOCAL_FILE_HEADER) {
    return null;
  }
  const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
  const data = zip.subarray(start, start + compressedSize);
  if (method === 0) {
    return data;
  }
  if (method === 8) {
    return inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES });
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

/**
 * XML character references and the five named entities, decoded.
 * @param text - Text between tags.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      return safeCodePoint(Number.parseInt(ref.slice(2), 16)) ?? whole;
    }
    if (ref.startsWith('#')) {
      return safeCodePoint(Number.parseInt(ref.slice(1), 10)) ?? whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/**
 * A character from a code point, or null for one that is not a character.
 * @param code - The code point.
 */
function safeCodePoint(code: number): string | null {
  return Number.isInteger(code) && code >= 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : null;
}

/**
 * The text of WordprocessingML: runs joined, a tab for `w:tab` and between
 * table cells, a newline for `w:br`, `w:cr`, the end of a paragraph and the
 * end of a table row. Deleted text (`w:delText`, tracked changes) is not
 * text the document says, so it is left out.
 * @param xml - The body part.
 */
export function wordprocessingText(xml: string): string {
  const out: string[] = [];
  let inText = false;
  // `w:tab` inside `w:tabs` is a tab STOP in the paragraph's settings, not a tab in its text.
  let inTabStops = false;
  for (const match of xml.matchAll(/<([^>]*)>|([^<]+)/g)) {
    const [, inner, chars] = match;
    if (inner === undefined) {
      if (inText && chars !== undefined) {
        out.push(decodeEntities(chars));
      }
      continue;
    }
    const closing = inner.startsWith('/');
    const selfClosing = inner.endsWith('/');
    const tag = (closing ? inner.slice(1) : inner).split(/[\s/]/, 1)[0];
    if (tag === 'w:t') {
      inText = !closing && !selfClosing;
    } else if (tag === 'w:tabs') {
      inTabStops = !closing && !selfClosing;
    } else if (tag === 'w:tab' && !closing && !inTabStops) {
      out.push('\t');
    } else if ((tag === 'w:br' || tag === 'w:cr') && !closing) {
      out.push('\n');
    } else if (tag === 'w:p' && (closing || selfClosing)) {
      out.push('\n');
    } else if (tag === 'w:tc' && closing) {
      out.push('\t');
    } else if (tag === 'w:tr' && closing) {
      out.push('\n');
    }
  }
  return out.join('').replace(/\t+\n/g, '\n');
}

/**
 * The body text of a .docx file, or null when the bytes are not a .docx (no
 * `word/document.xml` part). Throws only for an archive whose body part will
 * not inflate; the caller reports that as unreadable.
 * @param bytes - The file.
 */
export function docxText(bytes: Buffer): string | null {
  const body = zipEntry(bytes, BODY_PART);
  return body === null ? null : wordprocessingText(body.toString('utf8'));
}
