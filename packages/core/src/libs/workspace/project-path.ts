/**
 * Which workspace directory a project reads and writes on this host.
 *
 * Multi-workspace installs map project slugs to folders through
 * `VOCION_WORKSPACE_MAP` ("<projectSlug>:<path>,<projectSlug>:<path>");
 * single-workspace installs fall back to `WORKSPACE_PATH`. Null when the
 * project has no workspace folder on this box, or when neither is set.
 *
 * Lives in `libs/workspace` rather than the router so a service can ask
 * without importing the request layer.
 */

import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { getWorkspacePath } from './reader';

/**
 * The workspace path (absolute or repo-root-relative) for a project, or null.
 * @param projectId
 */
export async function workspacePathForProject(projectId: string): Promise<string | null> {
  return (await workspaceFolderForProject(projectId))?.path ?? null;
}

/**
 * The same folder, saying how it was found: `explicit` when the map named it
 * for this project (then it is this project's by declaration), false when it
 * is the one shared `WORKSPACE_PATH` — which is some project's, not
 * necessarily this one's; `judgeMountedFolder` settles whose.
 * @param projectId
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
