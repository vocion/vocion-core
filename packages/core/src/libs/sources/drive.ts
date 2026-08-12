/**
 * Google Drive connector — ingest documents as retrievable knowledge (RevOps:
 * proposals, briefs, proof / case-study docs).
 *
 * Auth: OAuth access token in `ctx.credentials.token`. Incremental: when
 * `ctx.since` is set, the Drive query gains `modifiedTime > '<ISO>'`. Lists
 * files (paginating `nextPageToken`, resuming from `ctx.cursor`); Google-native
 * docs/sheets/slides are exported as text, plain-text files are downloaded, and
 * anything else yields metadata only (no binary).
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { resolveGoogleAccessToken } from './googleAuth';

const driveConfigSchema = z.object({
  /** Drive query (e.g. `"<folderId>" in parents`). Defaults to non-trashed files. */
  query: z.string().default('trashed = false'),
  baseUrl: z.string().url().default('https://www.googleapis.com/drive/v3'),
});

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };
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

export const driveConnector: SourceConnector<typeof driveConfigSchema> = {
  slug: 'drive',
  name: 'Google Drive',
  description: 'Ingest Google Drive documents (Docs, Sheets, Slides, text) — incremental by modified time.',
  icon: 'FileText',
  authKind: 'oauth',
  configSchema: driveConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = driveConfigSchema.parse(ctx.config);
    // Durable path: refresh-token exchange (see googleAuth); legacy fallback
    // accepts a raw short-lived credentials.token.
    const token = await resolveGoogleAccessToken(ctx.credentials);
    const headers = { authorization: `Bearer ${token}` };
    const q = ctx.since
      ? `${cfg.query} and modifiedTime > '${ctx.since.toISOString()}'`
      : cfg.query;

    let pageToken = ctx.cursor ?? undefined;
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
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
        const exportMime = exportMimeFor(file.mimeType);
        if (exportMime) {
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
          metadata: { kind: 'drive-file', mimeType: file.mimeType },
        };
      }
      pageToken = list.nextPageToken;
    } while (pageToken);
  },
};
