/**
 * WorkspaceSourceService — a mission or a playbook edited AS AN ARTIFACT,
 * with the file staying the source of truth.
 *
 * The mirror (`libs/workspace/source.ts`) gives a workspace file the pane, a
 * version for every edit, restore, share and select-to-ask, because those are
 * what an artifact already has (design principle 7). What this module owns is
 * the one write path behind all of that, in this order and no other:
 *
 *   1. validate the text through the REAL schema for its kind;
 *   2. write the FILE, verbatim;
 *   3. load the whole workspace — cross-references, collisions, `{{env}}`
 *      tokens — and put the file back if the load refuses it;
 *   4. record the new version on the mirror, under the author's name;
 *   5. apply — the same reconciliation `workspace:apply` runs, so the mission
 *      or catalog row moves, a `workspace_version` row is written, and the
 *      applier's own mirror step finds nothing left to do.
 *
 * Disk first, database second. A person's Save in the pane, an agent's
 * `write_mission` / `write_playbook` (through the `workspace.write_*`
 * actions) and a Restore from the version menu all come through here, so
 * there is one history and one audit trail — the artifact's versions for
 * "who changed this and why", `workspace_version` for "what was applied when".
 * Git stays the person's: nothing here commits.
 */

import type { SourceKind } from '@/libs/workspace';
import type { ArtifactRow, ArtifactVersionRow, Author } from '@/services/ArtifactService';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fromRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, deleteResource, invalidateCurrentContextShaCache, loadWorkspace, pluginRoots, sourceArtifactKind, sourceContentOf, sourceFolder, sourceKindOf, sourceRecord, sourceRelPath, sourceSpec, SourceValidationError, validateSourceText, WorkspaceTemplateError, WorkspaceValidationError, writeSourceText } from '@/libs/workspace';
import { workspacePathForProject } from '@/libs/workspace/project-path';
import { deleteArtifact, getArtifact, getArtifactVersion, listArtifactsForRecord, upsertRecordArtifact } from '@/services/ArtifactService';

/** The base pack shipped inside the runtime — the last layer a file can come from. */
const BASE_PACK_REL = 'packages/core/templates/base';

export class WorkspaceSourceError extends Error {
  constructor(public readonly code: 'NO_WORKSPACE' | 'READ_ONLY' | 'CONFLICT' | 'INVALID' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'WorkspaceSourceError';
  }
}

/**
 * The workspace directory for a project, absolute. Multi-workspace installs
 * map projects to folders (`VOCION_WORKSPACE_MAP`); the rest use
 * `WORKSPACE_PATH`. Null when this host has no workspace for the project.
 * @param orgId
 */
export async function workspaceDirFor(orgId: string): Promise<string | null> {
  const dir = await workspacePathForProject(orgId);
  return dir ? fromRepoRoot(dir) : null;
}

export type ResolvedSourceFile = {
  /** Absolute path of the file that would be read. */
  path: string;
  /** `workspace`: the tenant's own file. `core`: inherited from a plugin or the base pack, read-only there. */
  layer: 'workspace' | 'core';
  content: string;
};

/**
 * Find the file a mission or a SKILL.md kind/slug is read from: the
 * workspace's own copy first, then an enabled plugin's, then the base
 * pack's — the compose order the loader uses. Null when nothing ships it.
 * @param workspaceDir - Absolute workspace directory.
 * @param kind
 * @param slug
 */
export function resolveSourceFile(workspaceDir: string, kind: SourceKind, slug: string): ResolvedSourceFile | null {
  const rel = sourceRelPath(kind, slug);
  const own = resolve(workspaceDir, rel);
  if (existsSync(own)) {
    return { path: own, layer: 'workspace', content: readFileSync(own, 'utf8') };
  }
  for (const root of [...pluginRoots(), fromRepoRoot(BASE_PACK_REL)]) {
    const candidate = resolve(root, rel);
    if (existsSync(candidate)) {
      return { path: candidate, layer: 'core', content: readFileSync(candidate, 'utf8') };
    }
  }
  return null;
}

/**
 * The mirror artifact for a kind/slug, when one exists.
 * @param orgId
 * @param kind
 * @param slug
 */
export async function getSourceArtifact(orgId: string, kind: SourceKind, slug: string): Promise<ArtifactRow | null> {
  const record = sourceRecord(kind, slug);
  const rows = await listArtifactsForRecord({ orgId, record });
  return rows.find(r => r.recordRole === record.role) ?? null;
}

/**
 * The mirror for a kind/slug, created from the file on disk when the
 * applier has not made one yet (a workspace applied before this existed).
 * Idempotent and cheap, so a page can call it on every load. Null when no
 * workspace is configured or nothing ships the file.
 * @param orgId
 * @param kind
 * @param slug
 */
