/**
 * Reading and writing ONE markdown document inside a workspace, with an
 * apply — the shared half of the two self-updates that live in files rather
 * than in the database (a playbook, an agent's system prompt).
 *
 * Why this exists rather than the oRPC `workspace.writeFile` route: an action
 * runs on a server with no request, so it cannot call a route, and copying
 * that route's containment and symlink guards into two actions would be two
 * places to get them wrong. The guards are here, once.
 *
 * Why it is markdown-only: these are prose documents an agent revises. A
 * YAML manifest is structure the applier validates, and letting a
 * self-update rewrite one would put schema errors behind a confidence score.
 *
 * On a deploy-managed box the workspace is a read-only mount of a git
 * checkout, and the honest answer is the repo, not a failed run. Callers ask
 * {@link workspaceDocBlocker} in their action's `precheck` so the refusal
 * happens before a card exists — the same shape `plugin.enable` uses.
 */

import { Buffer } from 'node:buffer';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fromRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, invalidateCurrentContextShaCache, loadWorkspace } from '@/libs/workspace';
import { invalidateChipCache } from '@/services/chat/synthesis';
import { workspaceWriteBlocker } from '@/services/PluginService';

/** What an apply reported, carried onto the action run so the receipt can say it landed. */
export type WorkspaceApplyResult = { sha: string; errors: number };

/**
 * The workspace directory for a project, or null when this host has none.
 * @param orgId - The project.
 */
export async function workspaceDirFor(orgId: string): Promise<string | null> {
  const { workspacePathForProject } = await import('@/routers/Workspace');
  return workspacePathForProject(orgId);
}

/**
 * Why a self-update cannot write files here, in a sentence a person can act
 * on — or null when it can. Answers the "no workspace at all" case too, which
 * `workspaceWriteBlocker` alone does not.
 * @param dir - The workspace directory, or null when the project has none.
 */
export function workspaceDocBlocker(dir: string | null): string | null {
  if (!dir) {
    return 'this project has no workspace directory on this host, so its files are edited in the workspace repo and deployed';
  }
  return workspaceWriteBlocker(dir);
}

/**
 * Resolve a workspace-relative path to an absolute one, refusing anything
 * that leaves the workspace or is not markdown.
 *
 * Two checks, because they catch different things: the string comparison
 * stops `../../etc/passwd`, and the realpath comparison stops a symlink
 * committed inside the workspace repo that points somewhere else — a write
 * would follow it and overwrite whatever is on the other end.
 * @param dir - The workspace directory.
 * @param relPath - Path under it, e.g. `playbooks/discovery-summary/SKILL.md`.
 */
export function resolveWorkspaceDoc(dir: string, relPath: string): string {
  return resolveWorkspacePath(dir, relPath, ['.md']);
}

/**
 * The same guards for a file that is not markdown — the one caller is an
 * agent whose system prompt is authored inline in its own YAML, where the
 * prompt cannot be reached without editing that file.
 * @param dir - The workspace directory.
 * @param relPath - Path under it.
 * @param exts - The extensions this caller is allowed to touch.
 */
export function resolveWorkspacePath(dir: string, relPath: string, exts: readonly string[]): string {
  if (!exts.some(e => relPath.endsWith(e))) {
    throw new Error(`"${relPath}" is not a file a self-update may write (allowed: ${exts.join(', ')})`);
  }
  const base = fromRepoRoot(dir);
  const abs = resolve(base, relPath);
  const rel = relative(base, abs);
  if (rel.startsWith('..') || rel.startsWith('/')) {
    throw new Error(`path escapes the workspace: ${relPath}`);
  }
  if (lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`path is a symlink: ${relPath}`);
  }
  const parent = dirname(abs);
  try {
    const realBase = realpathSync(base);
    const realParent = realpathSync(parent);
    const realRel = relative(realBase, realParent);
    if (realRel.startsWith('..') || realRel.startsWith('/')) {
      throw new Error(`path escapes the workspace: ${relPath}`);
    }
  } catch (err) {
    // A parent that does not exist yet is a new folder, not an escape — the
    // string check above already proved where it would be created.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  return abs;
}

