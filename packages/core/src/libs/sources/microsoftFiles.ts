/**
 * OneDrive and SharePoint connectors — ingest documents from a Microsoft 365
 * document library, the Microsoft 365 twins of the Google Drive connector.
 *
 * Both are the same Graph object, a drive of driveItems: OneDrive is the
 * signed-in person's own drive (`Files.Read.All`), a SharePoint library is a
 * site's drive (`Sites.Read.All`). One walker serves both; they differ only
 * in which drive they open.
 *
 * Text: Word, PowerPoint, Excel and the other formats Graph can render are
 * fetched as PDF (`?format=pdf`, Graph's own conversion) and read with the
 * same PDF reader chat attachments use; PDFs are read as they are; plain text,
 * Markdown, CSV and JSON are downloaded. Anything else (images, archives)
 * yields its name and path only, as Drive does with binaries.
 *
 * Incremental: the folder tree is walked every run (cheap: names and dates),
 * and only files modified at or after `ctx.since` are downloaded and yielded.
 * A daily full sync is the reconcile pass that lets a deleted file leave the
 * index.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { GRAPH_BASE, GraphError, graphFetch, graphJson, graphPages, persistTo, resolveGraphToken, responseBytes } from '@/libs/microsoft/graph';
import { inspectMicrosoft } from '@/libs/microsoft/inspect';

export const ONEDRIVE_SLUG = 'onedrive';
export const SHAREPOINT_SLUG = 'sharepoint';

/** Files above this are listed by name only; a sync is not a backup. */
const MAX_CONTENT_BYTES = 25 * 1024 * 1024;
/** How deep a folder walk goes, and how many files one run reads at most. */
const MAX_DEPTH = 12;
const MAX_FILES = 5000;

/** Extensions Graph converts to PDF (`GET …/content?format=pdf`). */
const CONVERTIBLE = new Set(['doc', 'docx', 'dot', 'dotx', 'odt', 'rtf', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'xls', 'xlsx', 'xlsm', 'ods', 'htm', 'html', 'eml', 'msg', 'epub']);
/** Extensions read as UTF-8 text. */
const TEXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'log']);

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  package?: unknown;
  parentReference?: { driveId?: string; path?: string };
  lastModifiedBy?: { user?: { displayName?: string } };
};

/**
 * A file's extension, lowercase, without the dot.
 * @param name - The file's name.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * How a file's text is read: converted to PDF, downloaded as text, downloaded
 * as a PDF, or not at all.
 * @param item - The driveItem.
 */
export function readModeOf(item: DriveItem): 'convert' | 'text' | 'pdf' | 'none' {
  const ext = extensionOf(item.name);
  const mime = item.file?.mimeType ?? '';
  if (ext === 'pdf' || mime === 'application/pdf') {
    return 'pdf';
  }
  if (CONVERTIBLE.has(ext)) {
    return 'convert';
  }
  if (TEXT.has(ext) || mime.startsWith('text/')) {
    return 'text';
  }
  return 'none';
}

/**
 * The text of one file, or '' when it has none to read. Throws `GraphError`.
 * @param token - The access token.
 * @param drivePath - The drive's path (`/me/drive`, `/drives/<id>`).
 * @param item - The file.
 * @param baseUrl - The Graph base.
 */
export async function readDriveItemText(token: string, drivePath: string, item: DriveItem, baseUrl: string = GRAPH_BASE): Promise<string> {
  const mode = readModeOf(item);
  if (mode === 'none' || (item.size ?? 0) > MAX_CONTENT_BYTES) {
    return '';
  }
  const path = `${drivePath}/items/${encodeURIComponent(item.id)}/content${mode === 'convert' ? '?format=pdf' : ''}`;
  const response = await graphFetch(token, { path, what: `the file "${item.name}"`, baseUrl, headers: { accept: '*/*' } });
  const bytes = await responseBytes(response);
  if (mode === 'text') {
    return bytes.toString('utf8').trim();
  }
  const { extractText } = await import('@/services/chat/attachments');
  return extractText(bytes, 'application/pdf');
}

/**
 * Every file under a folder, depth first, with the folder path it sits in.
 * @param token - The access token.
 * @param drivePath - The drive's path.
 * @param folderPath - A folder inside the drive, or '' for its root.
 * @param baseUrl - The Graph base.
 * @yields {{ item: DriveItem; folder: string }} Each file, with the folder path it sits in.
 */
