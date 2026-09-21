/**
 * Operating intent: read and write `operating-intent.yaml`.
 *
 * The file is the person's standing instructions to the factory: what we are
 * trying to achieve now, what beats what, what may not happen without asking,
 * what may be spent, which classes of action run unattended, and the product
 * judgment nobody can derive from records.
 *
 * It is workspace-as-code rather than a settings screen because the whole
 * value is that it is versioned and readable by the agents: a priority
 * expressed as a row in a table nobody diffs is a priority that quietly
 * changes. Writing it goes through the gated action rail
 * (`libs/actions/workspace-operating-intent.ts`), so every change is an
 * `action_run` a person can point at, with the previous text one Undo away.
 *
 * Order matters here and is the same order `WorkspaceSourceService` uses:
 * refuse before writing, write the file, re-load the workspace, roll the file
 * back if it no longer loads, then apply. A file that lands on disk but fails
 * to load would otherwise leave the workspace unloadable until someone edited
 * it by hand.
 */

import type { OperatingIntentManifest } from '@/libs/workspace/schemas';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import { loadWorkspace } from '@/libs/workspace/loader';
import { OperatingIntentManifestSchema } from '@/libs/workspace/schemas';
import { applyAfterDocEdit, resolveWorkspacePath } from '@/services/selfUpdate/workspaceDoc';

/** The one file name. `.yml` is read when it is what the workspace authored. */
export const OPERATING_INTENT_FILES = ['operating-intent.yaml', 'operating-intent.yml'] as const;

export type OperatingIntentRead = {
  /** The workspace folder this project resolves to, or null when there is none here. */
  workspaceDir: string | null;
  /** Absolute path of the file, whether or not it exists yet. */
  path: string | null;
  /** The file's text, or null when it has not been authored. */
  text: string | null;
  /** The parsed, validated intent, or null when unauthored or unparseable. */
  intent: OperatingIntentManifest | null;
  /** Why it could not be parsed, when there is text but no intent. */
  error: string | null;
  /** Why it cannot be edited from here: a read-only mount, or no folder. */
  blocker: string | null;
};

/**
 * The absolute file path to read or write for a workspace folder: the file
 * that exists, or the `.yaml` spelling when neither does.
 * @param dir - Absolute workspace directory.
 */
export function operatingIntentPath(dir: string): string {
  const name = OPERATING_INTENT_FILES.find(n => existsSync(join(fromRepoRoot(dir), n))) ?? OPERATING_INTENT_FILES[0];
  // Through the same guard the self-update writes use: no escape out of the
  // workspace, no symlink, and only the two spellings of this one file.
  return resolveWorkspacePath(dir, name, ['.yaml', '.yml']);
}

/**
 * Parse and validate intent YAML. Returns the error rather than throwing,
 * because both the page and the action's precheck want to say what is wrong
 * instead of failing.
 * @param text - The file's text.
 */
export function parseOperatingIntent(text: string): { intent: OperatingIntentManifest | null; error: string | null } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    return { intent: null, error: `not valid YAML: ${(err as Error).message}` };
  }
  if (raw === null || raw === undefined) {
    return { intent: null, error: 'the file is empty, and an operating intent with nothing in it says nothing' };
  }
  const parsed = OperatingIntentManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { intent: null, error: parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  }
  return { intent: parsed.data, error: null };
}

/**
 * This project's operating intent as it stands on disk, with the reason it
 * cannot be edited when it cannot.
 * @param orgId - The project.
 */
export async function readOperatingIntent(orgId: string): Promise<OperatingIntentRead> {
  const [{ workspaceFolderForProject }, { workspaceWriteBlocker }] = await Promise.all([
    import('@/routers/Workspace'),
    import('@/services/PluginService'),
  ]);
  const folder = await workspaceFolderForProject(orgId);
  if (!folder?.path) {
    return { workspaceDir: null, path: null, text: null, intent: null, error: null, blocker: 'this project has no workspace folder on this host' };
  }
  const dir = folder.path;
  const path = operatingIntentPath(dir);
  const blocker = workspaceWriteBlocker(folder.path);
  if (!existsSync(path)) {
    return { workspaceDir: dir, path, text: null, intent: null, error: null, blocker };
  }
  const text = readFileSync(path, 'utf8');
  const { intent, error } = parseOperatingIntent(text);
  return { workspaceDir: dir, path, text, intent, error, blocker };
}

