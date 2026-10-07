import type { AppSummary, AppWorkspace } from '@/features/navigation/apps';
import { inArray } from 'drizzle-orm';
import { workspacesByApp } from '@/features/navigation/apps';
import { db } from '@/libs/DB';
import { safeListApps } from '@/libs/workspace/apps';
import { projectSchema } from '@/models/Schema';
import { listProjectsForUser } from './ProjectService';

/**
 * The rail's data for one person: the apps they have in at least one
 * workspace they can open (the core app always), and, per app, the
 * workspaces that have it — what each app's workspace picker lists.
 *
 * "Can open" is `listProjectsForUser`, the same list the workspace switcher
 * shows, so the pickers never offer a workspace the switcher would not. What
 * is installed where is read from each project's `enabled_plugins` and
 * `enabled_surfaces` — an app has no row of its own.
 * @param userId - Auth.js user id.
 */
export async function appsForUser(userId: string): Promise<{ apps: AppSummary[]; workspacesByApp: Record<string, AppWorkspace[]> }> {
  const projects = await listProjectsForUser(userId);
  const ids = projects.map(p => p.id);
  const rows = ids.length > 0
    ? await db
        .select({ id: projectSchema.id, enabledPlugins: projectSchema.enabledPlugins, enabledSurfaces: projectSchema.enabledSurfaces })
        .from(projectSchema)
        .where(inArray(projectSchema.id, ids))
    : [];
  const installed = new Map(rows.map(r => [r.id, r]));
  return workspacesByApp(
    projects.map(p => ({
      projectId: p.id,
      slug: p.slug,
      name: p.name,
      enabledPlugins: installed.get(p.id)?.enabledPlugins ?? [],
      enabledSurfaces: installed.get(p.id)?.enabledSurfaces ?? [],
    })),
    safeListApps(),
  );
}