async function* walkDrive(token: string, drivePath: string, folderPath: string, baseUrl: string): AsyncIterable<{ item: DriveItem; folder: string }> {
  const trimmed = folderPath.replace(/^\/+|\/+$/g, '');
  const start = trimmed ? `${drivePath}/root:/${trimmed.split('/').map(encodeURIComponent).join('/')}:` : `${drivePath}/root`;
  const queue: Array<{ path: string; folder: string; depth: number }> = [{ path: start, folder: trimmed, depth: 0 }];
  let files = 0;
  while (queue.length > 0) {
    const next = queue.shift()!;
    const listing = `${next.path}/children?$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,package,parentReference,lastModifiedBy&$top=200`;
    for await (const item of graphPages<DriveItem>(token, { path: listing, what: `the folder "${next.folder || '/'}"`, baseUrl })) {
      if (item.folder) {
        if (next.depth < MAX_DEPTH) {
          queue.push({ path: `${drivePath}/items/${encodeURIComponent(item.id)}`, folder: next.folder ? `${next.folder}/${item.name}` : item.name, depth: next.depth + 1 });
        }
        continue;
      }
      if (!item.file) {
        continue;
      }
      files += 1;
      if (files > MAX_FILES) {
        return;
      }
      yield { item, folder: next.folder };
    }
  }
}

/**
 * Whether a failed file read says something about the whole run (the login,
 * throttling, an outage) rather than about one file.
 * @param error - What the read threw.
 */
function isRunFailure(error: GraphError): boolean {
  return error.status === 0 || error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500;
}

/**
 * Yield a drive's files as documents — the body shared by both connectors.
 * @param ctx - The sync context.
 * @param input - Which drive, and how to name its documents.
 * @param input.token - The access token.
 * @param input.drivePath - The drive's path.
 * @param input.folderPath - A folder inside it, or ''.
 * @param input.baseUrl - The Graph base.
 * @param input.prefix - The externalId prefix, `onedrive` or `sharepoint`.
 * @param input.kind - The metadata kind.
 * @param input.where - Extra metadata saying where the drive is.
 * @yields {IngestDoc} One document per file.
 */
async function* syncDrive(ctx: SourceContext, input: { token: string; drivePath: string; folderPath: string; baseUrl: string; prefix: string; kind: string; where: Record<string, unknown> }): AsyncIterable<IngestDoc> {
  const since = ctx.since?.getTime() ?? null;
  for await (const { item, folder } of walkDrive(input.token, input.drivePath, input.folderPath, input.baseUrl)) {
    const modified = item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) : Number.NaN;
    if (since !== null && Number.isFinite(modified) && modified < since) {
      ctx.onProgress?.({ kind: 'skipped', uri: item.id });
      continue;
    }
    let content = '';
    try {
      content = await readDriveItemText(input.token, input.drivePath, item, input.baseUrl);
    } catch (error) {
      // A file Graph cannot render (a damaged or protected document answers
      // 4xx) is indexed by name, as a binary is. Anything that says the login
      // or the service failed is reported, and the run then skips
      // tombstoning, so nothing is deleted on a partial read.
      if (!(error instanceof GraphError) || isRunFailure(error)) {
        ctx.onProgress?.({ kind: 'error', uri: item.id, message: error instanceof GraphError ? error.message : `Could not read "${item.name}".` });
      }
    }
    const path = folder ? `${folder}/${item.name}` : item.name;
    ctx.onProgress?.({ kind: 'fetched', uri: item.id });
    yield {
      externalId: `${input.prefix}:${item.parentReference?.driveId ?? 'drive'}:${item.id}`,
      title: item.name,
      content: content || `${item.name}\n${path}`,
      lastModifiedAt: Number.isFinite(modified) ? new Date(modified) : null,
      metadata: {
        kind: input.kind,
        mimeType: item.file?.mimeType ?? null,
        path,
        webUrl: item.webUrl ?? null,
        modifiedBy: item.lastModifiedBy?.user?.displayName ?? null,
        ...input.where,
      },
    };
  }
}

const onedriveConfigSchema = z.object({
  /** A folder in the drive to sync, e.g. `Clients/Northwind`. Blank: the whole drive. */
  folderPath: z.string().default(''),
  baseUrl: z.string().url().default(GRAPH_BASE),
});

export const onedriveConnector: SourceConnector<typeof onedriveConfigSchema> = {
  slug: ONEDRIVE_SLUG,
  name: 'OneDrive',
  description: 'Documents from OneDrive. Word, Excel, PowerPoint, PDF and text files, synced incrementally by modified time.',
  icon: 'FileText',
  authKind: 'oauth',
  brand: 'microsoftonedrive',
  configSchema: onedriveConfigSchema,
  defaultReconcileCron: '30 4 * * *',
  requiredScopes: ['Files.Read.All'],
  inspectNote: 'Reads who the Microsoft login is and opens its OneDrive. Nothing is saved, except an expired login it renews for a connected source.',
  inspect: input => inspectMicrosoft(ONEDRIVE_SLUG, {
    label: 'Open the OneDrive',
    run: async (token, _config, baseUrl) => {
      const drive = await graphJson<{ name?: string; driveType?: string }>(token, { path: '/me/drive?$select=name,driveType', what: 'the OneDrive', baseUrl });
      return `${drive.name ?? 'OneDrive'} (${drive.driveType ?? 'drive'})`;
    },
  }, input),
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = onedriveConfigSchema.parse(ctx.config);
    const token = await resolveGraphToken(ctx.credentials, persistTo(ctx.orgId, ctx.sourceId, message => ctx.onProgress?.({ kind: 'error', message })), ONEDRIVE_SLUG);
    yield* syncDrive(ctx, { token, drivePath: '/me/drive', folderPath: cfg.folderPath, baseUrl: cfg.baseUrl, prefix: 'onedrive', kind: 'onedrive-file', where: {} });
  },
};

