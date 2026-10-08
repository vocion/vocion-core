/**
 * A workspace as one file: the zip an admin downloads from Settings, and the
 * zip they upload to import one (a folder is zipped in the browser first).
 *
 * Reading an upload is reading something a stranger may have made, so every
 * limit is checked against what the archive declares BEFORE anything is
 * inflated, and against what came out after: a size, a file count, a size per
 * file (the same ceiling the store keeps), and paths that stay inside the
 * workspace. A zip carries no links, only files, so nothing written from one
 * can point anywhere else.
 */

import type { ExportFile } from './export';
import { Buffer } from 'node:buffer';
import { unzipSync, zipSync } from 'fflate';
import { MAX_ARCHIVE_BYTES, skippedEntry, workspacePathProblem } from './archivePaths';
import { encodingFor, MANIFEST_FILES, MAX_COLLECTED_FILE_BYTES } from './snapshot';

/** The limits an archive is read under. */
export type ArchiveLimits = {
  maxArchiveBytes: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxFiles: number;
};

/** What an import may be: compressed, the whole of it, and per file. */
export const ARCHIVE_LIMITS: Readonly<ArchiveLimits> = {
  /** The upload itself — the same ceiling the import dialog warns at. */
  maxArchiveBytes: MAX_ARCHIVE_BYTES,
  /** Everything in it, inflated. */
  maxTotalBytes: 100 * 1024 * 1024,
  /** Any one file, inflated — what the store keeps, and no more. */
  maxFileBytes: MAX_COLLECTED_FILE_BYTES,
  /** How many files. */
  maxFiles: 5000,
};

export class WorkspaceArchiveError extends Error {
  constructor(public readonly code: 'TOO_LARGE' | 'NOT_A_ZIP' | 'NO_MANIFEST' | 'BAD_PATH', message: string) {
    super(message);
    this.name = 'WorkspaceArchiveError';
  }
}

/**
 * A workspace's files as a zip, everything under one folder (`root/`) so
 * unzipping it makes one folder rather than scattering files.
 * @param files - The files.
 * @param root - The folder name inside the zip.
 */
export function zipWorkspace(files: readonly ExportFile[], root: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[`${root}/${file.path}`] = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
  }
  return zipSync(entries, { level: 6 });
}

/**
 * The workspace inside an uploaded zip: its files, by their path inside the
 * workspace folder, as text or base64 by their bytes (`encodingFor`).
 *
 * The workspace is the shallowest folder holding a `workspace.yaml`, so a zip
 * of the folder and a zip of its contents both work; files outside it are
 * not part of it and are dropped. Dotted names (`.git/`, `.DS_Store`), the
 * `__MACOSX/` folder macOS adds and `node_modules/` are skipped
 * ({@link skippedEntry}, the rule the browser zips a folder by).
 * @param bytes - The upload.
 * @param limits - The limits; {@link ARCHIVE_LIMITS} unless a test says otherwise.
 */
export function readWorkspaceArchive(bytes: Uint8Array, limits: Readonly<ArchiveLimits> = ARCHIVE_LIMITS): ExportFile[] {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new WorkspaceArchiveError('TOO_LARGE', `The upload is ${mb(bytes.byteLength)}; a workspace import may be up to ${mb(limits.maxArchiveBytes)}.`);
  }
  let declared = 0;
  let count = 0;
  let tooLarge: string | null = null;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/') || skippedEntry(file.name)) {
          return false;
        }
        count += 1;
        declared += file.originalSize;
        if (file.originalSize > limits.maxFileBytes) {
          tooLarge ??= `${file.name} is ${mb(file.originalSize)}; one file may be up to ${mb(limits.maxFileBytes)}.`;
        }
        // Refuse before inflating anything: the sizes are what the archive
        // declares, and an archive that lies about them gets no further than
        // its declared size (the output buffer is that size).
        return tooLarge === null && count <= limits.maxFiles && declared <= limits.maxTotalBytes;
      },
    });
  } catch (error) {
    throw new WorkspaceArchiveError('NOT_A_ZIP', `The upload could not be read as a zip: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (tooLarge) {
    throw new WorkspaceArchiveError('TOO_LARGE', tooLarge);
  }
  if (count > limits.maxFiles) {
    throw new WorkspaceArchiveError('TOO_LARGE', `The upload holds ${count.toLocaleString('en-US')} files; a workspace import may hold up to ${limits.maxFiles.toLocaleString('en-US')}.`);
  }
  if (declared > limits.maxTotalBytes) {
    throw new WorkspaceArchiveError('TOO_LARGE', `The upload unpacks to ${mb(declared)}; a workspace import may unpack to up to ${mb(limits.maxTotalBytes)}.`);
  }

  const paths = Object.keys(entries);
  for (const path of paths) {
    // The rule staging holds every file to, applied to the whole entry path:
    // the workspace's own path is a suffix of it, so an entry passing here is
    // never one staging refuses.
    const problem = workspacePathProblem(path);
    if (problem) {
      throw new WorkspaceArchiveError('BAD_PATH', `The upload holds "${path}", which ${problem}.`);
    }
    if (entries[path]!.byteLength > limits.maxFileBytes) {
      throw new WorkspaceArchiveError('TOO_LARGE', `${path} is ${mb(entries[path]!.byteLength)}; one file may be up to ${mb(limits.maxFileBytes)}.`);
    }
  }
  const root = workspaceRoot(paths);
  const files: ExportFile[] = [];
  for (const path of paths) {
    if (!path.startsWith(root)) {
      continue;
    }
    const data = Buffer.from(entries[path]!);
    const encoding = encodingFor(data);
    files.push({ path: path.slice(root.length), content: encoding === 'base64' ? data.toString('base64') : data.toString('utf8'), encoding });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The folder prefix the workspace sits under in the zip (`''` at the top, or
 * `acme/`): the shallowest folder holding a manifest. Two at the same depth
 * is two workspaces, and which one was meant cannot be told.
 * @param paths - Every file's path in the zip.
 */
function workspaceRoot(paths: readonly string[]): string {
  const manifests = paths.filter(p => (MANIFEST_FILES as readonly string[]).includes(p.slice(p.lastIndexOf('/') + 1)));
  if (manifests.length === 0) {
    throw new WorkspaceArchiveError('NO_MANIFEST', 'The upload has no workspace.yaml, so it is not a workspace. Export one from Settings, or zip a workspace folder.');
  }
  const depth = (p: string) => p.split('/').length;
  const shallowest = Math.min(...manifests.map(depth));
  const roots = [...new Set(manifests.filter(p => depth(p) === shallowest).map(p => p.slice(0, p.lastIndexOf('/') + 1)))];
  if (roots.length > 1) {
    throw new WorkspaceArchiveError('NO_MANIFEST', `The upload holds more than one workspace (${roots.map(r => r || '/').join(', ')}). Import one at a time.`);
  }
  return roots[0]!;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
