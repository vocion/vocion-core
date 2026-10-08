/**
 * WorkspaceImportService — put an exported workspace into this one.
 *
 * An admin uploads a zip (an export from Settings, or a workspace folder the
 * browser zipped), sees what it would change, and applies it. The loader reads
 * a folder, so the upload is staged in a temporary folder, loaded and applied
 * exactly as `workspace:apply` applies a folder, and the folder is removed
 * however that ends (`staging.ts`). There is one write path: the applier.
 *
 * Two ways in:
 *
 *   - **Merge** (the default): the upload is laid over this workspace as it is
 *     running now (`exportWorkspace`). A resource the upload names replaces
 *     the one of the same slug; everything it does not mention stays, so the
 *     apply retires nothing. `workspace.yaml` and `trust.yaml` merge key by
 *     key — the upload's value wins, lists gain what it adds, and a trust rule
 *     or a notification is matched by what it is about — so turning a plugin
 *     on in the upload never turns another one off here.
 *   - **Replace**: the upload is the whole workspace. Applied as a folder
 *     always is: an agent, mission, automation or workflow it does not ship
 *     is retired (rows kept, history intact), and the trust rules and settings
 *     become its.
 *
 * Either way the review comes first: {@link previewImport} is a dry run that
 * writes nothing and returns the diff — per kind, per resource, retirements,
 * settings, trust rules and stored files included — and the review's own sha:
 * of every staged file and of every change the review lists.
 * {@link applyImport} stages the same upload again, dry-runs it again, and
 * applies it only when that sha still matches, so what lands is what was
 * reviewed — the files, and what they do to this workspace as it is now. If
 * either moved in between, the person is asked to review again.
 *
 * Some fields reach past the workspace into the deployment — where an agent's
 * loop runs, what of the server's disk a connector reads — and no admin sets
 * them in the app; an import may not change them either (`importPolicy.ts`).
 * The review names each one, and nothing is applied while any is there.
 *
 * Only a workspace whose files live in the database takes an import. One this
 * host applies from its own folder, or one a deploy applies from git, would
 * have the import undone by its next apply, so the preview says that instead
 * of offering to apply.
 */

import type { ImportRefusal } from './importPolicy';
import type { ApplyResult, LoadedWorkspace } from '@/libs/workspace';
import type { ExportFile } from '@/libs/workspace/export';
import { createHash } from 'node:crypto';
import { sep } from 'node:path';
import { eq } from 'drizzle-orm';
import { Document, parseDocument, stringify as stringifyYaml } from 'yaml';
import { db } from '@/libs/DB';
import { isDeclaredInWorkspaceFile } from '@/libs/sources/manifestDir';
import { canonical } from '@/libs/sources/upsert';
import { applyWorkspace, getCurrentWorkspaceVersion, invalidateCurrentContextShaCache, isDeployManaged, loadWorkspace } from '@/libs/workspace';
import { readWorkspaceArchive } from '@/libs/workspace/archive';
import { declaredResources, fileText as text, yamlMap as yamlOrNull } from '@/libs/workspace/declared';
import { textFile } from '@/libs/workspace/export';
import { MANIFEST_FILES } from '@/libs/workspace/snapshot';
import { knowledgeSourceSchema, projectSchema } from '@/models/Schema';
import { invalidateChipCache } from '@/services/chat/synthesis';
import { importRefusals } from './importPolicy';
import { pinSourceRows, STORED_MANIFEST_DIR, withStagedWorkspace } from './staging';
import { EXPORT_REPORT_FILE, exportWorkspace } from './WorkspaceExportService';
import { ownWorkspaceFolder } from './WorkspaceFileService';

export type ImportOptions = {
  /** The upload is the whole workspace: what it does not ship is retired. Default: merge. */
  replace?: boolean;
};

/** What an import would do, from a dry run that wrote nothing. */
export type ImportPreview = {
  /**
   * The review's sha: of every staged file (path and bytes) and of every
   * change listed here. Applying requires the same one, so an upload or a
   * workspace that moved since the review is reviewed again.
   */
  sha: string;
  replace: boolean;
  /** How many files the upload holds. */
  fileCount: number;
  counts: ApplyResult['counts'];
  /** Each resource the import would create, update or retire, by name. */
  changes: ApplyResult['changes'];
  /** How many resources would stay exactly as they are. */
  unchanged: number;
  errors: ApplyResult['errors'];
  warnings: ApplyResult['warnings'];
  /** Why this workspace cannot take the import, when it cannot; null when it can. */
  blockedBy: string | null;
  /** Fields the upload sets that an import may not, by resource; nothing is applied while any is here. */
  refused: ImportRefusal[];
};

