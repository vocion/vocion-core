/**
 * PluginService — which plugins a workspace has on, and turning one on or off.
 *
 * The catalogue itself is filesystem (`libs/workspace/plugins.ts`); this is
 * the DB half. Enablement is authored in `workspace.yaml` (`plugins:`) and
 * mirrored onto `project.enabled_plugins` at apply, so every reader that has
 * an org but no workspace directory — the shell, the agent runtime, the sync
 * collectors — asks here.
 *
 * Turning a plugin on is an EDIT TO THE WORKSPACE FILE followed by an apply,
 * never a bare column write: the workspace stays the source of truth
 * (context as code), the drift banner stays honest, and the change is in git
 * the next time someone commits. The edit preserves the file's comments —
 * a workspace.yaml is documentation as much as config.
 *
 * With one exception, and it is said out loud: a deployment hosts several
 * projects on ONE mounted folder, and that folder is one project's workspace.
 * A toggle from any other project must not edit it — that would rewrite the
 * mounted project's manifest. For such a project the toggle writes
 * `project.enabled_plugins` only and tells the person the project is applied
 * from git, naming the file to change in the workspace repo
 * (`workspace/<slug>/workspace.yaml` `plugins:`). See {@link pluginWriteTarget}.
 */

import type { LoadedPage } from '@/libs/workspace/pages';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { parseDocument, YAMLSeq } from 'yaml';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, invalidateCurrentContextShaCache, loadWorkspace } from '@/libs/workspace';
import { readManifestOrgId } from '@/libs/workspace/mounted-project';
import { readWorkspacePage } from '@/libs/workspace/pages';
import { listPluginSlugs, loadPlugin, resolvePlugins } from '@/libs/workspace/plugins';
import { projectSchema } from '@/models/Schema';
import { invalidateChipCache } from '@/services/chat/synthesis';
import { folderOwner, mountedWorkspaceIsProjects, mountOwnership, projectPagesFolder } from '@/services/WorkspaceMountService';

/**
 * The plugins this org's project has on, in load order. Empty for an org with
 * no project row (never throws — a missing row means "nothing on").
 * @param orgId - Tenant / project id.
 */
