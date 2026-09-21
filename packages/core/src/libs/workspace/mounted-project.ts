import type { AppliedWorkspaceVersion } from '@/libs/workspace/current-version';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Whose folder is mounted on this host?
 *
 * A deployment hosts several projects on ONE mounted `WORKSPACE_PATH`, and
 * that folder is one project's workspace — the others were applied from
 * their own repos. Every surface that treats the mounted folder as "this
 * project's workspace" has to ask first: the drift banner (comparing the
 * folder's sha against another project's applied sha reads as permanent
 * drift), its Apply button (which would overwrite that project's agents,
 * skills and missions with the folder's), and the sidebar (which would list
 * the folder's pages beside a project that never authored them).
 *
 * The question is answered from what the applier recorded, never guessed:
 *   1. the folder was named for this project (`VOCION_WORKSPACE_MAP`) — its;
 *   2. the project's last applied version records a project — that project's;
 *   3. it records the folder it came from — the same folder, or not;
 *   4. neither is recorded — the folder's `workspace.yaml` `orgId` has to be
 *      this project; a placeholder orgId is not a match, and "not a match"
 *      is the answer, not a guess.
 */

export type MountedFolder = {
  /** The folder, absolute or repo-relative. */
  path: string;
  /** `orgId` from its workspace.yaml, or null when unreadable. */
  manifestOrgId: string | null;
  /** `VOCION_WORKSPACE_MAP` named this folder for the project. */
  explicit?: boolean;
};

export type MountVerdict = { own: true } | { own: false; reason: string };

/**
 * Decide whether the mounted folder is `projectId`'s workspace.
 * @param input - The folder, the project asking, and that project's last applied version.
 * @param input.projectId
 * @param input.folder
 * @param input.applied
 */
export function judgeMountedFolder(input: { projectId: string; folder: MountedFolder; applied: AppliedWorkspaceVersion | null }): MountVerdict {
  const { projectId, folder, applied } = input;
  if (folder.explicit) {
    return { own: true };
  }
  if (applied?.projectId && applied.projectId !== projectId) {
    return { own: false, reason: `this project's last apply was recorded for project ${applied.projectId}` };
  }
  if (applied?.sourcePath) {
    return samePath(applied.sourcePath, folder.path)
      ? { own: true }
      : { own: false, reason: `this project's workspace was last applied from ${applied.sourcePath}, not from the folder mounted here (${folder.path})` };
  }
  if (folder.manifestOrgId && folder.manifestOrgId === projectId) {
    return { own: true };
  }
  return {
    own: false,
    reason: applied
      ? `this project's last apply recorded no source folder, and the mounted workspace.yaml names ${folder.manifestOrgId ?? 'no orgId'}, not this project`
      : `nothing has been applied to this project yet, and the mounted workspace.yaml names ${folder.manifestOrgId ?? 'no orgId'}, not this project`,
  };
}

/**
 * `orgId` from a folder's workspace.yaml — null when the file is missing or
 * unparseable, so a broken manifest never decides ownership by accident.
 * @param dir - Absolute workspace directory.
 */
export function readManifestOrgId(dir: string): string | null {
  for (const name of ['workspace.yaml', 'workspace.yml']) {
    const file = join(dir, name);
    if (!existsSync(file)) {
      continue;
    }
    try {
      const raw = parseYaml(readFileSync(file, 'utf8')) as { orgId?: unknown } | null;
      return typeof raw?.orgId === 'string' && raw.orgId !== '' ? raw.orgId : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Two spellings of one folder: resolved, symlinks followed where the path
 * exists (a deploy mounts a checkout through a link), trailing slash ignored.
 * @param a
 * @param b
 */
function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

function canonical(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs).replace(/\/+$/, '');
  } catch {
    return abs.replace(/\/+$/, '');
  }
}

/**
 * When the folder last changed, for telling a deploy in flight from drift.
 * A deploy applies the new commit to the database first and the mount
 * catches up after, so for a moment the applied sha is NEWER than the
 * folder's — that is not drift, and the banner must not offer to apply the
 * old files back. The folder's time is its HEAD commit time when it is a
 * clean git checkout, else workspace.yaml's mtime; null for a dirty tree
 * (uncommitted edits cannot be dated, and they ARE drift).
 * @param dir - Absolute workspace directory.
 * @param sha - The folder's computed sha (`computeWorkspaceSha`).
 */
export function folderChangedAt(dir: string, sha: string): Date | null {
  if (sha.includes('-dirty-')) {
    return null;
  }
  try {
    const seconds = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(seconds * 1000);
    }
  } catch { /* not a git checkout — fall through to the file's own time */ }
  for (const name of ['workspace.yaml', 'workspace.yml']) {
    try {
      return statSync(join(dir, name)).mtime;
    } catch { /* try the other spelling */ }
  }
  return null;
}

/**
 * Whether the person could write the folder here. A deploy-managed box mounts
 * a read-only checkout (EROFS, agents.metacto.com 2026-09-18); a missing
 * manifest is "nothing to write", not "read-only".
 * @param dir - Absolute workspace directory.
 */
export function folderWritable(dir: string): boolean {
  try {
    accessSync(join(dir, 'workspace.yaml'), constants.W_OK);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/**
 * A project whose workspace git applies: the folder on this host is
 * read-only, or its last apply was signed by a pipeline. Such a project is
 * never offered Apply from the dashboard — the next deploy is the apply.
 * @param input
 * @param input.writable - {@link folderWritable}.
 * @param input.appliedBy - The last applied version's signer.
 */
export function isDeployManaged(input: { writable: boolean; appliedBy: string | null }): boolean {
  return !input.writable || /^(?:deploy|ci|pipeline|github-actions|gitlab-ci)\b/i.test(input.appliedBy ?? '');
}

/**
 * Whether an apply is still landing: the applied version is newer than the
 * folder it should match. See {@link folderChangedAt}.
 * @param appliedAt - When the project's current version was applied.
 * @param changedAt - When the folder last changed; null when unknown (then: not in flight).
 */
export function applyNewerThanFolder(appliedAt: Date, changedAt: Date | null): boolean {
  return changedAt !== null && appliedAt.getTime() > changedAt.getTime();
}