/**
 * The document as it is now, or null when there is no file there yet.
 * Read before every write: it is what `undo` puts back.
 * @param dir - The workspace directory.
 * @param relPath - Path under it.
 */
export function readWorkspaceDoc(dir: string, relPath: string): string | null {
  try {
    return readFileSync(resolveWorkspaceDoc(dir, relPath), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Write the document and apply the workspace, so the change is live in the
 * same move it is authored. The file edit stands even when the apply reports
 * errors — the drift banner and `workspace:check` name those — which is why
 * `errors` rides the result instead of throwing.
 * @param opts - The write.
 * @param opts.orgId - The project to apply into.
 * @param opts.dir - The workspace directory.
 * @param opts.relPath - Path under it.
 * @param opts.content - The whole new document.
 * @param opts.appliedBy - Who, for the `workspace_version` row.
 */
export async function writeWorkspaceDoc(opts: {
  orgId: string;
  dir: string;
  relPath: string;
  content: string;
  appliedBy: string;
}): Promise<{ applied: WorkspaceApplyResult; bytes: number }> {
  const abs = resolveWorkspaceDoc(opts.dir, opts.relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, opts.content, 'utf8');
  return { applied: await applyAfterDocEdit(opts.orgId, opts.dir, opts.appliedBy), bytes: Buffer.byteLength(opts.content, 'utf8') };
}

/**
 * Delete the document and apply — the undo of a write that CREATED a file.
 * Never used to undo a revision: that restores the previous text instead.
 * @param opts - The removal.
 * @param opts.orgId
 * @param opts.dir
 * @param opts.relPath
 * @param opts.appliedBy
 * @param opts.pruneFolder - Also remove the containing folder when it is the resource's own (`playbooks/<slug>/`).
 */
export async function removeWorkspaceDoc(opts: {
  orgId: string;
  dir: string;
  relPath: string;
  appliedBy: string;
  pruneFolder?: boolean;
}): Promise<{ applied: WorkspaceApplyResult }> {
  const abs = resolveWorkspaceDoc(opts.dir, opts.relPath);
  rmSync(opts.pruneFolder ? dirname(abs) : abs, { recursive: true, force: true });
  return { applied: await applyAfterDocEdit(opts.orgId, opts.dir, opts.appliedBy) };
}

/**
 * Whether a path is inside the workspace and exists — for a `precheck` that
 * wants to refuse an unknown slug before a card is created.
 * @param dir - The workspace directory.
 * @param relPath - Path under it.
 */
export function workspaceDocExists(dir: string, relPath: string): boolean {
  return readWorkspaceDoc(dir, relPath) !== null;
}

/**
 * The workspace-relative path of one playbook's prompt.
 * @param slug
 */
export function playbookDocPath(slug: string): string {
  return join('playbooks', slug, 'SKILL.md');
}

/**
 * The workspace-relative path of one agent's system prompt.
 * @param slug
 */
export function agentPromptPath(slug: string): string {
  return join('agents', `${slug}.system-prompt.md`);
}

/**
 * Load and apply the workspace after a file has been edited in place, and
 * drop the caches that would otherwise keep serving the old context.
 * @param orgId - The project to apply into.
 * @param dir - The workspace directory.
 * @param appliedBy - Who, for the `workspace_version` row.
 */
export async function applyAfterDocEdit(orgId: string, dir: string, appliedBy: string): Promise<WorkspaceApplyResult> {
  const loaded = loadWorkspace(fromRepoRoot(dir));
  const result = await applyWorkspace(loaded, { orgId, appliedBy });
  invalidateCurrentContextShaCache();
  invalidateChipCache(orgId);
  return { sha: loaded.sha, errors: result.errors.length };
}
