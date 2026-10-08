/**
 * BOX — a files provider (`../provider.ts`), on the client and credential
 * the `box` source syncs with (`libs/sources/box.ts`).
 *
 * Search is Box's `/search`, bounded to the source's folder
 * (`ancestor_folder_ids`) unless the source reads everything (folder 0); a
 * file read by id is refused when the folder is not among its ancestors.
 */

import type { FileContent, FileRow, FilesProvider } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { BoxItem } from '@/libs/sources/box';
import { orThrow } from '@/libs/connectors/vendorRequest';
import { BOX_ITEM_FIELDS, boxApi, boxConfigSchema, boxDownload, boxFolderItems, boxWebUrl, resolveBoxToken } from '@/libs/sources/box';
import { fileText, readsAsText } from '@/libs/sources/fileText';

const TEXT_MAX = 60_000;

function pathOf(item: BoxItem): string {
  const parents = (item.path_collection?.entries ?? []).filter(e => e.id !== '0').map(e => e.name);
  return `/${[...parents, item.name].join('/')}`;
}

function row(item: BoxItem): FileRow {
  return { id: item.id, name: item.name, path: pathOf(item), folder: item.type === 'folder', url: boxWebUrl(item), size: item.size ?? null, modified: item.modified_at ?? null };
}

/**
 * The provider for one Box source.
 * @param orgId - The workspace.
 * @param source - The `box` source row.
 * @param credentials - Its decrypted credential.
 */
export async function boxFilesProvider(orgId: string, source: FamilySource, credentials: Record<string, unknown> | undefined): Promise<FilesProvider> {
  const cfg = boxConfigSchema.parse(source.config);
  const token = await resolveBoxToken(credentials, { kind: 'persist', orgId, sourceId: source.id, warn: message => console.warn('[files/box]', message) });
  const inScope = (item: BoxItem) => cfg.folderId === '0' || item.id === cfg.folderId || (item.path_collection?.entries ?? []).some(e => e.id === cfg.folderId);
  const fields = `${BOX_ITEM_FIELDS},path_collection`;

  return {
    kind: 'box',
    label: 'Box',
    sourceSlug: source.slug,
    root: cfg.folderId === '0' ? 'All files' : `folder ${cfg.folderId}`,

    async search(query, limit) {
      const scope = cfg.folderId === '0' ? '' : `&ancestor_folder_ids=${cfg.folderId}`;
      const res = orThrow(await boxApi<{ entries?: BoxItem[] }>(token, `/search?query=${encodeURIComponent(query.trim() || '*')}&limit=${Math.min(limit, 100)}&fields=${fields}${scope}`));
      return (res.entries ?? []).filter(inScope).slice(0, limit).map(row);
    },

    async list(folder) {
      const id = folder?.trim() || cfg.folderId;
      if (!/^\d+$/.test(id)) {
        throw new Error(`${folder} is not a Box folder id (the number at the end of its URL).`);
      }
      if (id !== cfg.folderId) {
        const meta = orThrow(await boxApi<BoxItem>(token, `/folders/${id}?fields=${fields}`));
        if (!inScope(meta)) {
          throw new Error(`Folder ${id} is outside the folder the ${source.slug} source reads.`);
        }
      }
      return (await boxFolderItems(token, id)).filter(i => i.type === 'file' || i.type === 'folder').map(i => ({ ...row(i), path: i.name }));
    },

    async read(id) {
      const clean = id.trim();
      if (!/^\d+$/.test(clean)) {
        throw new Error(`${id} is not a Box file id; find it with files_search or files_list.`);
      }
      const meta = orThrow(await boxApi<BoxItem>(token, `/files/${clean}?fields=${fields}`));
      if (!inScope(meta)) {
        throw new Error(`${meta.name} is outside the folder the ${source.slug} source reads.`);
      }
      const base = row({ ...meta, type: 'file' });
      if (!readsAsText(meta.name, meta.size, cfg.extensions)) {
        return { ...base, text: null, note: `A ${meta.name.includes('.') ? meta.name.slice(meta.name.lastIndexOf('.')) : 'binary'} file is not read as text (or it is over 10 MB); say what it is, and link it.` };
      }
      const text = await fileText(meta.name, orThrow(await boxDownload(token, clean)));
      const out: FileContent = { ...base, text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n\n[Cut at ${TEXT_MAX} of ${text.length} characters.]` : text, note: text ? null : 'The file has no text to read (a scanned PDF?).' };
      return out;
    },
  };
}