export type ImportResult = {
  /** The applied workspace's sha, as its version row records it. */
  sha: string;
  versionId: number | null;
  counts: ApplyResult['counts'];
  changes: ApplyResult['changes'];
  errors: ApplyResult['errors'];
  warnings: ApplyResult['warnings'];
};

export class WorkspaceImportError extends Error {
  constructor(public readonly code: 'BLOCKED' | 'INVALID' | 'REFUSED' | 'CHANGED' | 'BUSY', message: string) {
    super(message);
    this.name = 'WorkspaceImportError';
  }
}

/** Imports in flight in this process, by project: one at a time per workspace. */
const importing = new Set<string>();

/**
 * Stage the upload against this workspace and dry-run it. Writes nothing.
 * @param orgId - The workspace importing.
 * @param upload - The zip.
 * @param opts - Merge or replace.
 */
export async function previewImport(orgId: string, upload: Uint8Array, opts: ImportOptions = {}): Promise<ImportPreview> {
  const replace = opts.replace === true;
  const incoming = readUpload(upload);
  const staged = await stagedFiles(orgId, incoming, replace);
  const blockedBy = await importBlockedBy(orgId);
  return withStagedWorkspace(staged.files, async (dir) => {
    const review = await reviewStaged(orgId, dir, staged);
    const changes = review.dry.changes.filter(c => c.outcome !== 'unchanged');
    return {
      sha: review.sha,
      replace,
      fileCount: incoming.length,
      counts: review.dry.counts,
      changes,
      unchanged: review.dry.changes.length - changes.length,
      errors: review.dry.errors,
      warnings: [...review.warnings, ...review.dry.warnings],
      blockedBy,
      refused: review.refused,
    };
  });
}

/**
 * Stage the same upload again and apply it, when the review of it now is still
 * the review that was read.
 * @param orgId - The workspace importing.
 * @param upload - The zip.
 * @param opts - Merge or replace, the reviewed sha, and who is importing.
 * @param opts.replace - The upload is the whole workspace.
 * @param opts.sha - The sha the preview returned.
 * @param opts.appliedBy - Who, for the version history.
 */
export async function applyImport(orgId: string, upload: Uint8Array, opts: ImportOptions & { sha: string; appliedBy: string }): Promise<ImportResult> {
  const blockedBy = await importBlockedBy(orgId);
  if (blockedBy) {
    throw new WorkspaceImportError('BLOCKED', blockedBy);
  }
  if (importing.has(orgId)) {
    throw new WorkspaceImportError('BUSY', 'Another import into this workspace is running. Try again when it has finished.');
  }
  importing.add(orgId);
  try {
    const replace = opts.replace === true;
    const staged = await stagedFiles(orgId, readUpload(upload), replace);
    return await withStagedWorkspace(staged.files, async (dir) => {
      const review = await reviewStaged(orgId, dir, staged);
      if (review.refused.length > 0) {
        throw new WorkspaceImportError('REFUSED', `The import sets what only an operator may: ${review.refused.map(r => `${r.resource} ${r.slug}: ${r.message}`).join(' ')}`);
      }
      if (review.sha !== opts.sha) {
        throw new WorkspaceImportError('CHANGED', 'This workspace changed since the import was reviewed, so the import would now do something else. Review it again.');
      }
      const result = await applyWorkspace(review.loaded, { orgId, appliedBy: opts.appliedBy, source: replace ? 'import (replace)' : 'import', keepSourceSchedules: review.keepSchedules });
      invalidateCurrentContextShaCache();
      // An apply rewrites the missions and skills the chips are made from.
      invalidateChipCache(orgId);
      return { sha: review.loaded.sha, versionId: result.versionId, counts: result.counts, changes: result.changes.filter(c => c.outcome !== 'unchanged'), errors: result.errors, warnings: result.warnings };
    });
  } finally {
    importing.delete(orgId);
  }
}

/**
 * Load a staged import, hold it to what an import may set, and dry-run it:
 * what the preview shows and what an apply checks again before writing.
 * @param orgId - The workspace importing.
 * @param dir - The staging folder.
 * @param staged - What was staged there, and for whom.
 */
