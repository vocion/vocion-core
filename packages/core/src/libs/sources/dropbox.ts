/**
 * Dropbox connector — the files under one Dropbox folder (or the whole
 * Dropbox) as retrievable documents: text and PDFs read whole, everything
 * else by name and path (`fileText.ts`); and the client the files family's
 * Dropbox provider (`services/files/providers/dropbox.ts`) uses.
 *
 * Auth, three ways, told apart by the credential bag:
 *
 *   - a login grant from "Connect with Dropbox" (`libs/connect/providers/dropbox.ts`):
 *     a four-hour access token, refreshed and saved through `usableLoginGrant`;
 *   - a pasted refresh token with the app key and secret it was issued to:
 *     exchanged for an access token on every run (Dropbox refresh tokens do
 *     not expire or rotate, so there is nothing to save);
 *   - a pasted access token alone: used as it is, for as long as Dropbox
 *     honours it (four hours, for one generated on the app's page).
 *
 * Sync walks `files/list_folder` recursively (`list_folder/continue` by
 * cursor). A full run yields every file in scope and the tombstone pass drops
 * what is gone; an incremental run downloads only files whose
 * `server_modified` is past the watermark, less five minutes.
 */

import type { Buffer } from 'node:buffer';
import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { GrantPersistence, LoginGrant } from '@/libs/connect/loginGrant';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshDropboxGrant } from '@/libs/connect/providers/dropbox';
import { TokenRequestError } from '@/libs/connect/tokenRequest';
import { vendorRequest } from '@/libs/connectors/vendorRequest';
import { DEFAULT_FILE_EXTENSIONS, fileText, readsAsText } from './fileText';
import { InspectInputError } from './inspect';

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

export const dropboxConfigSchema = z.object({
  /** The folder to read, e.g. `/Northwind`; blank is the whole Dropbox. */
  path: z.string().trim().default(''),
  /** File types read whole; every other file is indexed by name and path. */
  extensions: z.array(z.string().trim().min(1)).default(DEFAULT_FILE_EXTENSIONS),
});

const WATERMARK_OVERLAP_MS = 5 * 60_000;
const MAX_LIST_PAGES = 200;

export type DropboxEntry = {
  '.tag': 'file' | 'folder' | 'deleted';
  'id'?: string;
  'name': string;
  'path_display'?: string;
  'path_lower'?: string;
  'server_modified'?: string;
  'size'?: number;
  'rev'?: string;
  'is_downloadable'?: boolean;
};

/**
 * A folder as Dropbox addresses it: `''` for the root, else a leading slash
 * and no trailing one.
 * @param path - The folder as typed.
 */
export function normalizeDropboxPath(path: string | null | undefined): string {
  const p = (path ?? '').trim().replace(/\/+$/, '');
  if (!p || p === '/') {
    return '';
  }
  return p.startsWith('/') || p.startsWith('id:') ? p : `/${p}`;
}

/**
 * The access token to call Dropbox with.
 * @param credentials - The decrypted bag.
 * @param persistence - Where a refreshed login is saved, or `never`.
 */
export async function resolveDropboxToken(credentials: Record<string, unknown> | undefined, persistence: GrantPersistence): Promise<string> {
  if (isLoginGrant(credentials)) {
    const grant = await usableLoginGrant({ vendor: 'Dropbox', provider: 'dropbox', connectorSlug: 'dropbox', grant: credentials as LoginGrant, persistence, refresh: refreshDropboxGrant });
    return grant.accessToken;
  }
  const token = typeof credentials?.token === 'string' ? credentials.token.trim() : '';
  if (!token) {
    throw new Error('No Dropbox token is stored. Connect Dropbox on the Connectors page: log in with Dropbox, or paste a refresh token with its app key and secret.');
  }
  const appKey = typeof credentials?.appKey === 'string' ? credentials.appKey.trim() : '';
  const appSecret = typeof credentials?.appSecret === 'string' ? credentials.appSecret.trim() : '';
  if (!appKey || !appSecret) {
    return token;
  }
  try {
    return (await refreshDropboxGrant(token, { clientId: appKey, clientSecret: appSecret, owner: 'workspace' })).accessToken;
  } catch (err) {
    const code = err instanceof TokenRequestError ? err.code : 'unreachable';
    throw new Error(`Dropbox would not trade the refresh token for an access token (${code}). Check the refresh token was issued to this app key, and that the app secret is right.`);
  }
}

