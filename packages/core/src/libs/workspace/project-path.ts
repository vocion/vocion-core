/**
 * Which workspace directory a project reads and writes on this host.
 *
 * Multi-workspace installs map projects to folders through
 * `VOCION_WORKSPACE_MAP` ("<project>:<path>,<project>:<path>"), where
 * `<project>` is the project's id, or `<accountSlug>/<projectSlug>`. A bare
 * `<projectSlug>` is read only while exactly one project on the installation
 * has that slug: slugs are unique within an account, not across them, so on
 * a host serving several companies a bare `sales` would otherwise hand one
 * company's folder to every company's `sales`.
 * Single-workspace installs fall back to `WORKSPACE_PATH`. Null when the
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
import type { AppliedWorkspaceVersion } from '@/libs/workspace/current-version';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { fromRepoRoot } from '@/libs/repo-root';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';
import { folderLastAppliedTo, getCurrentWorkspaceVersion, memoUntilNextApply } from './current-version';
import { judgeMountedFolder, readManifestOrgId } from './mounted-project';
import { getWorkspacePath } from './reader';

/**
 * How long a project's folder verdict is reused. It is asked on every rollup
 * recompute, every brand read and every page load, and it only changes on an
 * apply (which clears it) or a deploy.
 */
const OWNERSHIP_TTL_MS = 15_000;

/** The `VOCION_WORKSPACE_MAP` entries, as written. */
function workspaceMapEntries(): Array<{ key: string; path: string }> {
  const entries: Array<{ key: string; path: string }> = [];
  for (const pair of (process.env.VOCION_WORKSPACE_MAP ?? '').split(',')) {
    const idx = pair.indexOf(':');
    if (idx > 0) {
      entries.push({ key: pair.slice(0, idx).trim(), path: pair.slice(idx + 1).trim() });
    }
  }
  return entries;
}

/**
 * Whether a project slug names exactly one project on this installation —
 * the only case where a bare-slug map entry is unambiguous. Counting
 * accounts would not do: migration 0022 seeds a `default-account` row in
 * every database, so nearly every self-host has two.
 * @param slug - The project slug.
 */
async function slugNamesOneProject(slug: string): Promise<boolean> {
  const rows = await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.slug, slug)).limit(2);
  return rows.length === 1;
}

/**
 * The folder mounted for a project, saying how it was found: `explicit` when
 * the map named it for this project, false when it is the one shared
 * `WORKSPACE_PATH` — which is some project's, not necessarily this one's;
 * {@link mountOwnership} settles whose. Use {@link ownWorkspaceFolder} to
 * read or write a project's files.
 * @param projectId - The project asking.
 */
export async function workspaceFolderForProject(projectId: string): Promise<{ path: string; explicit: boolean } | null> {
  const entries = workspaceMapEntries();
  if (entries.length > 0) {
    const [proj] = await db
      .select({ slug: projectSchema.slug, accountSlug: tenantAccountSchema.slug })
      .from(projectSchema)
      .leftJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
      .where(eq(projectSchema.id, projectId))
      .limit(1);
    if (proj) {
      const named = entries.find(e => e.key === projectId)
        ?? (proj.accountSlug ? entries.find(e => e.key === `${proj.accountSlug}/${proj.slug}`) : undefined);
      if (named) {
        return { path: named.path, explicit: true };
      }
      const bare = entries.find(e => e.key === proj.slug);
      if (bare) {
        if (await slugNamesOneProject(proj.slug)) {
          return { path: bare.path, explicit: true };
        }
        logger.warn('VOCION_WORKSPACE_MAP entry is a bare project slug that several projects on this installation share, so it names none of them; key it by project id or <accountSlug>/<projectSlug>', { key: bare.key, projectId });
      }
      // Map configured but this project isn't in it — no workspace here.
      return null;
    }
  }
  const path = getWorkspacePath();
  return path ? { path, explicit: false } : null;
}

/**
 * The DB half of {@link judgeMountedFolder}: gather what the applier recorded
 * about the project and about the folder, then judge. Not cached — the drift
 * banner's diff and apply read it fresh; everyone else goes through
 * {@link mountOwnership}.
 * @param projectId - The project asking.
 * @param folder - The folder in question, its manifest's orgId, and whether the map named it.
 * @param folder.path - Absolute.
 * @param folder.manifestOrgId - `orgId` from its workspace.yaml.
 * @param folder.explicit - `VOCION_WORKSPACE_MAP` named it for this project.
 * @param applied - The project's last applied version, when the caller already read it.
 */
export async function judgeFolderFor(
  projectId: string,
  folder: { path: string; manifestOrgId: string | null; explicit?: boolean },
  applied?: AppliedWorkspaceVersion | null,
): Promise<MountVerdict> {
  const namesOther = folder.explicit === true && !!folder.manifestOrgId && folder.manifestOrgId !== projectId;
  const [lastAppliedTo, manifestProject, version] = await Promise.all([
    folderLastAppliedTo(folder.path),
    namesOther
      ? db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.id, folder.manifestOrgId!)).limit(1)
      : Promise.resolve([]),
    applied !== undefined ? Promise.resolve(applied) : getCurrentWorkspaceVersion(projectId),
  ]);
  return judgeMountedFolder({
    projectId,
    folder: { ...folder, lastAppliedTo, manifestNamesAProject: manifestProject.length > 0 },
    applied: version,
  });
}

/**
 * Whether a folder is this project's workspace ({@link judgeMountedFolder}),
 * reused for a moment and cleared by the next apply.
 * @param projectId - The project asking.
 * @param folder - The folder in question.
 * @param folder.path - Absolute or repo-relative.
 * @param folder.explicit - `VOCION_WORKSPACE_MAP` named it for this project.
 */
export async function mountOwnership(projectId: string, folder: { path: string; explicit?: boolean }): Promise<MountVerdict> {
  const abs = fromRepoRoot(folder.path);
  return memoUntilNextApply(
    `mount\0${projectId}\0${abs}\0${folder.explicit === true}`,
    OWNERSHIP_TTL_MS,
    () => judgeFolderFor(projectId, { path: abs, manifestOrgId: readManifestOrgId(abs), explicit: folder.explicit }),
  );
}

/** A project's own workspace folder on this host, or why it has none. */
export type OwnWorkspaceFolder
  = | { own: true; path: string; explicit: boolean }
    | { own: false; path: string | null; reason: string };

/**
 * The folder this project reads and writes as its workspace — only when the
 * folder is this project's own ({@link mountOwnership}). When the mounted
 * folder is another project's, `own` is false and `reason` says whose and
 * why, for the log; `path` is kept for logs, never for a read. Neither goes
 * to a person in the project: they get `NO_OWN_WORKSPACE_FOLDER`.
 * @param projectId - The project asking.
 */
export async function ownWorkspaceFolder(projectId: string): Promise<OwnWorkspaceFolder> {
  return memoUntilNextApply(
    `own\0${projectId}\0${process.env.WORKSPACE_PATH ?? ''}\0${process.env.VOCION_WORKSPACE_MAP ?? ''}`,
    OWNERSHIP_TTL_MS,
    async (): Promise<OwnWorkspaceFolder> => {
      const folder = await workspaceFolderForProject(projectId);
      if (!folder) {
        return { own: false, path: null, reason: 'this project has no workspace folder on this host' };
      }
      const verdict = await mountOwnership(projectId, folder);
      if (!verdict.own) {
        return { own: false, path: folder.path, reason: `the workspace folder on this host is not this project's — ${verdict.reason}` };
      }
      return { own: true, path: folder.path, explicit: folder.explicit };
    },
  );
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
