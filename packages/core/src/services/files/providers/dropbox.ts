/**
 * DROPBOX — a files provider (`../provider.ts`), on the client and
 * credential the `dropbox` source syncs with (`libs/sources/dropbox.ts`).
 *
 * Search is `files/search_v2` inside the source's folder; a file read by id
 * or path is refused when it sits outside that folder. A login refreshed
 * here is saved to the source's credential, as a sync would.
 */

import type { FileContent, FileRow, FilesProvider } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { DropboxEntry } from '@/libs/sources/dropbox';
import { orThrow } from '@/libs/connectors/vendorRequest';
import { dropboxApi, dropboxConfigSchema, dropboxDownload, dropboxReadsAsText, dropboxWebUrl, normalizeDropboxPath, resolveDropboxToken } from '@/libs/sources/dropbox';
import { fileText } from '@/libs/sources/fileText';

const TEXT_MAX = 60_000;

function row(e: DropboxEntry): FileRow {
  return { id: e.id ?? e.path_lower ?? e.name, name: e.name, path: e.path_display ?? e.name, folder: e['.tag'] === 'folder', url: dropboxWebUrl(e), size: e.size ?? null, modified: e.server_modified ?? null };
}

/**
 * The provider for one Dropbox source.
 * @param orgId - The workspace.
 * @param source - The `dropbox` source row.
 * @param credentials - Its decrypted credential.
 */
export async function dropboxFilesProvider(orgId: string, source: FamilySource, credentials: Record<string, unknown> | undefined): Promise<FilesProvider> {
  const cfg = dropboxConfigSchema.parse(source.config);
  const root = normalizeDropboxPath(cfg.path);
  const token = await resolveDropboxToken(credentials, { kind: 'persist', orgId, sourceId: source.id, warn: message => console.warn('[files/dropbox]', message) });
  const inScope = (e: DropboxEntry) => !root || (e.path_lower ?? '').startsWith(`${root.toLowerCase()}/`) || e.path_lower === root.toLowerCase();

  return {
    kind: 'dropbox',
    label: 'Dropbox',
    sourceSlug: source.slug,
    root: root || '/',

    async search(query, limit) {
      const res = orThrow(await dropboxApi<{ matches?: Array<{ metadata?: { metadata?: DropboxEntry } }> }>(token, '/files/search_v2', { query: query.trim() || '*', options: { ...(root ? { path: root } : {}), max_results: Math.min(limit, 100) } }));
      return (res.matches ?? []).map(m => m.metadata?.metadata).filter((e): e is DropboxEntry => Boolean(e)).filter(inScope).slice(0, limit).map(row);
    },

    async list(folder) {
      const path = folder ? normalizeDropboxPath(folder) : root;
      if (root && !(path.toLowerCase() === root.toLowerCase() || path.toLowerCase().startsWith(`${root.toLowerCase()}/`))) {
        throw new Error(`${path} is outside ${root}, the folder the ${source.slug} source reads.`);
      }
      const res = orThrow(await dropboxApi<{ entries?: DropboxEntry[] }>(token, '/files/list_folder', { path, limit: 200 }));
      return (res.entries ?? []).filter(e => e['.tag'] !== 'deleted').map(row);
    },

    async read(idOrPath) {
      const target = idOrPath.trim().startsWith('id:') ? idOrPath.trim() : normalizeDropboxPath(idOrPath);
      const meta = orThrow(await dropboxApi<DropboxEntry>(token, '/files/get_metadata', { path: target }));
      if (!inScope(meta)) {
        throw new Error(`${meta.path_display ?? idOrPath} is outside ${root}, the folder the ${source.slug} source reads.`);
      }
      const base = row(meta);
      if (meta['.tag'] !== 'file') {
        return { ...base, text: null, note: 'A folder: list it with files_list.' };
      }
      if (!dropboxReadsAsText(meta, cfg.extensions)) {
        return { ...base, text: null, note: `A ${meta.name.includes('.') ? meta.name.slice(meta.name.lastIndexOf('.')) : 'binary'} file is not read as text (or it is over 10 MB); say what it is, and link it.` };
      }
      const bytes = orThrow(await dropboxDownload(token, { path: meta.id ?? target, name: meta.name }));
      const text = await fileText(meta.name.toLowerCase().endsWith('.paper') ? `${meta.name}.md` : meta.name, bytes);
      const out: FileContent = { ...base, text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n\n[Cut at ${TEXT_MAX} of ${text.length} characters.]` : text, note: text ? null : 'The file has no text to read (a scanned PDF?).' };
      return out;
    },
  };
}
