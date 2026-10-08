/**
 * Box connector — the files under one Box folder (the whole account, from
 * folder 0) as retrievable documents: text and PDFs read whole, everything
 * else by name and path (`fileText.ts`); and the client the files family's
 * Box provider (`services/files/providers/box.ts`) uses.
 *
 * Auth, three ways, told apart by the credential bag:
 *
 *   - a login grant from "Connect with Box" (`libs/connect/providers/box.ts`):
 *     an hour-long access token whose refresh token ROTATES, refreshed and
 *     saved through `usableLoginGrant`, one caller at a time;
 *   - a Custom App's client ID and secret with Client Credentials Grant, as
 *     the enterprise's service account or as one user: a fresh token minted
 *     per run, nothing to save — the way that works without an OAuth app on
 *     the server;
 *   - a developer token from the app's page, used as it is: 60 minutes, for a
 *     test.
 *
 * Sync walks the folder tree breadth-first (`/folders/{id}/items`, marker
 * paginated). A full run yields every file in scope and the tombstone pass
 * drops what is gone; an incremental run downloads only files modified past
 * the watermark, less five minutes.
 */

import type { Buffer } from 'node:buffer';
import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { GrantPersistence, LoginGrant } from '@/libs/connect/loginGrant';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { BOX_TOKEN_URL, refreshBoxGrant } from '@/libs/connect/providers/box';
import { postTokenRequest, TokenRequestError } from '@/libs/connect/tokenRequest';
import { vendorRequest } from '@/libs/connectors/vendorRequest';
import { DEFAULT_FILE_EXTENSIONS, fileText, readsAsText } from './fileText';
import { InspectInputError } from './inspect';

export const BOX_API = 'https://api.box.com/2.0';

export const boxConfigSchema = z.object({
  /** The folder to read, by its id (the number in its Box URL); 0 is everything the account sees. */
  folderId: z.string().trim().regex(/^\d+$/, 'is the number at the end of the folder\'s Box URL').default('0'),
  /** File types read whole; every other file is indexed by name and path. */
  extensions: z.array(z.string().trim().min(1)).default(DEFAULT_FILE_EXTENSIONS),
});

const WATERMARK_OVERLAP_MS = 5 * 60_000;
const MAX_FOLDERS = 2000;
const MAX_FILES = 20_000;
export const BOX_ITEM_FIELDS = 'id,type,name,modified_at,size,sha1';

export type BoxItem = { type: 'file' | 'folder' | 'web_link'; id: string; name: string; modified_at?: string | null; size?: number | null; sha1?: string | null; path_collection?: { entries?: Array<{ id: string; name: string }> } | null };

/**
 * The access token to call Box with.
 * @param credentials - The decrypted bag.
 * @param persistence - Where a refreshed login is saved, or `never`.
 */
export async function resolveBoxToken(credentials: Record<string, unknown> | undefined, persistence: GrantPersistence): Promise<string> {
  if (isLoginGrant(credentials)) {
    const grant = await usableLoginGrant({ vendor: 'Box', provider: 'box', connectorSlug: 'box', grant: credentials as LoginGrant, persistence, refresh: refreshBoxGrant });
    return grant.accessToken;
  }
  const str = (k: string) => (typeof credentials?.[k] === 'string' ? (credentials[k] as string).trim() : '');
  const developerToken = str('developerToken');
  if (developerToken) {
    return developerToken;
  }
  const clientId = str('clientId');
  const clientSecret = str('clientSecret');
  const userId = str('userId');
  const enterpriseId = str('enterpriseId');
  if (!clientId || !clientSecret || (!userId && !enterpriseId)) {
    throw new Error('The Box credential needs a Custom App\'s client ID and secret with the enterprise ID (or a user ID), or a developer token. Connect Box again on the Connectors page.');
  }
  try {
    const body = await postTokenRequest({
      vendor: 'Box',
      url: BOX_TOKEN_URL,
      encoding: 'form',
      params: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, box_subject_type: userId ? 'user' : 'enterprise', box_subject_id: userId || enterpriseId },
    });
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new TokenRequestError('Box', 'no_token', null);
    }
    return body.access_token;
  } catch (err) {
    const code = err instanceof TokenRequestError ? err.code : 'unreachable';
    throw new Error(`Box would not issue a token for the app (${code}). Check the client ID and secret, that the app uses Client Credentials Grant, and that a Box admin authorized it for the enterprise.`);
  }
}

/**
 * One call to the Box API.
 * @param token - The access token.
 * @param path - The path, from `/2.0`.
 * @param read - How to read the answer.
 */
export function boxApi<T>(token: string, path: string, read: 'json' | 'bytes' = 'json'): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'Box',
    url: `${BOX_API}${path}`,
    headers: { authorization: `Bearer ${token}` },
    read,
    timeoutMs: read === 'bytes' ? 60_000 : 30_000,
    authHint: 'The token may have expired (a developer token lasts 60 minutes) or the app was not authorized for this content: connect Box again on the Connectors page.',
  });
}

/**
 * A file's bytes.
 * @param token - The access token.
 * @param id - The file id.
 */
export function boxDownload(token: string, id: string): Promise<VendorResult<Buffer>> {
  return boxApi<Buffer>(token, `/files/${encodeURIComponent(id)}/content`, 'bytes');
}

/**
 * Where a person opens a file or folder in Box.
 * @param item - The file or folder.
 */
export function boxWebUrl(item: Pick<BoxItem, 'type' | 'id'>): string {
  return `https://app.box.com/${item.type === 'folder' ? 'folder' : 'file'}/${item.id}`;
}