export async function enabledPluginsForOrg(orgId: string): Promise<string[]> {
  const [row] = await db
    .select({ enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return row?.enabledPlugins ?? [];
}

/**
 * Whether one plugin is on for this org.
 * @param orgId - Tenant.
 * @param slug - Plugin slug.
 */
export async function pluginEnabled(orgId: string, slug: string): Promise<boolean> {
  return (await enabledPluginsForOrg(orgId)).includes(slug);
}

/**
 * One dashboard page as THIS project sees it: the pages of every plugin the
 * project has on (`project.enabled_plugins`), plus the mounted workspace's
 * own pages and its plugins' — but only when that folder is this project's.
 * A deployment hosts several projects on one mounted folder: a plugin only
 * the project turned on (squatch-factory's `software-factory` under a
 * metacto-revenue mount) is invisible to the folder alone, and the folder's
 * pages (revenue's wiki) are not squatch-factory's to show. The shell, which
 * already holds the project row, makes the same two calls itself.
 * @param slug - The page slug.
 * @param orgId - The project.
 */
export async function readPageForOrg(slug: string, orgId: string): Promise<LoadedPage | null> {
  const [enabledPlugins, mounted] = await Promise.all([enabledPluginsForOrg(orgId), mountedWorkspaceIsProjects(orgId)]);
  const dir = mounted ? null : await projectPagesFolder(orgId).catch(() => null);
  return readWorkspacePage(slug, { enabledPlugins, mounted, dir });
}

/**
 * Whether the switch can write this workspace's manifest. On a deploy-managed
 * box the workspace is a read-only mount of a git checkout (`EROFS` on
 * 2026-09-18, agents.metacto.com), and the right door is the repo. Returns the
 * reason a person can act on, or null when writable.
 * @param workspaceDir - Workspace directory (relative to the repo root or absolute).
 */
export function workspaceWriteBlocker(workspaceDir: string): string | null {
  const file = join(fromRepoRoot(workspaceDir), 'workspace.yaml');
  try {
    accessSync(file, constants.W_OK);
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return 'this project has no workspace.yaml on this host';
    }
    return 'the workspace on this host is read-only (deploy-managed) — add the plugin to `plugins:` in workspace.yaml in the workspace repo and deploy';
  }
}

/**
 * Rewrite a workspace.yaml's `plugins:` list in place, keeping every comment
 * and every other key exactly as authored. Pure file edit; the caller applies.
 * @param workspaceDir - Absolute workspace directory.
 * @param slugs - The list to write. An empty list removes the key.
 * @returns The list that was there before.
 */
export function writeWorkspacePlugins(workspaceDir: string, slugs: readonly string[]): string[] {
  const file = join(workspaceDir, 'workspace.yaml');
  const doc = parseDocument(readFileSync(file, 'utf8'));
  const before = doc.get('plugins');
  const prior = before instanceof YAMLSeq ? before.items.map(i => String((i as { value?: unknown }).value ?? i)) : [];
  if (slugs.length === 0) {
    doc.delete('plugins');
  } else {
    const seq = doc.createNode([...slugs]) as YAMLSeq;
    seq.flow = true;
    doc.set('plugins', seq);
  }
  writeFileSync(file, doc.toString(), 'utf8');
  return prior;
}

export type PluginToggleResult = {
  slug: string;
  enabled: boolean;
  /** The list before — `workspace.yaml` `plugins:` when the file was edited, `project.enabled_plugins` when not. What undo restores. */
  before: string[];
  /** The list after. Authored (dependencies resolved at load, not written) for the file; dependency-closed for the column. */
  after: string[];
  /** What the apply reported; null when nothing was applied (the project-only write). */
  applied: { sha: string; errors: number } | null;
  /**
   * `workspace`: the folder was edited and applied — the usual path.
   * `project`: the folder is another project's (or there is none here), so
   * only `project.enabled_plugins` changed; `note` says so and names the repo
   * file that makes it stick.
   */
  mode: 'workspace' | 'project';
  /** For `mode: project` — what the person is told. */
  note?: string;
  /** For `mode: project` — the file to change in the workspace repo. */
  repoFile?: string;
};

/**
 * Where a plugin toggle for this project may write.
 *
 * `workspace`: the folder is this project's own (the judgement the drift
 * banner uses — `judgeMountedFolder`): edit `workspace.yaml` and apply,
 * unless `blocker` says the file is read-only here. `project`: the folder is
 * another project's, or there is no folder — the toggle updates
 * `project.enabled_plugins` only, and `note` tells the person the project is
 * applied from git and which file to change (`repoFile`). Never a blocker in
 * that mode: the column write always works, and the door is named.
 * @param orgId - The project asking.
 * @param projectSlug - Its slug, for the repo path.
 * @param workspaceDir - The folder resolved for it (`workspaceFolderForProject`), or null.
 * @param explicit - `VOCION_WORKSPACE_MAP` named the folder for this project.
 */
export async function pluginWriteTarget(orgId: string, projectSlug: string, workspaceDir: string | null, explicit = false): Promise<PluginWriteTarget> {
  const repoFile = `workspace/${projectSlug}/workspace.yaml`;
  if (workspaceDir && (await mountOwnership(orgId, { path: workspaceDir, explicit })).own) {
    return { mode: 'workspace', workspaceDir, blocker: workspaceWriteBlocker(workspaceDir), repoFile, owner: null };
  }
  const owner = workspaceDir ? await folderOwner(workspaceDir, readManifestOrgId(fromRepoRoot(workspaceDir))) : null;
  return { mode: 'project', workspaceDir, blocker: null, repoFile, owner: owner ? { slug: owner.slug, name: owner.name } : null };
}

export type PluginWriteTarget = {
  mode: 'workspace' | 'project';
  workspaceDir: string | null;
  /** `workspace` mode only: why the file cannot be written here, or null. */
  blocker: string | null;
  /** `workspace/<slug>/workspace.yaml` — the file in the workspace repo. */
  repoFile: string;
  /** `project` mode: whose folder is mounted here, when known. */
  owner: { slug: string; name: string } | null;
};

/**
 * The project's slug, for the repo path in a note (`workspace/<slug>/…`);
 * falls back to the id when the row is gone.
 * @param orgId - The project.
 */
export async function projectSlugFor(orgId: string): Promise<string> {
  const [row] = await db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.slug ?? orgId;
}

/**
 * The one entry the switch, the chat action and the API share: decide where
 * the toggle may write ({@link pluginWriteTarget}), then either edit the
 * folder and apply ({@link setPluginEnabled}) or update the project's column
 * alone and say so.
 * @param opts
 * @param opts.orgId - The project.
 * @param opts.projectSlug - Its slug, for the repo path in the note.
 * @param opts.workspaceDir - The folder resolved for it, or null.
 * @param opts.explicit - `VOCION_WORKSPACE_MAP` named the folder for this project.
 * @param opts.slug - The plugin.
 * @param opts.enabled - On or off.
 * @param opts.appliedBy - Who did it, for the workspace_version row.
 */
export async function togglePluginForProject(opts: { orgId: string; projectSlug: string; workspaceDir: string | null; explicit?: boolean; slug: string; enabled: boolean; appliedBy: string }): Promise<PluginToggleResult> {
  if (!listPluginSlugs().includes(opts.slug)) {
    throw new Error(`unknown plugin "${opts.slug}" — this core ships: ${listPluginSlugs().join(', ')}`);
  }
  const target = await pluginWriteTarget(opts.orgId, opts.projectSlug, opts.workspaceDir, opts.explicit);
  if (target.mode === 'workspace' && target.workspaceDir) {
    return setPluginEnabled({ orgId: opts.orgId, workspaceDir: target.workspaceDir, slug: opts.slug, enabled: opts.enabled, appliedBy: opts.appliedBy });
  }
  const before = await enabledPluginsForOrg(opts.orgId);
  const after = closeEnabledPlugins(opts.enabled ? [...before, opts.slug] : before.filter(s => s !== opts.slug && !loadPlugin(s).manifest.depends.includes(opts.slug)));
  await writeEnabledPlugins(opts.orgId, after);
  return { slug: opts.slug, enabled: opts.enabled, before, after, applied: null, mode: 'project', repoFile: target.repoFile, note: projectOnlyNote({ slug: opts.slug, enabled: opts.enabled, target }) };
}

/**
 * The undo of {@link togglePluginForProject}: put the earlier list back the
 * same way it was changed — the file (and an apply) in `workspace` mode, the
 * column alone in `project` mode.
 * @param opts
 * @param opts.orgId
 * @param opts.projectSlug
 * @param opts.workspaceDir
 * @param opts.explicit
 * @param opts.plugins - The list to put back.
 * @param opts.appliedBy
 */
export async function restorePluginsForProject(opts: { orgId: string; projectSlug: string; workspaceDir: string | null; explicit?: boolean; plugins: readonly string[]; appliedBy: string }): Promise<{ applied: { sha: string; errors: number } | null; mode: 'workspace' | 'project' }> {
  const target = await pluginWriteTarget(opts.orgId, opts.projectSlug, opts.workspaceDir, opts.explicit);
  if (target.mode === 'workspace' && target.workspaceDir) {
    return { ...(await restorePlugins({ orgId: opts.orgId, workspaceDir: target.workspaceDir, plugins: opts.plugins, appliedBy: opts.appliedBy })), mode: 'workspace' };
  }
  await writeEnabledPlugins(opts.orgId, closeEnabledPlugins(opts.plugins));
  return { applied: null, mode: 'project' };
}

/**
 * Dependency-closed, in load order — the shape `project.enabled_plugins` holds after an apply.
 * @param requested
 */
function closeEnabledPlugins(requested: readonly string[]): string[] {
  return resolvePlugins([...new Set(requested)]).map(p => p.manifest.slug);
}

async function writeEnabledPlugins(orgId: string, enabledPlugins: string[]): Promise<void> {
  await db.update(projectSchema).set({ enabledPlugins }).where(eq(projectSchema.id, orgId));
  invalidateChipCache(orgId);
}

function projectOnlyNote(input: { slug: string; enabled: boolean; target: PluginWriteTarget }): string {
  const { slug, enabled, target } = input;
  const did = enabled ? `Turned on ${slug}` : `Turned off ${slug}`;
  const folder = target.workspaceDir
    ? `the workspace folder mounted here${target.owner ? ` is ${target.owner.name}'s (${target.owner.slug}) and` : ''} was left alone`
    : 'no workspace folder is mounted here';
  const fix = enabled
    ? `add "${slug}" to plugins: in ${target.repoFile}`
    : `remove "${slug}" from plugins: in ${target.repoFile}`;
  return `${did} for this project only. This project is applied from git — ${folder}. To make it stick, ${fix} in the workspace repo and deploy.`;
}

/**
 * Turn a plugin on or off for a project: edit its workspace.yaml, reload,
 * apply. Throws on an unknown slug or a missing workspace directory; an apply
 * error is returned in `applied.errors` (the file edit stands — the drift
 * banner and `workspace:check` will name the problem).
 * @param opts
 * @param opts.orgId - The project.
 * @param opts.workspaceDir - Its workspace directory (relative to the repo root or absolute).
 * @param opts.slug - The plugin.
 * @param opts.enabled - On or off.
 * @param opts.appliedBy - Who did it, for the workspace_version row.
 */
export async function setPluginEnabled(opts: { orgId: string; workspaceDir: string; slug: string; enabled: boolean; appliedBy: string }): Promise<PluginToggleResult> {
  if (!listPluginSlugs().includes(opts.slug)) {
    throw new Error(`unknown plugin "${opts.slug}" — this core ships: ${listPluginSlugs().join(', ')}`);
  }
  const blocker = workspaceWriteBlocker(opts.workspaceDir);
  if (blocker) {
    throw new Error(`cannot change plugins here: ${blocker}`);
  }
  const dir = fromRepoRoot(opts.workspaceDir);
  const current = readAuthoredPlugins(dir);
  const next = opts.enabled
    ? [...new Set([...current, opts.slug])]
    // Turning one off also drops the plugins that depended on it — a plugin
    // cannot stay on without its dependency, and saying so beats a load error.
    : current.filter(s => s !== opts.slug && !loadPlugin(s).manifest.depends.includes(opts.slug));
  const before = writeWorkspacePlugins(dir, next);
  return { ...(await applyAfterEdit(opts.orgId, dir, opts.appliedBy)), slug: opts.slug, enabled: opts.enabled, before, after: next, mode: 'workspace' };
}

/**
 * Restore an earlier `plugins:` list — the undo of {@link setPluginEnabled}.
 * @param opts
 * @param opts.orgId
 * @param opts.workspaceDir
 * @param opts.plugins - The list to put back.
 * @param opts.appliedBy
 */
export async function restorePlugins(opts: { orgId: string; workspaceDir: string; plugins: readonly string[]; appliedBy: string }): Promise<{ applied: { sha: string; errors: number } }> {
  const dir = fromRepoRoot(opts.workspaceDir);
  writeWorkspacePlugins(dir, opts.plugins);
  return applyAfterEdit(opts.orgId, dir, opts.appliedBy);
}

function readAuthoredPlugins(dir: string): string[] {
  const doc = parseDocument(readFileSync(join(dir, 'workspace.yaml'), 'utf8'));
  const node = doc.get('plugins');
  return node instanceof YAMLSeq ? node.items.map(i => String((i as { value?: unknown }).value ?? i)) : [];
}

async function applyAfterEdit(orgId: string, dir: string, appliedBy: string): Promise<{ applied: { sha: string; errors: number } }> {
  const loaded = loadWorkspace(dir);
  const result = await applyWorkspace(loaded, { orgId, appliedBy });
  invalidateCurrentContextShaCache();
  invalidateChipCache(orgId);
  return { applied: { sha: loaded.sha, errors: result.errors.length } };
}
