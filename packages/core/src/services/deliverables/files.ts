/**
 * Where a deliverable's files go — the shared half of the document and deck
 * engines. Screenshots, PDFs and a deck's images are stored in the same file
 * store `file` artifacts use (`libs/tools/artifacts/store.ts`) and served by
 * the same authenticated route; a printed PDF is filed as a `file` artifact
 * beside the deliverable it came from, on the same record.
 */

import type { Buffer } from 'node:buffer';
import type { ImageKind } from '@/libs/tools/image/inspect';
import type { ArtifactRow, Author } from '@/services/ArtifactService';
import { Buffer as NodeBuffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { storedFilename } from '@/libs/decks/assetLink';
import { artifactsDir, saveArtifact } from '@/libs/tools/artifacts/store';
import { contentTypeForExt, parseArtifactFilename } from '@/libs/tools/artifacts/url';
import { CONTENT_TYPES, svgIsInert, validateImageBytes } from '@/libs/tools/image/inspect';
import { createArtifact } from '@/services/ArtifactService';

/**
 * Store one page or slide screenshot; returns its served URL.
 * @param orgId - The workspace.
 * @param png - The image.
 */
export async function storeScreenshot(orgId: string, png: Buffer): Promise<string> {
  return (await saveArtifact({ orgId, data: png, ext: 'png', contentType: 'image/png' })).url;
}

/**
 * Store a printed PDF; returns the saved file.
 * @param orgId - The workspace.
 * @param pdf - The bytes.
 */
export async function storePdf(orgId: string, pdf: Buffer) {
  return saveArtifact({ orgId, data: pdf, ext: 'pdf', contentType: 'application/pdf' });
}

const EXT: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', avif: 'avif', bmp: 'bmp', ico: 'ico', svg: 'svg' };

/** The largest image a deck asset may be. */
export const MAX_ASSET_BYTES = 15 * 1024 * 1024;

/**
 * Store an image as a deck asset. The BYTES decide what it is (`validateImageBytes`),
 * and an SVG that carries script is refused. Throws a plain sentence when the
 * bytes are not an image, are too large, or are an unsafe SVG.
 * @param orgId - The workspace.
 * @param bytes - The file.
 * @param name - What it was called, when known.
 */
export async function storeImageAsset(orgId: string, bytes: Buffer, name?: string): Promise<{ url: string; contentType: string; bytes: number; name?: string }> {
  const verdict = validateImageBytes({ bytes, maxBytes: MAX_ASSET_BYTES });
  if (!verdict.ok) {
    throw new Error(`${name ?? 'the file'} was refused: ${verdict.reason}`);
  }
  if (verdict.kind === 'svg' && !svgIsInert(bytes.toString('utf8'))) {
    throw new Error(`${name ?? 'the SVG'} carries script or outside references, so it was refused`);
  }
  const contentType = CONTENT_TYPES[verdict.kind];
  const saved = await saveArtifact({ orgId, data: bytes, ext: EXT[verdict.kind], contentType });
  return { url: saved.url, contentType, bytes: saved.bytes, ...(name ? { name: name.slice(0, 200) } : {}) };
}

/**
 * Read a stored file back by its served URL — for the renderer, which serves
 * a deck's images to Chromium from the store rather than over HTTP. Only a
 * file of this workspace is read.
 * @param orgId - The workspace.
 * @param url - `/api/artifacts/<id>/<filename>`.
 */
export async function readStoredFile(orgId: string, url: string): Promise<{ body: Buffer; contentType: string } | null> {
  const filename = storedFilename(url);
  if (!filename || !filename.startsWith(`${orgId}-`)) {
    return null;
  }
  const dir = path.resolve(/* turbopackIgnore: true */ artifactsDir());
  const abs = path.resolve(dir, filename);
  if (!abs.startsWith(dir + path.sep)) {
    return null;
  }
  try {
    const body = NodeBuffer.from(await readFile(abs));
    return { body, contentType: contentTypeForExt(parseArtifactFilename(filename)?.ext ?? '') };
  } catch {
    return null;
  }
}

/**
 * A download filename from a deliverable's title: no path separators, no control characters.
 * @param title - The deliverable's title.
 * @param ext - The extension, without the dot.
 */
export function deliverableFilename(title: string, ext: string): string {
  // eslint-disable-next-line no-control-regex
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
  return `${base}.${ext}`;
}

/**
 * A filename Chrome would produce from a title: no path separators, no control characters.
 * @param title - The deliverable's title.
 */
export function pdfFilename(title: string): string {
  return deliverableFilename(title, 'pdf');
}

/** What a deliverable can be exported as, and how each is stored. */
export const EXPORT_FORMATS = {
  pdf: { ext: 'pdf', contentType: 'application/pdf' },
  pptx: { ext: 'pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  docx: { ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;

/**
 * File an exported deliverable beside the deck or document it came from:
 * stored, then a `file` artifact on the same record with the format as its
 * role, carrying `exportedFrom` (which deliverable, which version, as what).
 * That is where the record of "it went out as PPTX" lives — on the file, so
 * the deliverable itself gets no version for a download.
 * @param input - The source row, the bytes and who exported it.
 * @param input.orgId
 * @param input.source
 * @param input.format
 * @param input.data
 * @param input.filename
 * @param input.author
 * @param input.conversationId
 * @param input.visibility
 */
export async function fileExport(input: { orgId: string; source: ArtifactRow; format: ExportFormat; data: Buffer; filename: string; author: Author; conversationId?: number | null; visibility?: 'user' | 'system' }): Promise<{ file: ArtifactRow; url: string; bytes: number }> {
  const { ext, contentType } = EXPORT_FORMATS[input.format];
  const saved = await saveArtifact({ orgId: input.orgId, data: input.data, ext, contentType });
  const src = input.source;
  const { artifact: file } = await createArtifact({
    orgId: input.orgId,
    conversationId: input.conversationId ?? null,
    kind: 'file',
    title: input.filename,
    spec: {
      filename: saved.filename,
      contentType,
      bytes: saved.bytes,
      url: saved.url,
      exportedFrom: { artifactId: src.id, version: src.currentVersion, format: input.format, at: new Date().toISOString() },
    },
    url: saved.url,
    record: src.recordType && src.recordId ? { type: src.recordType, id: src.recordId, role: input.format } : null,
    author: input.author,
    visibility: input.visibility ?? 'user',
    changeSummary: input.format === 'pdf' ? `Printed from "${src.title}" v${src.currentVersion}` : `Exported as ${input.format.toUpperCase()} from "${src.title}" v${src.currentVersion}`,
  });
  return { file, url: saved.url, bytes: saved.bytes };
}

/**
 * File a printed PDF beside the deliverable it came from: stored, then a
 * `file` artifact on the same record with the role `pdf`.
 * @param input - The source row, the bytes and who printed it.
 * @param input.orgId
 * @param input.source
 * @param input.pdf
 * @param input.filename
 * @param input.author
 * @param input.conversationId
 * @param input.visibility
 */
export async function filePdf(input: { orgId: string; source: ArtifactRow; pdf: Buffer; filename: string; author: Author; conversationId?: number | null; visibility?: 'user' | 'system' }): Promise<{ file: ArtifactRow; url: string; bytes: number }> {
  return fileExport({ ...input, format: 'pdf', data: input.pdf });
}
