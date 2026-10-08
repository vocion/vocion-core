/**
 * A workspace's files, written out as a folder for the length of one read.
 *
 * The loader reads a folder, and the applier stores what it finds there, so a
 * workspace that lives in the database — a project's stored files, an export
 * being checked, an uploaded import — is written into a folder of its own,
 * loaded, applied if it is to be, and the folder is removed however that ends.
 * Nothing here decides what the files are; it only refuses a path that could
 * leave the folder.
 */

import type { LoadedWorkspace } from '@/libs/workspace';
import type { ExportFile } from '@/libs/workspace/export';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** The longest path inside a workspace a staged file may have. */
const MAX_PATH = 512;

/**
 * Why a path cannot name a file inside a workspace folder, or null when it
 * can: relative, `/`-separated, no empty, `.` or `..` segment, no backslash or
 * NUL. A dotted name is refused too — the loader and the store both skip them,
 * so one could only ever be a stowaway.
 * @param path - The path inside the workspace.
 */
export function workspacePathProblem(path: string): string | null {
  if (path.length === 0 || path.length > MAX_PATH) {
    return 'is empty or too long';
  }
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    return 'is not a relative path with / between folders';
  }
  if (path.split('/').some(segment => segment.length === 0 || segment.startsWith('.'))) {
    return 'climbs out of the workspace or names a hidden file';
  }
  return null;
}

/**
 * Write `files` into a new temporary folder, run `run` on it, and remove the
 * folder however that ends. A file whose path could leave the folder is never
 * written ({@link workspacePathProblem}); callers check paths before this, so
 * meeting one here is a bug and throws.
 * @param files - The workspace's files.
 * @param run - What to do with the folder (absolute path).
 */
export async function withStagedWorkspace<T>(files: readonly ExportFile[], run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'vocion-workspace-'));
  try {
    for (const file of files) {
      const problem = workspacePathProblem(file.path);
      if (problem) {
        throw new Error(`refusing to stage "${file.path}": it ${problem}`);
      }
      const abs = join(dir, ...file.path.split('/'));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content);
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Where the stored workspace's connectors say they were declared, when no folder on this host holds them. */
export const STORED_MANIFEST_DIR = 'database';

/**
 * Give each connector what its stored row already says about where it was
 * declared (`_manifestDir`) and what it is called (`_name`), instead of the
 * staging folder it was just loaded from — a folder that is deleted once the
 * read is over and differs on every read, so every connector would otherwise
 * read as changed and point its relative paths at nothing.
 *
 * A connector with no row yet is new: with `fallbackDir` (an import), it is
 * declared there and takes its file's name; without (a read), it is left
 * as loaded.
 * @param loaded - The workspace loaded from a staging folder.
 * @param rows - The project's connector rows.
 * @param fallbackDir - Where a new connector says it was declared, for an import.
 */
export function pinSourceRows(loaded: LoadedWorkspace, rows: ReadonlyArray<{ slug: string; configJson: Record<string, unknown> | null }>, fallbackDir?: string): void {
  const stored = new Map(rows.map(r => [r.slug, r.configJson ?? {}]));
  for (const source of loaded.sources) {
    const config = stored.get(source.slug);
    if (config) {
      // Nothing on the row means nothing is stamped (`withManifestDir`).
      source.manifestDir = (typeof config._manifestDir === 'string' ? config._manifestDir : undefined) as string;
      source.storedName = typeof config._name === 'string' ? config._name : undefined;
    } else if (fallbackDir !== undefined) {
      source.manifestDir = fallbackDir;
      source.storedName = source.name !== source.slug ? source.name : undefined;
    }
  }
}