/**
 * The searchable document for one file.
 * @param item - The file.
 * @param path - Its folder path, for a person reading the result.
 * @param text - Its text, when it was read; null indexes it by name and path.
 */
export function boxFileDoc(item: BoxItem, path: string, text: string | null): IngestDoc {
  const full = `${path}/${item.name}`;
  return {
    externalId: `box:${item.id}`,
    title: item.name,
    content: text ? `${full}\n\n${text}` : full,
    uri: boxWebUrl(item),
    etag: item.sha1 ?? null,
    lastModifiedAt: item.modified_at ? new Date(item.modified_at) : null,
    metadata: { type: 'file', path: full, size: item.size ?? null, read: text !== null },
  };
}

type ItemsPage = { entries?: BoxItem[]; next_marker?: string | null };

/**
 * Every item directly in a folder, all pages.
 * @param token - The access token.
 * @param folderId - The folder.
 */
export async function boxFolderItems(token: string, folderId: string): Promise<BoxItem[]> {
  const items: BoxItem[] = [];
  let marker: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const res: VendorResult<ItemsPage> = await boxApi<ItemsPage>(token, `/folders/${encodeURIComponent(folderId)}/items?fields=${BOX_ITEM_FIELDS}&limit=1000&usemarker=true${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`);
    if (!res.ok) {
      throw new Error(res.message);
    }
    items.push(...(res.data.entries ?? []));
    marker = res.data.next_marker ?? null;
    if (!marker) {
      break;
    }
  }
  return items;
}

/**
 * Test connection: whose Box it is, and that the folder reads. Read-only.
 * @param config - The source config (`folderId`).
 * @param values - The credential values.
 */
export async function inspectBox(config: Record<string, unknown>, values: Record<string, unknown>): Promise<ConnectorInspection> {
  let token: string;
  try {
    token = await resolveBoxToken(values, { kind: 'never' });
  } catch (err) {
    throw new InspectInputError((err as Error).message);
  }
  const me = await boxApi<{ name?: string; login?: string }>(token, '/users/me');
  if (!me.ok) {
    return { reachable: me.kind !== 'unreachable', authorized: false, checks: [{ key: 'account', label: 'Signs in to Box', ok: false, detail: me.message }], note: null, error: me.message };
  }
  const checks: ConnectorCheck[] = [{ key: 'account', label: 'Signs in to Box', ok: true, detail: me.data.login ?? me.data.name ?? 'account' }];
  const folderId = typeof config.folderId === 'string' && /^\d+$/.test(config.folderId.trim()) ? config.folderId.trim() : '0';
  const folder = await boxApi<{ name?: string; item_collection?: { total_count?: number } }>(token, `/folders/${folderId}?fields=name,item_collection`);
  checks.push({ key: 'folder', label: `Reads folder ${folderId}`, ok: folder.ok, detail: folder.ok ? `${folder.data.name ?? 'All files'} (${folder.data.item_collection?.total_count ?? 0} items)` : folder.message });
  return { reachable: true, authorized: true, checks, note: null, error: folder.ok ? null : folder.message };
}

export const boxConnector: SourceConnector<typeof boxConfigSchema> = {
  slug: 'box',
  brand: 'box',
  name: 'Box',
  description: 'Files from Box: text, Markdown, CSV and PDFs read whole, everything else by name and path. Synced by modified time; agents search, list and read files live.',
  icon: 'FolderOpen',
  authKind: 'oauth',
  configSchema: boxConfigSchema,
  defaultReconcileCron: '15 5 * * *',
  inspectNote: 'Reads whose Box it is and the folder. Read-only. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectBox(config, credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = boxConfigSchema.parse(ctx.config);
    const token = await resolveBoxToken(ctx.credentials, { kind: 'persist', orgId: ctx.orgId, sourceId: ctx.sourceId, warn: message => ctx.onProgress?.({ kind: 'error', message }) });
    const since = ctx.since ? ctx.since.getTime() - WATERMARK_OVERLAP_MS : null;
    const queue: Array<{ id: string; path: string }> = [{ id: cfg.folderId, path: '' }];
    let folders = 0;
    let files = 0;
    while (queue.length > 0) {
      const folder = queue.shift()!;
      folders += 1;
      if (folders > MAX_FOLDERS || files >= MAX_FILES) {
        ctx.onProgress?.({ kind: 'error', message: `Box sync stopped at ${MAX_FOLDERS} folders or ${MAX_FILES} files; narrow the source to a folder.` });
        return;
      }
      let items: BoxItem[];
      try {
        items = await boxFolderItems(token, folder.id);
      } catch (err) {
        ctx.onProgress?.({ kind: 'error', uri: folder.path || '/', message: `${folder.path || 'the root folder'}: ${(err as Error).message}` });
        continue;
      }
      for (const item of items) {
        if (item.type === 'folder') {
          queue.push({ id: item.id, path: `${folder.path}/${item.name}` });
          continue;
        }
        if (item.type !== 'file') {
          continue;
        }
        if (since !== null && item.modified_at && Date.parse(item.modified_at) < since) {
          continue;
        }
        files += 1;
        let text: string | null = null;
        if (readsAsText(item.name, item.size, cfg.extensions)) {
          const bytes = await boxDownload(token, item.id);
          if (bytes.ok) {
            text = await fileText(item.name, bytes.data).catch(() => null);
          } else {
            ctx.onProgress?.({ kind: 'error', uri: item.id, message: `${folder.path}/${item.name}: ${bytes.message}` });
          }
        }
        ctx.onProgress?.({ kind: 'fetched', uri: item.id });
        yield boxFileDoc(item, folder.path, text);
      }
    }
  },
};
