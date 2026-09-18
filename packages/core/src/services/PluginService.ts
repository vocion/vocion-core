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
 */

import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { parseDocument, YAMLSeq } from 'yaml';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, invalidateCurrentContextShaCache, loadWorkspace } from '@/libs/workspace';
import { listPluginSlugs, loadPlugin } from '@/libs/workspace/plugins';
import { projectSchema } from '@/models/Schema';
import { invalidateChipCache } from '@/services/chat/synthesis';

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
  /** `workspace.yaml` `plugins:` before the edit — what undo restores. */
  before: string[];
  /** The list after the edit, as authored (dependencies are resolved at load, not written). */
  after: string[];
  /** What the apply reported. */
  applied: { sha: string; errors: number };
};

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
  return { ...(await applyAfterEdit(opts.orgId, dir, opts.appliedBy)), slug: opts.slug, enabled: opts.enabled, before, after: next };
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