export async function ensureSourceArtifact(orgId: string, kind: SourceKind, slug: string): Promise<ArtifactRow | null> {
  const existing = await getSourceArtifact(orgId, kind, slug);
  if (existing) {
    return existing;
  }
  const dir = await workspaceDirFor(orgId);
  if (!dir) {
    return null;
  }
  const file = resolveSourceFile(dir, kind, slug);
  if (!file) {
    return null;
  }
  let title = slug;
  try {
    title = validateSourceText(kind, slug, file.content).title;
  } catch {
    // The file may be a patch or mid-edit; the mirror still shows it as written.
  }
  const { artifact } = await mirrorSource({ orgId, kind, slug, title, content: file.content, author: { kind: 'system', id: null }, changeSummary: 'Mirrored from the workspace file' });
  return artifact;
}

/**
 * Write (or leave unchanged) the mirror for a file. The applier calls this
 * for every mission, skill and playbook on every apply; the write path calls
 * it once with the author's name before applying. Content-identical writes
 * add no version.
 * @param opts
 * @param opts.orgId
 * @param opts.kind
 * @param opts.slug
 * @param opts.title
 * @param opts.content - The whole file, as authored.
 * @param opts.author
 * @param opts.changeSummary
 * @param opts.noCollapse - Skip the human save-collapse window (a restore, an agent write).
 * @param opts.runId
 */
export async function mirrorSource(opts: {
  orgId: string;
  kind: SourceKind;
  slug: string;
  title: string;
  content: string;
  author: Author;
  changeSummary: string;
  noCollapse?: boolean;
  runId?: string | null;
}): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow; created: boolean; unchanged: boolean }> {
  return upsertRecordArtifact({
    orgId: opts.orgId,
    kind: sourceArtifactKind(opts.kind),
    title: opts.title,
    spec: sourceSpec(opts.kind, opts.slug, opts.content),
    folder: sourceFolder(opts.kind),
    record: sourceRecord(opts.kind, opts.slug),
    author: opts.author,
    changeSummary: opts.changeSummary,
    runId: opts.runId ?? null,
    noCollapse: opts.noCollapse ?? true,
    visibility: 'user',
  });
}

export type WriteWorkspaceSourceInput = {
  orgId: string;
  kind: SourceKind;
  slug: string;
  /** The whole file, as it should be on disk. */
  content: string;
  author: Author;
  changeSummary: string;
  /** Refuse when the mirror's head is not this version — the pane's ordinary Save. */
  ifVersion?: number | null;
  /** Never fold into the previous version (a restore, an agent write). */
  noCollapse?: boolean;
  /** Who to name on the `workspace_version` row. */
  appliedBy?: string;
  runId?: string | null;
};

export type WriteWorkspaceSourceResult = {
  artifact: ArtifactRow;
  version: ArtifactVersionRow;
  created: boolean;
  /** Nothing changed on disk or in the mirror; no apply ran. */
  unchanged: boolean;
  /** The mirror's head before this write, when there was one. */
  previousVersion: number | null;
  /** What the file held before, when it existed in the workspace. */
  previousContent: string | null;
  /** Absolute path written. */
  path: string;
  /** The apply's `workspace_version` id and sha, when one ran. */
  applied: { versionId: number | null; sha: string } | null;
};

/**
 * Put a file back the way it was — or take it away when it was new — after
 * the loader refused what was written. A SKILL.md folder created for the
 * write is removed only when nothing else is in it.
 * @param path
 * @param previous
 */
