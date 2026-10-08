/**
 * What a file-storage connector can read as text, and the reading.
 *
 * Dropbox and Box hold every kind of file; the knowledge index wants text.
 * A file whose extension is on the source's list is downloaded and read —
 * text and markup as UTF-8, HTML flattened, a PDF through the same
 * `pdf-parse` reading a chat attachment gets (`services/chat/attachments.ts`).
 * Anything else, or anything over the size cap, is indexed by its name and
 * path only, so "the Northwind MSA" still finds the file without Vocion
 * downloading a 2 GB video. The same rule answers `files_read`.
 */

import type { Buffer } from 'node:buffer';
import { htmlToText } from '@/libs/connectors/vendorRequest';

const TEXT_EXTENSIONS = ['.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml', '.log', '.rst'];

/** The extensions a file-storage source reads by default: text and markup, and PDF. */
export const DEFAULT_FILE_EXTENSIONS = [...TEXT_EXTENSIONS, '.pdf'];

/** Files larger than this are indexed by name only. */
export const FILE_BYTES_MAX = 10 * 1024 * 1024;

/**
 * A file name's extension, lowercased with its dot, or `''`.
 * @param name - The file name.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Whether a file is downloaded and read, by its extension and size.
 * @param name - The file name.
 * @param size - Its size in bytes, when known.
 * @param extensions - The source's list.
 */
export function readsAsText(name: string, size: number | null | undefined, extensions: readonly string[]): boolean {
  const ext = extensionOf(name);
  const wanted = extensions.map(e => (e.startsWith('.') ? e : `.${e}`).toLowerCase());
  return ext !== '' && wanted.includes(ext) && (size === null || size === undefined || size <= FILE_BYTES_MAX);
}

/**
 * A downloaded file as text.
 * @param name - The file name, for its type.
 * @param bytes - Its content.
 */
export async function fileText(name: string, bytes: Buffer): Promise<string> {
  const ext = extensionOf(name);
  if (ext === '.pdf') {
    const { extractText } = await import('@/services/chat/attachments');
    return extractText(bytes, 'application/pdf');
  }
  const text = bytes.toString('utf8');
  return ext === '.html' || ext === '.htm' ? htmlToText(text) : text;
}