const sharepointConfigSchema = z.object({
  /**
   * The site: its address (`https://contoso.sharepoint.com/sites/Sales`), the
   * Graph form (`contoso.sharepoint.com:/sites/Sales`) or its id. Blank: the
   * organization's root site.
   */
  site: z.string().default(''),
  /** A document library by name (`Documents`, `Proposals`). Blank: the site's default library. */
  library: z.string().default(''),
  /** A folder inside the library to sync. Blank: the whole library. */
  folderPath: z.string().default(''),
  baseUrl: z.string().url().default(GRAPH_BASE),
});

/**
 * The Graph path of a site, from what a person pastes.
 * @param site - A site address, the Graph `host:/path` form, a site id, or ''.
 */
export function sitePath(site: string): string {
  const value = site.trim();
  if (!value) {
    return '/sites/root';
  }
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, '');
    return path && path !== '/' ? `/sites/${url.host}:${path}:` : `/sites/${url.host}`;
  }
  return `/sites/${value.includes(':/') && !value.endsWith(':') ? `${value}:` : value}`;
}

/**
 * The drive a SharePoint source reads: the named library, or the site's default.
 * @param token - The access token.
 * @param cfg - The source's settings.
 * @param cfg.site - The site.
 * @param cfg.library - The library name, or ''.
 * @param cfg.baseUrl - The Graph base.
 */
export async function sharepointDrive(token: string, cfg: { site: string; library: string; baseUrl: string }): Promise<{ drivePath: string; siteId: string; siteName: string | null; library: string | null }> {
  const site = await graphJson<{ id: string; displayName?: string; webUrl?: string }>(token, { path: `${sitePath(cfg.site)}?$select=id,displayName,webUrl`, what: `the SharePoint site "${cfg.site || 'root'}"`, baseUrl: cfg.baseUrl });
  if (!cfg.library.trim()) {
    const drive = await graphJson<{ id: string; name?: string }>(token, { path: `/sites/${encodeURIComponent(site.id)}/drive?$select=id,name`, what: 'the site\'s document library', baseUrl: cfg.baseUrl });
    return { drivePath: `/drives/${encodeURIComponent(drive.id)}`, siteId: site.id, siteName: site.displayName ?? null, library: drive.name ?? null };
  }
  const wanted = cfg.library.trim().toLowerCase();
  for await (const drive of graphPages<{ id: string; name?: string }>(token, { path: `/sites/${encodeURIComponent(site.id)}/drives?$select=id,name`, what: 'the site\'s document libraries', baseUrl: cfg.baseUrl })) {
    if (drive.name?.toLowerCase() === wanted) {
      return { drivePath: `/drives/${encodeURIComponent(drive.id)}`, siteId: site.id, siteName: site.displayName ?? null, library: drive.name ?? null };
    }
  }
  throw new Error(`The SharePoint site ${site.displayName ?? cfg.site} has no document library named "${cfg.library}". Check the library name in the source's settings.`);
}

export const sharepointConnector: SourceConnector<typeof sharepointConfigSchema> = {
  slug: SHAREPOINT_SLUG,
  name: 'SharePoint',
  description: 'Documents from a SharePoint site\'s library. Word, Excel, PowerPoint, PDF and text files, synced incrementally by modified time.',
  icon: 'FolderOpen',
  authKind: 'oauth',
  brand: 'microsoftsharepoint',
  configSchema: sharepointConfigSchema,
  defaultReconcileCron: '35 4 * * *',
  requiredScopes: ['Sites.Read.All'],
  inspectNote: 'Reads who the Microsoft login is and opens the site and library this source syncs. Nothing is saved, except an expired login it renews for a connected source.',
  inspect: input => inspectMicrosoft(SHAREPOINT_SLUG, {
    label: 'Open the site\'s library',
    run: async (token, config, baseUrl) => {
      const drive = await sharepointDrive(token, { site: typeof config.site === 'string' ? config.site : '', library: typeof config.library === 'string' ? config.library : '', baseUrl });
      return `${drive.siteName ?? 'Site'} — ${drive.library ?? 'Documents'}`;
    },
  }, input),
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = sharepointConfigSchema.parse(ctx.config);
    const token = await resolveGraphToken(ctx.credentials, persistTo(ctx.orgId, ctx.sourceId, message => ctx.onProgress?.({ kind: 'error', message })), SHAREPOINT_SLUG);
    const drive = await sharepointDrive(token, cfg);
    yield* syncDrive(ctx, {
      token,
      drivePath: drive.drivePath,
      folderPath: cfg.folderPath,
      baseUrl: cfg.baseUrl,
      prefix: 'sharepoint',
      kind: 'sharepoint-file',
      where: { siteId: drive.siteId, siteName: drive.siteName, library: drive.library },
    });
  },
};