async function reviewStaged(orgId: string, dir: string, staged: Staged) {
  const loaded = load(dir);
  // The manifest was made this workspace's own before staging; this holds the
  // mailbox to that on the values the applier will write, whatever form the
  // text took to say them.
  const address = loaded.manifest.mailbox?.address;
  if (address && address.toLowerCase() !== staged.target.mailboxAddress?.toLowerCase()) {
    throw new WorkspaceImportError('INVALID', `The import names the mailbox ${address}, which is not this workspace's. Leave mailbox.address out and this workspace keeps its own.`);
  }
  const rows = await sourceRows(orgId);
  pinSourceRows(loaded, rows, STORED_MANIFEST_DIR);
  const { refused, warnings } = await importRefusals(orgId, loaded, rows);
  const keepSchedules = schedulesTheAppSet(loaded, rows);
  const dry = await applyWorkspace(loaded, { orgId, dryRun: true, keepSourceSchedules: keepSchedules });
  return { loaded, dry, refused, warnings, keepSchedules, sha: reviewSha(staged.files, dry.changes) };
}

/**
 * The connectors whose sync schedules an import leaves as they are: those the
 * app added (no workspace file declared them, so the Connect page set their
 * schedule), where what is staged names no cadence of its own. An export
 * cannot carry such a schedule, so a staged connector without one says
 * nothing about it — and an apply reading that silence as "no schedule" would
 * stop the connector syncing.
 * @param loaded - The staged workspace.
 * @param rows - This workspace's connector rows.
 */
function schedulesTheAppSet(loaded: LoadedWorkspace, rows: ReadonlyArray<{ slug: string; configJson: Record<string, unknown> | null }>): Set<string> {
  const addedInTheApp = new Set(rows.filter(r => !isDeclaredInWorkspaceFile(r.configJson)).map(r => r.slug));
  return new Set(loaded.sources.filter(s => addedInTheApp.has(s.slug) && s.schedule === undefined && s.reconcileSchedule === undefined).map(s => s.slug));
}

/**
 * The review's sha: every staged file by its path and bytes, then every change
 * the review lists. The workspace's own sha leaves out what its runs do not
 * read (pages, the brand and its logos), and says nothing about the workspace
 * the files land in; this covers both.
 * @param files - What was staged.
 * @param changes - The dry run's outcomes.
 */
function reviewSha(files: readonly ExportFile[], changes: ApplyResult['changes']): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(file.path).update('\0').update(file.encoding).update('\0').update(file.content).update('\0');
  }
  hash.update(canonical(changes.filter(c => c.outcome !== 'unchanged')));
  return `review-${hash.digest('hex').slice(0, 16)}`;
}

/**
 * Why this workspace cannot take an import, or null when it can. An import
 * lands in the database; a workspace applied from a folder or from git would
 * have it undone by its next apply, which would be a silent loss.
 * @param orgId - The workspace.
 */
export async function importBlockedBy(orgId: string): Promise<string | null> {
  if (await ownWorkspaceFolder(orgId)) {
    return 'This workspace is applied from its folder on this host, so its next apply would undo an import. Put the files in that folder and apply it.';
  }
  const applied = await getCurrentWorkspaceVersion(orgId);
  if (applied && isDeployManaged({ writable: true, appliedBy: applied.appliedBy })) {
    return `This workspace is applied from git (last by ${applied.appliedBy}), so its next deploy would undo an import. Commit the files to its repository instead.`;
  }
  return null;
}

/**
 * The upload's files, less the report an export carries at its root.
 * @param upload - The zip.
 */
function readUpload(upload: Uint8Array): ExportFile[] {
  return readWorkspaceArchive(upload).filter(f => f.path !== EXPORT_REPORT_FILE);
}

/**
 * Load a staged folder, turning a workspace that does not load into an error
 * a person can act on — the loader's message names the file and the fault.
 * @param dir - The staged folder.
 */
function load(dir: string): ReturnType<typeof loadWorkspace> {
  try {
    return loadWorkspace(dir);
  } catch (error) {
    const text = (error instanceof Error ? error.message : String(error)).split(dir + sep).join('');
    throw new WorkspaceImportError('INVALID', `The import does not load as a workspace: ${text}`);
  }
}