/**
 * One RPC call (`api.dropboxapi.com/2`).
 * @param token - The access token.
 * @param path - The endpoint, e.g. `/files/list_folder`.
 * @param json - Its argument.
 */
export function dropboxApi<T>(token: string, path: string, json: unknown): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'Dropbox',
    url: `${API}${path}`,
    method: 'POST',
    json: json ?? null,
    headers: { authorization: `Bearer ${token}` },
    authHint: 'The token may have expired (a pasted access token lasts four hours) or lack files.metadata.read and files.content.read: connect Dropbox again on the Connectors page.',
  });
}

/**
 * The `Dropbox-API-Arg` header, ASCII-only as Dropbox requires.
 * @param arg - The argument.
 */
function apiArg(arg: unknown): string {
  const json = JSON.stringify(arg);
  let out = '';
  for (let i = 0; i < json.length; i += 1) {
    const unit = json.charCodeAt(i);
    out += unit < 0x7F ? json[i] : `\\u${unit.toString(16).padStart(4, '0')}`;
  }
  return out;
}

/**
 * A file's bytes (`files/download`), or a Paper doc as markdown (`files/export`).
 * @param token - The access token.
 * @param entry - The file, by id or path, and its name.
 * @param entry.path - Its id (`id:…`) or path.
 * @param entry.name - Its name, which says whether it is a Paper doc.
 */
export function dropboxDownload(token: string, entry: { path: string; name: string }): Promise<VendorResult<Buffer>> {
  const paper = entry.name.toLowerCase().endsWith('.paper');
  return vendorRequest<Buffer>({
    vendor: 'Dropbox',
    url: `${CONTENT}${paper ? '/files/export' : '/files/download'}`,
    method: 'POST',
    headers: { 'authorization': `Bearer ${token}`, 'dropbox-api-arg': apiArg(paper ? { path: entry.path, export_format: 'markdown' } : { path: entry.path }) },
    read: 'bytes',
    timeoutMs: 60_000,
  });
}

/**
 * Where a person opens a file in Dropbox on the web.
 * @param entry - The file.
 */
export function dropboxWebUrl(entry: Pick<DropboxEntry, 'name' | 'path_display'>): string {
  const path = entry.path_display ?? `/${entry.name}`;
  const parent = path.slice(0, path.lastIndexOf('/'));
  return `https://www.dropbox.com/home${parent.split('/').map(encodeURIComponent).join('/')}?preview=${encodeURIComponent(entry.name)}`;
}

/**
 * Whether a file is read whole: Paper docs always, else by extension and size.
 * @param entry - The file.
 * @param extensions - The source's list.
 */
export function dropboxReadsAsText(entry: DropboxEntry, extensions: readonly string[]): boolean {
  if (entry.is_downloadable === false && !entry.name.toLowerCase().endsWith('.paper')) {
    return false;
  }
  return entry.name.toLowerCase().endsWith('.paper') || readsAsText(entry.name, entry.size, extensions);
}

/**
 * The searchable document for one file.
 * @param entry - The file.
 * @param text - Its text, when it was read; null indexes it by name and path.
 */
export function dropboxFileDoc(entry: DropboxEntry, text: string | null): IngestDoc {
  const path = entry.path_display ?? entry.name;
  return {
    externalId: `dropbox:${entry.id ?? entry.path_lower ?? path}`,
    title: entry.name,
    content: text ? `${path}\n\n${text}` : path,
    uri: dropboxWebUrl(entry),
    etag: entry.rev ?? null,
    lastModifiedAt: entry.server_modified ? new Date(entry.server_modified) : null,
    metadata: { type: 'file', path, size: entry.size ?? null, read: text !== null },
  };
}

type ListPage = { entries?: DropboxEntry[]; cursor?: string; has_more?: boolean };