function rollback(path: string, previous: string | null): void {
  if (previous !== null) {
    writeFileSync(path, previous, 'utf8');
    return;
  }
  rmSync(path, { force: true });
  const dir = dirname(path);
  if (path.endsWith('SKILL.md') && existsSync(dir) && readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The one write path for a mission or a SKILL.md edited in the app. See the
 * module note for the order of operations.
 * @param input
 */
export async function writeWorkspaceSource(input: WriteWorkspaceSourceInput): Promise<WriteWorkspaceSourceResult> {
  const dir = await workspaceDirFor(input.orgId);
  if (!dir) {
    throw new WorkspaceSourceError('NO_WORKSPACE', 'this project has no workspace directory on this host, so its files are edited in the workspace repo and applied from there');
  }
  const { workspaceWriteBlocker } = await import('@/services/PluginService');
  const blocker = workspaceWriteBlocker(dir);
  if (blocker) {
    throw new WorkspaceSourceError('READ_ONLY', blocker);
  }

  const mirror = await getSourceArtifact(input.orgId, input.kind, input.slug);
  if (typeof input.ifVersion === 'number' && mirror && mirror.currentVersion !== input.ifVersion) {
    throw new WorkspaceSourceError('CONFLICT', `${input.kind} "${input.slug}" is at v${mirror.currentVersion}, not v${input.ifVersion}`);
  }

  let written;
  try {
    written = writeSourceText({ contextPath: dir, kind: input.kind, slug: input.slug, content: input.content });
  } catch (err) {
    if (err instanceof SourceValidationError) {
      throw new WorkspaceSourceError('INVALID', err.message);
    }
    throw err;
  }

  // Identical text: nothing to version, nothing to apply.
  if (written.previous !== null && written.previous === input.content && mirror) {
    const head = await getArtifactVersion({ orgId: input.orgId, artifactId: mirror.id, version: mirror.currentVersion });
    return { artifact: mirror, version: head!, created: false, unchanged: true, previousVersion: mirror.currentVersion, previousContent: written.previous, path: written.path, applied: null };
  }

  // The whole workspace has to still load — this is where a slug collision,
  // a dangling `playbooks:` reference or an unallowlisted `{{env}}` token is
  // caught. If it does not, the file goes back exactly as it was.
  let loaded;
  try {
    loaded = loadWorkspace(dir);
  } catch (err) {
    rollback(written.path, written.previous);
    if (err instanceof WorkspaceValidationError || err instanceof WorkspaceTemplateError || err instanceof Error) {
      throw new WorkspaceSourceError('INVALID', err.message);
    }
    throw err;
  }

  const mirrored = await mirrorSource({
    orgId: input.orgId,
    kind: input.kind,
    slug: input.slug,
    title: written.title,
    content: input.content,
    author: input.author,
    changeSummary: input.changeSummary,
    noCollapse: input.noCollapse ?? input.author.kind !== 'human',
    runId: input.runId ?? null,
  });

  const apply = await applyWorkspace(loaded, { orgId: input.orgId, appliedBy: input.appliedBy ?? authorName(input.author) });
  invalidateCurrentContextShaCache();
  try {
    const { invalidateChipCache } = await import('@/services/chat/synthesis');
    invalidateChipCache(input.orgId);
  } catch {
    /* the chip cache is a convenience; a miss costs one regeneration */
  }

  return {
    artifact: mirrored.artifact,
    version: mirrored.version,
    created: mirrored.created,
    unchanged: mirrored.unchanged,
    previousVersion: mirror?.currentVersion ?? null,
    previousContent: written.previous,
    path: written.path,
    applied: { versionId: apply.versionId, sha: loaded.sha },
  };
}

function authorName(author: Author): string {
  return author.kind === 'agent' ? (author.id ?? 'agent') : author.kind === 'human' ? (author.id ?? 'user') : 'system';
}

/**
 * Restore an older version of a mirror by writing its text FORWARD — to the
 * file, then as a new head — so the history stays append-only and the file
 * on disk agrees with what the pane shows.
 * @param opts
 * @param opts.orgId
 * @param opts.id - The mirror artifact.
 * @param opts.version - The version to bring back.
 * @param opts.author
 */
export async function restoreWorkspaceSource(opts: { orgId: string; id: number; version: number; author: Author }): Promise<WriteWorkspaceSourceResult> {
  const row = await getArtifact({ orgId: opts.orgId, id: opts.id });
  if (!row) {
    throw new WorkspaceSourceError('NOT_FOUND', `artifact #${opts.id} not found`);
  }
  const kind = sourceKindOf(row.kind, row.spec);
  const slug = typeof row.spec.slug === 'string' ? row.spec.slug : row.recordId;
  if (!kind || !slug) {
    throw new WorkspaceSourceError('NOT_FOUND', `artifact #${opts.id} is not a workspace source`);
  }
  const source = await getArtifactVersion({ orgId: opts.orgId, artifactId: opts.id, version: opts.version });
  if (!source) {
    throw new WorkspaceSourceError('NOT_FOUND', `artifact #${opts.id} has no v${opts.version}`);
  }
  const content = sourceContentOf(source.spec);
  if (content === null) {
    throw new WorkspaceSourceError('NOT_FOUND', `v${opts.version} holds no file text`);
  }
  return writeWorkspaceSource({
    orgId: opts.orgId,
    kind,
    slug,
    content,
    author: opts.author,
    changeSummary: `Restored v${opts.version}`,
    noCollapse: true,
  });
}

/**
 * Take a file the app created back out — the undo of a `created` write:
 * the file, the applied row and the mirror all go, and the workspace is
 * re-applied so nothing downstream still believes in it.
 * @param opts
 * @param opts.orgId
 * @param opts.kind
 * @param opts.slug
 * @param opts.appliedBy
 */
export async function removeWorkspaceSource(opts: { orgId: string; kind: SourceKind; slug: string; appliedBy?: string }): Promise<{ removed: string[]; rows: number }> {
  const dir = await workspaceDirFor(opts.orgId);
  if (!dir) {
    throw new WorkspaceSourceError('NO_WORKSPACE', 'this project has no workspace directory on this host');
  }
  const removed = deleteResource(dir, opts.kind, opts.slug);
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { missionSchema, playbookSchema } = await import('@/models/Schema');
  const rows = opts.kind === 'mission'
    ? await db.delete(missionSchema).where(and(eq(missionSchema.orgId, opts.orgId), eq(missionSchema.slug, opts.slug))).returning()
    : await db.delete(playbookSchema).where(and(eq(playbookSchema.orgId, opts.orgId), eq(playbookSchema.slug, opts.slug))).returning();
  const mirror = await getSourceArtifact(opts.orgId, opts.kind, opts.slug);
  if (mirror) {
    await deleteArtifact({ orgId: opts.orgId, id: mirror.id });
  }
  if (removed.length > 0) {
    const loaded = loadWorkspace(dir);
    await applyWorkspace(loaded, { orgId: opts.orgId, appliedBy: opts.appliedBy ?? 'undo' });
    invalidateCurrentContextShaCache();
  }
  return { removed, rows: rows.length };
}
