/**
 * Which workspace directory a project reads and writes on this host.
 *
 * Multi-workspace installs map project slugs to folders through
 * `VOCION_WORKSPACE_MAP` ("<projectSlug>:<path>,<projectSlug>:<path>");
 * single-workspace installs fall back to `WORKSPACE_PATH`. Null when the
 * project has no workspace folder on this box, or when neither is set.
 *
 * Two questions, kept apart on purpose:
 *   - {@link workspaceFolderForProject} — which folder is MOUNTED for this
 *     project. Under the shared `WORKSPACE_PATH` that is some project's
 *     folder, not necessarily this one's; the drift banner and the plugin
 *     switch ask it so they can say whose it is.
 *   - {@link ownWorkspaceFolder} / {@link workspacePathForProject} — the
 *     folder this project may read and write as ITS workspace. Never another
 *     project's: one host serves several companies, and a folder read or
 *     written (and then applied) for the wrong project is a cross-tenant
 *     leak, not a stale view.
 *
 * Lives in `libs/workspace` rather than the router so a service can ask
 * without importing the request layer.
 */

import type { MountVerdict } from './mounted-project';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { projectSchema } from '@/models/Schema';
import { getCurrentWorkspaceVersion } from './current-version';
import { judgeMountedFolder, readManifestOrgId } from './mounted-project';
import { getWorkspacePath } from './reader';

/**
 * The folder mounted for a project, saying how it was found: `explicit` when
 * the map named it for this project (then it is this project's by
 * declaration), false when it is the one shared `WORKSPACE_PATH` — which is
 * some project's, not necessarily this one's; {@link mountOwnership} settles
 * whose. Use {@link ownWorkspaceFolder} to read or write a project's files.
 * @param projectId - The project asking.
 */
export async function workspaceFolderForProject(projectId: string): Promise<{ path: string; explicit: boolean } | null> {
  const [proj] = await db
    .select({ slug: projectSchema.slug })
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  const map = process.env.VOCION_WORKSPACE_MAP ?? '';
  if (proj && map) {
    for (const pair of map.split(',')) {
      const idx = pair.indexOf(':');
      if (idx > 0 && pair.slice(0, idx).trim() === proj.slug) {
        return { path: pair.slice(idx + 1).trim(), explicit: true };
      }
    }
    // Map configured but this project isn't in it — no workspace here.
    return null;
  }
  const path = getWorkspacePath();
  return path ? { path, explicit: false } : null;
}

/**
 * The DB half of {@link judgeMountedFolder}: read the project's last applied
 * version and the folder's manifest, then judge. One indexed read (cached
 * 60s with the sha the skill runs already read); none at all for a folder
 * the map named for the project.
 * @param projectId - The project asking.
 * @param folder - The folder in question.
 * @param folder.path - Absolute or repo-relative.
 * @param folder.explicit - `VOCION_WORKSPACE_MAP` named it for this project.
 */
export async function mountOwnership(projectId: string, folder: { path: string; explicit?: boolean }): Promise<MountVerdict> {
  if (folder.explicit) {
    return { own: true };
  }
  const abs = fromRepoRoot(folder.path);
  return judgeMountedFolder({
    projectId,
    folder: { path: abs, manifestOrgId: readManifestOrgId(abs), explicit: false },
    applied: await getCurrentWorkspaceVersion(projectId),
  });
}

/** A project's own workspace folder on this host, or why it has none. */
export type OwnWorkspaceFolder
  = | { own: true; path: string; explicit: boolean }
    | { own: false; path: string | null; reason: string };

/**
 * The folder this project reads and writes as its workspace — only when the
 * folder is this project's own ({@link mountOwnership}). When the mounted
 * folder is another project's, `own` is false and `reason` says so in a
 * sentence a person can act on; `path` is kept for logs, never for a read.
 * @param projectId - The project asking.
 */
export async function ownWorkspaceFolder(projectId: string): Promise<OwnWorkspaceFolder> {
  const folder = await workspaceFolderForProject(projectId);
  if (!folder) {
    return { own: false, path: null, reason: 'this project has no workspace folder on this host' };
  }
  const verdict = await mountOwnership(projectId, folder);
  if (!verdict.own) {
    return { own: false, path: folder.path, reason: `the workspace folder on this host is not this project's — ${verdict.reason}` };
  }
  return { own: true, path: folder.path, explicit: folder.explicit };
}

/**
 * The project's own workspace path (absolute or repo-root-relative), or null
 * — null too when the folder mounted here is another project's.
 * @param projectId - The project asking.
 */
export async function workspacePathForProject(projectId: string): Promise<string | null> {
  const folder = await ownWorkspaceFolder(projectId);
  return folder.own ? folder.path : null;
}
