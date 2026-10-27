/**
 * THE FILES FAMILY — file storage, named for its constructs.
 *
 * Folders and files, whoever stores them: Dropbox and Box first; OneDrive or
 * Google Drive would answer behind the same interface. An agent's tools are
 * `files_search`, `files_list` and `files_read`; every read stays inside the
 * folder the source is configured for, so the scope a person chose on the
 * Connectors page is the scope an agent reads. Reads only.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { FAMILY_LABEL, familySourcesForOrg } from '@/libs/connectors/families';
import { credentialsForSource, pickFamilySource } from '@/services/connectors/sourceCredentials';

export type FileRow = { id: string; name: string; path: string; folder: boolean; url: string; size: number | null; modified: string | null };

export type FileContent = FileRow & {
  /** The file as text, when it is a kind that reads as text; null otherwise, with `note` saying why. */
  text: string | null;
  note: string | null;
};

export type FilesProvider = {
  kind: string;
  label: string;
  sourceSlug: string;
  /** The folder reads are bounded to, as a person would name it. */
  root: string;
  search: (query: string, limit: number) => Promise<FileRow[]>;
  /** A folder's direct contents; the source's folder when none is named. */
  list: (folder?: string | null) => Promise<FileRow[]>;
  /** One file, by the id `search` or `list` returned (or a path, on Dropbox). */
  read: (idOrPath: string) => Promise<FileContent>;
};

/**
 * The provider for the workspace's file storage: the named source, else its
 * one files source.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source slug, when the workspace has more than one.
 * @param opts.slugs - Only these sources: an agent's own.
 */
export async function filesProviderFor(orgId: string, opts: { sourceSlug?: string | null; slugs?: readonly string[] } = {}): Promise<FilesProvider> {
  const source = pickFamilySource(await familySourcesForOrg(orgId, 'files', opts.slugs), FAMILY_LABEL.files, opts.sourceSlug);
  return providerFor(orgId, source);
}

async function providerFor(orgId: string, source: FamilySource): Promise<FilesProvider> {
  const credentials = await credentialsForSource(orgId, source);
  switch (source.kind) {
    case 'dropbox': {
      const { dropboxFilesProvider } = await import('./providers/dropbox');
      return dropboxFilesProvider(orgId, source, credentials);
    }
    case 'box': {
      const { boxFilesProvider } = await import('./providers/box');
      return boxFilesProvider(orgId, source, credentials);
    }
    default:
      throw new Error(`${source.slug} is a ${source.kind} source, which no file-storage provider serves yet.`);
  }
}
