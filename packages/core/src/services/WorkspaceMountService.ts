import type { MountVerdict } from '@/libs/workspace/mounted-project';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { getCurrentWorkspaceVersion } from '@/libs/workspace/current-version';
import { judgeMountedFolder, readManifestOrgId } from '@/libs/workspace/mounted-project';
import { workspaceFolderForProject } from '@/libs/workspace/project-path';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { projectSchema, workspaceVersionSchema } from '@/models/Schema';

/**
 * The DB half of {@link judgeMountedFolder}: read the project's last applied
 * version and the folder's manifest, then judge. One indexed read (cached
 * 60s with the sha the skill runs already read).
 * @param orgId - The project asking.
 * @param folder - The folder in question, absolute or repo-relative; `explicit` when `VOCION_WORKSPACE_MAP` named it for this project.
 * @param folder.path
 * @param folder.explicit
 */
export async function mountOwnership(orgId: string, folder: { path: string; explicit?: boolean }): Promise<MountVerdict> {
  const abs = fromRepoRoot(folder.path);
  return judgeMountedFolder({
    projectId: orgId,
    folder: { path: abs, manifestOrgId: readManifestOrgId(abs), explicit: folder.explicit },
    applied: await getCurrentWorkspaceVersion(orgId),
  });
}

/**
 * Whether the folder on `WORKSPACE_PATH` is this project's — what the shell
 * and the page reader pass as `mounted` so the folder's own pages (and its
 * plugins') show only to the project that authored them. False when nothing
 * is mounted, or the folder is another project's.
 * @param orgId - The project asking.
 */
export async function mountedWorkspaceIsProjects(orgId: string): Promise<boolean> {
  const path = getWorkspacePath();
  if (!path || !existsSync(fromRepoRoot(path))) {
    return false;
  }
  return (await mountOwnership(orgId, { path })).own;
}

/**
 * Which project a folder belongs to, named for a person: the project it was
 * last applied to (by the recorded source folder), else the project its
 * workspace.yaml names, else null. Read so the banner can say "this is
 * metacto-revenue's workspace" instead of "not yours".
 * @param path - The folder, absolute or repo-relative.
 * @param manifestOrgId - `orgId` from its workspace.yaml, if readable.
 */
export async function folderOwner(path: string, manifestOrgId: string | null): Promise<{ id: string; slug: string; name: string } | null> {
  const abs = fromRepoRoot(path);
  const spellings = [abs, resolve(abs)];
  try {
    spellings.push(realpathSync.native(abs));
  } catch { /* the folder may be gone; the recorded spelling still counts */ }
  const [applied] = await db
    .select({ orgId: workspaceVersionSchema.orgId })
    .from(workspaceVersionSchema)
    .where(and(eq(workspaceVersionSchema.status, 'applied'), inArray(workspaceVersionSchema.sourcePath, [...new Set(spellings)])))
    .orderBy(desc(workspaceVersionSchema.appliedAt))
    .limit(1);
  const id = applied?.orgId ?? manifestOrgId;
  if (!id) {
    return null;
  }
  const [project] = await db
    .select({ id: projectSchema.id, slug: projectSchema.slug, name: projectSchema.name })
    .from(projectSchema)
    .where(eq(projectSchema.id, id))
    .limit(1);
  return project ?? null;
}

/**
 * The folder whose pages this project reads, when it is not the mounted one.
 *
 * A shared host mounts every workspace side by side (`/workspace/<slug>`) and
 * names one on `WORKSPACE_PATH`. The other projects used to get only their
 * plugins' pages, so a second project could not override a plugin page by
 * slug — Squatch Factory's Work page opening on Stamp Send (2026-09-25) was
 * written, deployed and never read. The folder is found the way ownership is
 * already judged: named for the project in `VOCION_WORKSPACE_MAP`, else the
 * sibling named for the project's slug, and only when the applier's record
 * (or its workspace.yaml) says it is this project's. Null otherwise, which
 * leaves the caller's `mounted` rule in charge.
 * @param orgId - The project asking.
 */
export async function projectPagesFolder(orgId: string): Promise<string | null> {
  const mapped = await workspaceFolderForProject(orgId).catch(() => null);
  if (mapped?.explicit) {
    return fromRepoRoot(mapped.path);
  }
  const mountedPath = getWorkspacePath();
  if (!mountedPath) {
    return null;
  }
  const [project] = await db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (!project?.slug) {
    return null;
  }
  const sibling = join(dirname(fromRepoRoot(mountedPath)), project.slug);
  if (resolve(sibling) === resolve(fromRepoRoot(mountedPath)) || !existsSync(join(sibling, 'workspace.yaml'))) {
    return null;
  }
  return (await mountOwnership(orgId, { path: sibling })).own ? sibling : null;
}