async function sourceRows(orgId: string) {
  return db.select({ slug: knowledgeSourceSchema.slug, configJson: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId));
}

/** What was staged for an import, and the workspace it is for. */
type Staged = { files: ExportFile[]; target: Target };

/**
 * The files to stage: the upload alone (replace), or the upload laid over this
 * workspace as it runs now (merge). Either way the manifest is made this
 * workspace's own (`orgId`).
 * @param orgId - The workspace importing.
 * @param incoming - The upload's files.
 * @param replace - Replace rather than merge.
 */
async function stagedFiles(orgId: string, incoming: readonly ExportFile[], replace: boolean): Promise<Staged> {
  const [project] = await db.select({ id: projectSchema.id, mailboxAddress: projectSchema.mailboxAddress }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  const target: Target = project ?? { id: orgId, mailboxAddress: null };
  if (replace) {
    return { files: incoming.map(f => (isManifest(f.path) ? textFile(f.path, ownManifest(text(f), target)) : f)), target };
  }
  const current = (await exportWorkspace(orgId)).files.filter(f => f.path !== EXPORT_REPORT_FILE);
  return { files: mergeWorkspaceFiles(current, incoming, target), target };
}

/** The workspace an import lands in, as its manifest is made its own. */
type Target = { id: string; mailboxAddress: string | null };

/**
 * The upload laid over the current workspace, resource by resource.
 *
 * A resource the upload declares replaces the current one with the same slug
 * wherever either keeps its file, so the two never both declare it. Everything
 * else is overlaid by path, the upload winning. The manifest and the trust
 * rules merge key by key ({@link upsertMerge}); the manifest is this
 * workspace's own afterwards.
 * @param current - This workspace as it runs now.
 * @param incoming - The upload.
 * @param target - This workspace.
 */
function mergeWorkspaceFiles(current: readonly ExportFile[], incoming: readonly ExportFile[], target: Target): ExportFile[] {
  const merged = new Map(current.map(f => [f.path, f]));
  const theirs = declaredResources(current);
  for (const [key, files] of declaredResources(incoming)) {
    if (theirs.has(key)) {
      for (const path of theirs.get(key)!) {
        if (!files.includes(path)) {
          merged.delete(path);
        }
      }
    }
  }
  for (const file of incoming) {
    const existing = merged.get(file.path);
    if (existing && isManifest(file.path)) {
      merged.set(file.path, textFile(file.path, mergeYaml(text(existing), text(file), target.id)));
    } else if (existing && isTrust(file.path)) {
      merged.set(file.path, textFile(file.path, mergeYaml(text(existing), text(file), null)));
    } else {
      merged.set(file.path, file);
    }
  }
  // A top-level file under the other spelling from the one already here
  // (`workspace.yml` over `workspace.yaml`): the loader reads one spelling
  // only, so the two become the upload's, merged where they merge.
  for (const [yaml, yml, merges] of [['workspace.yaml', 'workspace.yml', true], ['trust.yaml', 'trust.yml', true], ['voice.yaml', 'voice.yml', false], ['operating-intent.yaml', 'operating-intent.yml', false]] as const) {
    if (!merged.has(yaml) || !merged.has(yml)) {
      continue;
    }
    const [keep, drop] = incoming.some(f => f.path === yml) ? [yml, yaml] : [yaml, yml];
    if (merges) {
      merged.set(keep, textFile(keep, mergeYaml(text(merged.get(drop)!), text(merged.get(keep)!), isManifest(keep) ? target.id : null)));
    }
    merged.delete(drop);
  }
  for (const name of MANIFEST_FILES) {
    const file = merged.get(name);
    if (file) {
      merged.set(name, textFile(name, ownManifest(text(file), target)));
    }
  }
  return [...merged.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Two YAML documents merged as an upsert ({@link upsertMerge}), the second
 * winning, with `orgId` set to this workspace's when one is given. When the
 * result says exactly what one side's text says, that text is kept, comments
 * and all.
 * @param currentText - What is here.
 * @param incomingText - What the upload says.
 * @param orgId - This workspace, for a manifest; null for any other file.
 */
function mergeYaml(currentText: string, incomingText: string, orgId: string | null): string {
  const current = yamlOrNull(currentText);
  const incoming = yamlOrNull(incomingText);
  if (!incoming) {
    // The upload's file does not parse; stage it as it is and let the load say so.
    return incomingText;
  }
  if (!current) {
    return incomingText;
  }
  const withOrg = (v: Record<string, unknown>) => (orgId ? { ...v, orgId } : v);
  const merged = withOrg(upsertMerge(current, incoming) as Record<string, unknown>);
  if (canonical(merged) === canonical(withOrg(incoming))) {
    return incomingText;
  }
  if (canonical(merged) === canonical(withOrg(current))) {
    return currentText;
  }
  return stringifyYaml(merged, { lineWidth: 0 });
}

/**
 * Upsert two parsed YAML values, `incoming` winning:
 *   - maps merge key by key, keeping what only `current` has;
 *   - lists of plain values gain what `incoming` adds, in order;
 *   - lists of maps that all name what they are about (`action`, `kind`,
 *     `slug`, `name`, `key`) merge item by item on that;
 *   - anything else is `incoming`'s.
 * @param current - What is here.
 * @param incoming - What the upload says.
 */
export function upsertMerge(current: unknown, incoming: unknown): unknown {
  if (isMap(current) && isMap(incoming)) {
    const out: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      out[key] = key in current ? upsertMerge(current[key], value) : value;
    }
    return out;
  }
  if (Array.isArray(current) && Array.isArray(incoming)) {
    if ([...current, ...incoming].every(v => v === null || typeof v !== 'object')) {
      const seen = new Set(current.map(v => canonical(v)));
      return [...current, ...incoming.filter(v => !seen.has(canonical(v)))];
    }
    const id = ['action', 'kind', 'slug', 'name', 'key'].find(k => [...current, ...incoming].every(v => isMap(v) && typeof v[k] === 'string'));
    if (id) {
      const byId = new Map<string, unknown>(current.map(v => [(v as Record<string, string>)[id]!, v]));
      for (const v of incoming) {
        const k = (v as Record<string, string>)[id]!;
        byId.set(k, byId.has(k) ? upsertMerge(byId.get(k), v) : v);
      }
      return [...byId.values()];
    }
  }
  return incoming;
}

/**
 * The manifest made this workspace's own: `orgId` set, and a mailbox address
 * that is not this workspace's replaced by the one it has — or dropped when it
 * has none, so the mailbox takes this workspace's own `<slug>@<mail domain>`.
 * The address belongs to the workspace the export came from, and two
 * workspaces must not answer one mailbox. Everything else as authored.
 * @param manifestText - The manifest.
 * @param target - This workspace.
 * @param target.id - Its id.
 * @param target.mailboxAddress - Its mailbox address, if it has one.
 */
function ownManifest(manifestText: string, target: Target): string {
  let doc: Document = parseDocument(manifestText);
  if (doc.errors.length > 0) {
    return manifestText;
  }
  // Read the way the loader will: anchors and aliases expanded. Reading the
  // text's nodes instead misses an address reached through an alias.
  let value: unknown;
  try {
    value = doc.toJS();
  } catch {
    return manifestText;
  }
  if (!isMap(value)) {
    return manifestText;
  }
  const address = isMap(value.mailbox) ? value.mailbox.address : undefined;
  const foreignAddress = typeof address === 'string' && address.toLowerCase() !== target.mailboxAddress?.toLowerCase();
  if (value.orgId === target.id && !foreignAddress) {
    return manifestText;
  }
  if (foreignAddress && doc.getIn(['mailbox', 'address']) !== address) {
    // The text says it through an alias or a merge key, which an edit of its
    // nodes would not reach: write the expanded value instead, so the edit
    // lands on what the loader reads. Its comments go; its meaning stays.
    // Without `aliasDuplicateObjects: false` the shared value would be
    // written as an anchor and an alias again.
    doc = new Document(value, { aliasDuplicateObjects: false });
  }
  doc.set('orgId', target.id);
  if (foreignAddress && target.mailboxAddress) {
    doc.setIn(['mailbox', 'address'], target.mailboxAddress);
  } else if (foreignAddress) {
    doc.deleteIn(['mailbox', 'address']);
  }
  return doc.toString({ lineWidth: 0 });
}

function isMap(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isManifest(path: string): boolean {
  return (MANIFEST_FILES as readonly string[]).includes(path);
}

function isTrust(path: string): boolean {
  return path === 'trust.yaml' || path === 'trust.yml';
}