export type OperatingIntentWrite = {
  path: string;
  /** The text that was there before, or null when the file is new. What undo restores. */
  previous: string | null;
  /** True when this call created the file. Undo then removes it rather than restoring. */
  created: boolean;
  /** True when the text was identical and nothing was written. */
  unchanged: boolean;
  applied: { sha: string; errors: number } | null;
};

/**
 * Write the file, re-load, roll back on a load failure, then apply.
 * @param opts
 * @param opts.orgId - The project.
 * @param opts.content - The whole file, as a person or an agent wrote it.
 * @param opts.appliedBy - Who to record the apply against.
 */
export async function writeOperatingIntent(opts: { orgId: string; content: string; appliedBy: string }): Promise<OperatingIntentWrite> {
  const current = await readOperatingIntent(opts.orgId);
  if (!current.workspaceDir || !current.path) {
    throw new Error('this project has no workspace folder on this host');
  }
  if (current.blocker) {
    throw new Error(current.blocker);
  }
  const { error } = parseOperatingIntent(opts.content);
  if (error) {
    throw new Error(`operating intent is not valid: ${error}`);
  }
  const path = current.path;
  const previous = current.text;
  const created = previous === null;
  if (previous !== null && previous === opts.content) {
    return { path, previous, created: false, unchanged: true, applied: null };
  }

  writeFileSync(path, opts.content.endsWith('\n') ? opts.content : `${opts.content}\n`, 'utf8');
  try {
    // A dry load before the apply: `applyAfterDocEdit` loads too, but a load
    // that throws THERE would leave the bad file on disk, which is the one
    // state the workspace must never be in.
    loadWorkspace(fromRepoRoot(current.workspaceDir));
  } catch (err) {
    // Disk first, rollback on failure: the workspace must never be left in a
    // state where nothing loads because one file was saved.
    rollback(path, previous);
    throw new Error(`the workspace no longer loads with that operating intent, so it was not kept: ${(err as Error).message}`);
  }
  const applied = await applyAfterDocEdit(opts.orgId, current.workspaceDir, opts.appliedBy);
  return { path, previous, created, unchanged: false, applied };
}

/**
 * Put back what was there, the undo of {@link writeOperatingIntent}. A write
 * that created the file restores it to absent.
 * @param opts
 * @param opts.orgId - The project.
 * @param opts.previous - The text to restore, or null to remove the file.
 * @param opts.appliedBy - Who to record the apply against.
 */
export async function restoreOperatingIntent(opts: { orgId: string; previous: string | null; appliedBy: string }): Promise<{ applied: { sha: string; errors: number } }> {
  const current = await readOperatingIntent(opts.orgId);
  if (!current.workspaceDir || !current.path) {
    throw new Error('this project has no workspace folder on this host');
  }
  rollback(current.path, opts.previous);
  return { applied: await applyAfterDocEdit(opts.orgId, current.workspaceDir, opts.appliedBy) };
}

function rollback(path: string, previous: string | null): void {
  if (previous === null) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, previous, 'utf8');
}

/**
 * The applied operating intent for a project, read from the column rather
 * than the file so an agent turn does not touch the filesystem.
 *
 * `null` means the workspace has stated nothing. That is deliberately not the
 * same fact as an authored intent with empty lists, which is a person saying
 * there are no constraints; a caller that flattens the two is lying to
 * whoever reads it.
 * @param orgId - The project.
 */
export async function operatingIntentForOrg(orgId: string): Promise<OperatingIntentManifest | null> {
  const [{ db }, { eq }, { projectSchema }] = await Promise.all([
    import('@/libs/DB'),
    import('drizzle-orm'),
    import('@/models/Schema'),
  ]);
  const [row] = await db
    .select({ operatingIntent: projectSchema.operatingIntent })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  const raw = row?.operatingIntent ?? null;
  if (raw === null) {
    return null;
  }
  const parsed = OperatingIntentManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