/**
 * Test connection: whose Dropbox it is, and that the folder lists. Read-only.
 * @param config - The source config (`path`).
 * @param values - The credential values.
 */
export async function inspectDropbox(config: Record<string, unknown>, values: Record<string, unknown>): Promise<ConnectorInspection> {
  let token: string;
  try {
    token = await resolveDropboxToken(values, { kind: 'never' });
  } catch (err) {
    throw new InspectInputError((err as Error).message);
  }
  const me = await dropboxApi<{ email?: string; name?: { display_name?: string } }>(token, '/users/get_current_account', null);
  if (!me.ok) {
    return { reachable: me.kind !== 'unreachable', authorized: false, checks: [{ key: 'account', label: 'Signs in to Dropbox', ok: false, detail: me.message }], note: null, error: me.message };
  }
  const checks: ConnectorCheck[] = [{ key: 'account', label: 'Signs in to Dropbox', ok: true, detail: me.data.email ?? me.data.name?.display_name ?? 'account' }];
  const path = normalizeDropboxPath(typeof config.path === 'string' ? config.path : '');
  const list = await dropboxApi<ListPage>(token, '/files/list_folder', { path, limit: 1 });
  checks.push({ key: 'folder', label: `Lists ${path || 'the whole Dropbox'}`, ok: list.ok, detail: list.ok ? 'The folder is readable.' : list.message });
  return { reachable: true, authorized: true, checks, note: null, error: list.ok ? null : list.message };
}

export const dropboxConnector: SourceConnector<typeof dropboxConfigSchema> = {
  slug: 'dropbox',
  brand: 'dropbox',
  name: 'Dropbox',
  description: 'Files from Dropbox: text, Markdown, CSV, PDFs and Paper docs read whole, everything else by name and path. Synced by modified time; agents search, list and read files live.',
  icon: 'FolderOpen',
  authKind: 'oauth',
  configSchema: dropboxConfigSchema,
  defaultReconcileCron: '0 5 * * *',
  inspectNote: 'Reads whose Dropbox it is and lists the folder. Read-only. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectDropbox(config, credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = dropboxConfigSchema.parse(ctx.config);
    const token = await resolveDropboxToken(ctx.credentials, { kind: 'persist', orgId: ctx.orgId, sourceId: ctx.sourceId, warn: message => ctx.onProgress?.({ kind: 'error', message }) });
    const since = ctx.since ? ctx.since.getTime() - WATERMARK_OVERLAP_MS : null;
    let res = await dropboxApi<ListPage>(token, '/files/list_folder', { path: normalizeDropboxPath(cfg.path), recursive: true, include_deleted: false, limit: 2000 });
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      if (!res.ok) {
        throw new Error(res.message);
      }
      for (const entry of res.data.entries ?? []) {
        if (entry['.tag'] !== 'file') {
          continue;
        }
        if (since !== null && entry.server_modified && Date.parse(entry.server_modified) < since) {
          continue;
        }
        let text: string | null = null;
        if (dropboxReadsAsText(entry, cfg.extensions)) {
          const bytes = await dropboxDownload(token, { path: entry.id ?? entry.path_lower ?? entry.name, name: entry.name });
          if (bytes.ok) {
            text = await fileText(entry.name.toLowerCase().endsWith('.paper') ? `${entry.name}.md` : entry.name, bytes.data).catch(() => null);
          } else {
            ctx.onProgress?.({ kind: 'error', uri: entry.path_display, message: `${entry.path_display ?? entry.name}: ${bytes.message}` });
          }
        }
        ctx.onProgress?.({ kind: 'fetched', uri: entry.path_display });
        yield dropboxFileDoc(entry, text);
      }
      if (!res.data.has_more || !res.data.cursor) {
        return;
      }
      res = await dropboxApi<ListPage>(token, '/files/list_folder/continue', { cursor: res.data.cursor });
    }
    ctx.onProgress?.({ kind: 'error', message: `Dropbox sync stopped at the ${MAX_LIST_PAGES}-page cap; the rest lands on the next run.` });
  },
};
