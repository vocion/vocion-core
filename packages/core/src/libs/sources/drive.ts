/**
 * Google Drive connector — ingest documents as retrievable knowledge (RevOps:
 * proposals, briefs, proof / case-study docs).
 *
 * Auth: OAuth access token in `ctx.credentials.token`. Incremental: when
 * `ctx.since` is set, the Drive query gains `modifiedTime > '<ISO>'`. Lists
 * files (paginating `nextPageToken`, resuming from `ctx.cursor`); Google-native
 * docs/sheets/slides are exported as text, plain-text files are downloaded,
 * PDFs and Word (.docx) files are downloaded and read (`libs/extract`), and
 * anything else yields metadata only (no binary).
 *
 * A PDF or Word file that gives no text — a scan, a file over the size limit,
 * a damaged or password-protected one — still lands, as its name and the one
 * sentence saying why, so it is found by name and nobody mistakes it for an
 * empty file. What was read is on `metadata.textExtraction`.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { contentFor, documentKindOf, extractDocumentText, extractionMetadata, tooLargeToRead } from '@/libs/extract/documentText';
import { resolveGoogleAccessToken } from './googleAuth';

const driveConfigSchema = z.object({
  /** Drive query (e.g. `"<folderId>" in parents`). Defaults to non-trashed files. */
  query: z.string().default('trashed = false'),
  baseUrl: z.string().url().default('https://www.googleapis.com/drive/v3'),
});

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string };
type DriveList = { files?: DriveFile[]; nextPageToken?: string };

/**
 * The text export target for a Google-native mime type, or null to skip export.
 * @param mimeType
 */
function exportMimeFor(mimeType: string): string | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
    case 'application/vnd.google-apps.presentation':
      return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':
      return 'text/csv';
    default:
      return null;
  }
}

/**
 * Download one PDF or Word file and read it. The HTTP status when the
 * download failed, which the sync reports; a file that downloads but cannot
 * be read is a result with its reason, never a throw.
 * @param url - The file's `alt=media` URL.
 * @param headers - The bearer header.
 * @param kind - What the file is.
 */
async function downloadAndRead(url: string, headers: Record<string, string>, kind: 'pdf' | 'docx') {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    return res.status;
  }
  return extractDocumentText(kind, Buffer.from(await res.arrayBuffer()));
}

export const driveConnector: SourceConnector<typeof driveConfigSchema> = {
  slug: 'drive',
  name: 'Google Drive',
  description: 'Ingest Google Drive documents (Docs, Sheets, Slides, PDFs, Word files, text) — incremental by modified time.',
  icon: 'FileText',
  authKind: 'oauth',
  configSchema: driveConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = driveConfigSchema.parse(ctx.config);
    // Durable path: refresh-token exchange (see googleAuth); legacy fallback
    // accepts a raw short-lived credentials.token.
    const token = await resolveGoogleAccessToken(ctx.credentials, ctx.orgId);
    const headers = { authorization: `Bearer ${token}` };
    const q = ctx.since
      ? `${cfg.query} and modifiedTime > '${ctx.since.toISOString()}'`
      : cfg.query;

    let pageToken = ctx.cursor ?? undefined;
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
        pageSize: '100',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const listRes = await fetch(`${cfg.baseUrl}/files?${params.toString()}`, { headers });
      if (!listRes.ok) {
        throw new Error(`Drive list failed: ${listRes.status} ${await listRes.text().catch(() => '')}`);
      }
      const list = (await listRes.json()) as DriveList;

      for (const file of list.files ?? []) {
        let content = '';
        let textExtraction: Record<string, unknown> | undefined;
        const exportMime = exportMimeFor(file.mimeType);
        const documentKind = exportMime ? null : documentKindOf(file.mimeType, file.name);
        if (documentKind) {
          const result = tooLargeToRead(documentKind, file.size === undefined ? undefined : Number(file.size))
            ?? await downloadAndRead(`${cfg.baseUrl}/files/${file.id}?alt=media`, headers, documentKind);
          if (typeof result === 'number') {
            ctx.onProgress?.({ kind: 'error', uri: file.id, message: `download ${file.id}: ${result}` });
          } else {
            content = contentFor(file.name, result);
            textExtraction = extractionMetadata(result);
          }
        } else if (exportMime) {
          const ep = new URLSearchParams({ mimeType: exportMime });
          const exportRes = await fetch(`${cfg.baseUrl}/files/${file.id}/export?${ep.toString()}`, { headers });
          if (exportRes.ok) {
            content = await exportRes.text();
          } else {
            ctx.onProgress?.({ kind: 'error', uri: file.id, message: `export ${file.id}: ${exportRes.status}` });
          }
        } else if (file.mimeType.startsWith('text/')) {
          const dlRes = await fetch(`${cfg.baseUrl}/files/${file.id}?alt=media`, { headers });
          if (dlRes.ok) {
            content = await dlRes.text();
          }
        }
        ctx.onProgress?.({ kind: 'fetched', uri: file.id });
        yield {
          externalId: `drive:${file.id}`,
          title: file.name,
          content,
          lastModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
          metadata: { kind: 'drive-file', mimeType: file.mimeType, ...(textExtraction ? { textExtraction } : {}) },
        };
      }
      pageToken = list.nextPageToken;
    } while (pageToken);
  },
};
