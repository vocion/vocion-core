/**
 * What may be a file in a workspace that travels as a zip — one rule for the
 * browser that zips a folder, the server that reads the zip, and the staging
 * folder it is written into, so none of the three accepts what another
 * refuses. No Node imports: the import dialog bundles this.
 */

/** The longest path a file may have inside a workspace folder. */
export const MAX_WORKSPACE_PATH = 512;

/** The largest upload an import takes, compressed. */
export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

/**
 * Whether an entry is one no workspace is made of, so it is left out rather
 * than refused: a dotted name anywhere in its path (`.git/`, `.DS_Store`, as
 * the loader skips them), the `__MACOSX/` folder macOS adds to a zip, and
 * `node_modules/`.
 * @param path - The entry's path, `/`-separated.
 */
export function skippedEntry(path: string): boolean {
  return path.split('/').some(s => s === '__MACOSX' || s === 'node_modules' || (s.startsWith('.') && s !== '.' && s !== '..'));
}

/**
 * Why a path cannot name a file inside a workspace folder, or null when it
 * can: relative, `/`-separated, no empty, `.` or `..` segment, no backslash,
 * NUL or drive letter, and no longer than {@link MAX_WORKSPACE_PATH}. A dotted
 * name is refused too — the loader and the store both skip them, so one could
 * only ever be a stowaway.
 * @param path - The path inside the workspace.
 */
export function workspacePathProblem(path: string): string | null {
  if (path.length === 0 || path.length > MAX_WORKSPACE_PATH) {
    return `is empty or longer than ${MAX_WORKSPACE_PATH} characters`;
  }
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[a-z]:/i.test(path)) {
    return 'is not a relative path with / between folders';
  }
  if (path.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    return 'climbs out of the workspace';
  }
  if (path.split('/').some(segment => segment.startsWith('.'))) {
    return 'names a hidden file';
  }
  return null;
}
