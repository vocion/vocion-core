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

import type { AssetRow } from './assetCatalog';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { assetCatalogConfigSchema, assetDoc, checkLink, configCatalogRows, dedupeByUrl, normalizeAssetUrl, parseCatalogGrid } from './assetCatalog';
import { resolveGoogleAccessToken } from './googleAuth';

const driveConfigSchema = z.object({
  /** Drive query (e.g. `"<folderId>" in parents`). Defaults to non-trashed files. */
  query: z.string().default('trashed = false'),
  /** Also list files on shared drives the identity can open, not only My Drive and files shared with it. */
  allDrives: z.boolean().default(false),
  baseUrl: z.string().url().default('https://www.googleapis.com/drive/v3'),
  /** An asset catalog read from spreadsheets as one document per row (`./assetCatalog.ts`). */
  catalog: assetCatalogConfigSchema.optional(),
});

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };
type DriveList = { files?: DriveFile[]; nextPageToken?: string };

/**
 * The text export target for a Google-native mime type, or null to skip export.
 * @param mimeType
 */
export function exportMimeFor(mimeType: string): string | null {
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
  description: 'Docs, Sheets and Slides from Google Drive. Plain text files too, synced incrementally by modified time.',
  icon: 'FileText',
  category: 'docs-files',
  brand: 'googledrive',
  authKind: 'oauth',
  configSchema: driveConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = driveConfigSchema.parse(ctx.config);
    // Durable path: refresh-token exchange (see googleAuth); legacy fallback
    // accepts a raw short-lived credentials.token.
    const token = await resolveGoogleAccessToken(ctx.credentials, ctx.orgId);
    const headers = { authorization: `Bearer ${token}` };
    if (cfg.catalog) {
      yield* syncCatalog(ctx, cfg, headers);
    }
    const q = ctx.since
      ? `${cfg.query} and modifiedTime > '${ctx.since.toISOString()}'`
      : cfg.query;

    let pageToken = ctx.cursor ?? undefined;
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
        pageSize: '100',
        ...(cfg.allDrives ? { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' } : {}),
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
          if (cfg.allDrives) {
            ep.set('supportsAllDrives', 'true');
          }
          const exportRes = await fetch(`${cfg.baseUrl}/files/${file.id}/export?${ep.toString()}`, { headers });
          if (exportRes.ok) {
            content = await exportRes.text();
          } else {
            ctx.onProgress?.({ kind: 'error', uri: file.id, message: `export ${file.id}: ${exportRes.status}` });
          }
        } else if (file.mimeType.startsWith('text/')) {
          const dlRes = await fetch(`${cfg.baseUrl}/files/${file.id}?alt=media${cfg.allDrives ? '&supportsAllDrives=true' : ''}`, { headers });
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The catalog's rows, on every sync whatever `since` says: the sheet is small,
 * and a row seen on every pass is how a row removed from the sheet drops out.
 * @param ctx
 * @param cfg
 * @param headers
 */
async function* syncCatalog(ctx: SourceContext, cfg: z.infer<typeof driveConfigSchema>, headers: Record<string, string>): AsyncIterable<IngestDoc> {
  const catalog = cfg.catalog!;
  const all: AssetRow[] = [];
  const skipped: Array<{ title: string; why: string }> = [];
  const shared = cfg.allDrives ? '&supportsAllDrives=true' : '';
  for (const file of catalog.files) {
    const meta = await fetch(`${cfg.baseUrl}/files/${file.fileId}?fields=id,name,mimeType${shared}`, { headers });
    if (!meta.ok) {
      ctx.onProgress?.({ kind: 'error', uri: file.fileId, message: `asset catalog ${file.fileId}: ${meta.status}, the connected Google account cannot open it` });
      continue;
    }
    const { mimeType, name } = (await meta.json()) as { mimeType: string; name: string };
    const url = mimeType === 'application/vnd.google-apps.spreadsheet'
      ? `${cfg.baseUrl}/files/${file.fileId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}${shared}`
      : `${cfg.baseUrl}/files/${file.fileId}?alt=media${shared}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      ctx.onProgress?.({ kind: 'error', uri: file.fileId, message: `asset catalog "${name}": download ${res.status}` });
      continue;
    }
    const XLSX = await import('xlsx');
    const book = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer', dense: true, cellFormula: false, cellHTML: false, cellStyles: false });
    const sheetName = file.sheet ?? book.SheetNames[0]!;
    const ws = book.Sheets[sheetName];
    if (!ws) {
      ctx.onProgress?.({ kind: 'error', uri: file.fileId, message: `asset catalog "${name}" has no tab "${sheetName}"` });
      continue;
    }
    // A cell whose text is a label ("Download") over a hyperlink carries
    // its link in `l.Target`; the catalog wants the link.
    for (const row of (ws['!data'] ?? []) as Array<Array<{ v?: unknown; w?: string; l?: { Target?: string } } | undefined> | undefined>) {
      for (const cell of row ?? []) {
        if (cell?.l?.Target && /^https?:/i.test(cell.l.Target) && !/https?:\/\//.test(String(cell.w ?? cell.v ?? ''))) {
          cell.v = cell.l.Target;
          cell.w = cell.l.Target;
        }
      }
    }
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
    const parsed = parseCatalogGrid(grid, `sheet:${file.fileId}`);
    all.push(...parsed.rows);
    skipped.push(...parsed.skipped);
  }
  // The sheet's rows first: a config row for the same link is a fallback
  // for when the sheet cannot be read, and is dropped quietly when it can.
  const fromSheet = new Set(all.map(r => normalizeAssetUrl(r.url)));
  const unique = dedupeByUrl([...all, ...configCatalogRows(catalog.rows).filter(r => !fromSheet.has(normalizeAssetUrl(r.url)))]);
  skipped.push(...unique.skipped);
  for (const s of skipped) {
    ctx.onProgress?.({ kind: 'skipped', uri: `asset:${s.title}`, message: `asset "${s.title}" skipped: ${s.why}` });
  }
  const rows = unique.rows;
  if (catalog.checkLinks) {
    // A few at a time: these are the marketing site's own pages.
    for (let i = 0; i < rows.length; i += 6) {
      const batch = rows.slice(i, i + 6);
      const checked = await Promise.all(batch.map(r => checkLink(r.url)));
      batch.forEach((r, j) => {
        r.linkOk = checked[j]!.ok;
        r.linkStatus = checked[j]!.status;
      });
    }
  }
  for (const row of rows) {
    ctx.onProgress?.({ kind: 'fetched', uri: row.url });
    yield assetDoc(row);
  }
}
