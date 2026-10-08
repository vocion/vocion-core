/**
 * WorkspaceFileService — a project's workspace files, in the database.
 *
 * Each apply stores what `libs/workspace/snapshot.ts` collects from the folder
 * it applied: skill and playbook bodies with their resources, pages, the brand
 * and its logos, and the files the source panels show. Every runtime read asks
 * here first, so a project reads its OWN workspace on a host that has no
 * folder for it — Vocion Cloud, a shared host whose `WORKSPACE_PATH` is another
 * project's, or a sample applied from `templates/` while `WORKSPACE_PATH`
 * pointed somewhere else.
 *
 * The rule a reader follows, in one place ({@link StoredFiles.stored}):
 *   - a project with stored files reads them and nothing else — a file it
 *     does not hold is absent, never borrowed from the mounted folder, which
 *     may be another project's;
 *   - a project with none (never applied since the store existed) reads its
 *     OWN folder on this host as before ({@link ownWorkspaceFolder}): the one
 *     on `WORKSPACE_PATH` when the applier's record says it is this
 *     project's, else the folder beside it named for the project. A project
 *     with neither — a personal workspace seeded without an apply, a project
 *     an operator created by script — reads no folder at all, rather than the
 *     mounted company's. That is the fallback, and the next apply retires it.
 *
 * A read of the store that fails (a deploy serving before the table's
 * migration ran, a passing database error) is logged and answered as
 * "nothing stored", so the reader falls back as above instead of failing the
 * page or the agent's turn.
 *
 * The applier is the only writer, and it replaces the whole set: a file
 * deleted from the workspace is deleted here on the next apply, the same way
 * its rows are retired. Text is stored as authored; `{{env.NAME}}` tokens
 * resolve on the way out (`libs/workspace/template-vars.ts`), so apply time
 * and run time agree on the bytes and no per-host value is written down. A
 * file that is not text is stored base64 and read back as reading it off the
 * folder as UTF-8 gave ({@link storedText}).
 */

import type { SQL } from 'drizzle-orm';
import type { PrimitiveFilesResult, PrimitiveKind } from '@/libs/workspace/reader';
import type { CollectedFile, WorkspaceFileEncoding } from '@/libs/workspace/snapshot';
import type { TourManifest } from '@/libs/workspace/tour';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { fromRepoRoot } from '@/libs/repo-root';
import { BRAND_FILES, brandLogoRefs, loadBrand, logoMimeType, logoRefPath, readWorkspaceBrand } from '@/libs/workspace/brand';
import { getWorkspacePath, primitiveFilesFrom, primitiveWorkspaceFiles, readPrimitiveFiles, storedTree, WORKSPACE_SLUG_PATTERN } from '@/libs/workspace/reader';
import { MANIFEST_FILES } from '@/libs/workspace/snapshot';
import { substituteEnvTokens } from '@/libs/workspace/template-vars';
import { parseTour, readWorkspaceTour, TOUR_FILES } from '@/libs/workspace/tour';
import { workspaceFileSchema } from '@/models/Schema';
import { mountedWorkspaceIsProjects, projectPagesFolder } from '@/services/WorkspaceMountService';

export type StoredFile = {
  path: string;
  content: string;
  encoding: WorkspaceFileEncoding;
  sha: string;
  workspaceSha: string | null;
};

/** What one read of the store answers. */
export type StoredFiles = {
  /**
   * Whether this project's workspace is stored at all — true once an apply
   * has written it. When true, `files` is the whole answer.
   */
  stored: boolean;
  /** The files asked for that the project holds, by path. */
  files: Map<string, StoredFile>;
};

/**
 * A stored file's text: as stored, or — for a file stored base64 because it
 * is not text — its bytes read as UTF-8, which is what reading it off the
 * folder gave. A logo is read as bytes by the brand reader instead.
 * @param file - The stored file.
 */
export function storedText(file: Pick<StoredFile, 'content' | 'encoding'>): string {
  return file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content;
}

/**
 * Files at exact paths, in one query, plus whether the project is stored.
 * @param orgId - The project.
 * @param paths - Paths inside the workspace folder, `/`-separated.
 */
export async function readStoredFiles(orgId: string, paths: readonly string[]): Promise<StoredFiles> {
  const wanted = [...new Set(paths)];
  return readStore(orgId, wanted.length > 0 ? inArray(workspaceFileSchema.path, wanted) : undefined, path => wanted.includes(path));
}

/**
 * Every file under a folder (`pages/`, `skills/<slug>/`), in one query, plus
 * whether the project is stored.
 * @param orgId - The project.
 * @param prefix - A folder path ending in `/`.
 * @param extensions - Only files ending in one of these (`.yaml`), when given.
 */
export async function listStoredFiles(orgId: string, prefix: string, extensions?: readonly string[]): Promise<StoredFiles> {
  const under = and(
    sql`starts_with(${workspaceFileSchema.path}, ${prefix})`,
    extensions && extensions.length > 0 ? or(...extensions.map(ext => sql`right(${workspaceFileSchema.path}, ${ext.length}) = ${ext}`)) : undefined,
  );
  return readStore(orgId, under, path => path.startsWith(prefix) && (!extensions || extensions.length === 0 || extensions.some(ext => path.endsWith(ext))));
}

/**
 * One read of the store: the files `asked` matches, with their content, and
 * the manifest row's path alone — which says whether the project is stored
 * without carrying workspace.yaml's text on every read. A read that fails is
 * logged and answered as nothing stored (see the module header).
 * @param orgId - The project.
 * @param asked - Which rows the caller wants, or undefined for none.
 * @param keep - The same filter, applied to the rows that come back.
 */
async function readStore(orgId: string, asked: SQL | undefined, keep: (path: string) => boolean): Promise<StoredFiles> {
  const manifest = inArray(workspaceFileSchema.path, [...MANIFEST_FILES]);
  let rows: Array<Omit<StoredFile, 'encoding'> & { encoding: string }>;
  try {
    rows = await db
      .select({
        path: workspaceFileSchema.path,
        content: asked ? sql<string>`case when ${asked} then ${workspaceFileSchema.content} else '' end` : sql<string>`''`,
        encoding: workspaceFileSchema.encoding,
        sha: workspaceFileSchema.sha,
        workspaceSha: workspaceFileSchema.workspaceSha,
      })
      .from(workspaceFileSchema)
      .where(and(eq(workspaceFileSchema.orgId, orgId), asked ? or(asked, manifest) : manifest));
  } catch (error) {
    logger.warn('the project\'s stored workspace files could not be read; reading it as a project with nothing stored', {
      orgId,
      error: error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message.split('\n')[0]) : String(error),
    });
    return { stored: false, files: new Map() };
  }
  const stored = rows.some(r => (MANIFEST_FILES as readonly string[]).includes(r.path));
  const files = new Map<string, StoredFile>();
  for (const row of rows) {
    if (keep(row.path)) {
      files.set(row.path, { ...row, encoding: row.encoding === 'base64' ? 'base64' : 'utf8' });
    }
  }
  return { stored, files };
}

/**
 * Every file the project has stored, with its content — what an export
 * starts from (`WorkspaceExportService.ts`). Unlike the readers above, a
 * failed read throws: an export that quietly left out the stored files would
 * hand over a workspace with no skill bodies and no pages.
 * @param orgId - The project.
 */
export async function readAllStoredFiles(orgId: string): Promise<StoredFile[]> {
  const rows = await db
    .select({
      path: workspaceFileSchema.path,
      content: workspaceFileSchema.content,
      encoding: workspaceFileSchema.encoding,
      sha: workspaceFileSchema.sha,
      workspaceSha: workspaceFileSchema.workspaceSha,
    })
    .from(workspaceFileSchema)
    .where(eq(workspaceFileSchema.orgId, orgId));
  return rows.map(r => ({ ...r, encoding: r.encoding === 'base64' ? 'base64' : 'utf8' }));
}

/**
 * The folder on this host that is the project's own, for a project with
 * nothing stored: the one on `WORKSPACE_PATH` when the applier's record says
 * it is this project's (`mounted: true` — the only folder an in-app edit can
 * write), else the folder beside it named for the project
 * (`projectPagesFolder`), else null. Never the mounted folder of another
 * project.
 * @param orgId - The project.
 */
export async function ownWorkspaceFolder(orgId: string): Promise<{ path: string; mounted: boolean } | null> {
  const mounted = getWorkspacePath();
  if (mounted && await mountedWorkspaceIsProjects(orgId).catch(() => false)) {
    return { path: mounted, mounted: true };
  }
  const beside = await projectPagesFolder(orgId).catch(() => null);
  return beside ? { path: beside, mounted: false } : null;
}

/** Rows per INSERT, at most — far under Postgres's parameter limit. */
const BATCH_ROWS = 200;

/**
 * Content per INSERT, about. A stored file may run to 5 MB, so a batch counted
 * by rows alone could near Postgres's 1 GB message limit, and spike PGlite's
 * memory long before that.
 */
const BATCH_BYTES = 8 * 1024 * 1024;

/**
 * The files an apply writes, split into INSERT statements by row count and by
 * size: each batch holds at most {@link BATCH_ROWS} rows and about
 * {@link BATCH_BYTES} of content — one file larger than that goes alone.
 * @param files - The files to write, in order.
 */
export function storeBatches<T extends Pick<CollectedFile, 'content'>>(files: readonly T[]): T[][] {
  const out: T[][] = [];
  let batch: T[] = [];
  let bytes = 0;
  for (const file of files) {
    if (batch.length > 0 && (batch.length >= BATCH_ROWS || bytes + file.content.length > BATCH_BYTES)) {
      out.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(file);
    bytes += file.content.length;
  }
  if (batch.length > 0) {
    out.push(batch);
  }
  return out;
}

/**
 * Why the database refused a row, in one line — never the query text, which
 * carries the file's content as a parameter.
 * @param error - What the insert threw.
 */
function refusal(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.startsWith('Failed query') ? 'the database refused it' : (message.split('\n')[0] ?? '').slice(0, 200);
}

/**
 * Make the project's stored files exactly `files`: insert what is new, rewrite
 * what changed (by sha), delete what the workspace no longer has. One
 * transaction, so a reader never sees half of one apply and half of another.
 * Called by the applier, and only by it.
 *
 * A file the database refuses costs that file, not the set: its batch is
 * retried a file at a time under a savepoint, and each refusal comes back in
 * `failed` for the apply's warnings. A refused file's previous row is removed
 * with the rest of what this apply did not store, so no reader is handed a
 * body older than the apply its run is stamped with.
 * @param orgId - The project the apply wrote.
 * @param files - What the apply collected.
 * @param workspaceSha - The apply's workspace sha, stamped on each row it writes.
 * @returns How many rows were written and removed, and each file refused with why.
 */
export async function replaceStoredFiles(orgId: string, files: readonly CollectedFile[], workspaceSha: string): Promise<{ written: number; removed: number; failed: Array<{ path: string; reason: string }> }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ path: workspaceFileSchema.path, sha: workspaceFileSchema.sha, encoding: workspaceFileSchema.encoding })
      .from(workspaceFileSchema)
      .where(eq(workspaceFileSchema.orgId, orgId));
    const had = new Map(existing.map(r => [r.path, r]));
    const changed = files.filter((f) => {
      const prior = had.get(f.path);
      return !prior || prior.sha !== f.sha || prior.encoding !== f.encoding;
    });
    const upsert = (run: typeof tx, rows: readonly CollectedFile[]) => run
      .insert(workspaceFileSchema)
      .values(rows.map(f => ({ orgId, path: f.path, content: f.content, encoding: f.encoding, sha: f.sha, workspaceSha })))
      .onConflictDoUpdate({
        target: [workspaceFileSchema.orgId, workspaceFileSchema.path],
        set: {
          content: sql`excluded.content`,
          encoding: sql`excluded.encoding`,
          sha: sql`excluded.sha`,
          workspaceSha: sql`excluded.workspace_sha`,
          updatedAt: new Date(),
        },
      });
    const failed: Array<{ path: string; reason: string }> = [];
    for (const batch of storeBatches(changed)) {
      try {
        await tx.transaction(async (sp) => {
          await upsert(sp, batch);
        });
      } catch {
        for (const file of batch) {
          try {
            await tx.transaction(async (sp) => {
              await upsert(sp, [file]);
            });
          } catch (error) {
            failed.push({ path: file.path, reason: refusal(error) });
          }
        }
      }
    }
    const refused = new Set(failed.map(f => f.path));
    const keep = files.map(f => f.path).filter(path => !refused.has(path));
    const removed = await tx
      .delete(workspaceFileSchema)
      .where(and(
        eq(workspaceFileSchema.orgId, orgId),
        ...(keep.length > 0 ? [notInArray(workspaceFileSchema.path, keep)] : []),
      ))
      .returning({ id: workspaceFileSchema.id });
    return { written: changed.length - failed.length, removed: removed.length, failed };
  });
}

/**
 * The project's brand guide (`brand.yaml` and the logos it names), from its
 * stored workspace, or — when nothing is stored for it yet — from its own
 * folder ({@link ownWorkspaceFolder}), and no brand when this host has none.
 * Same parse, same issues, either way (`libs/workspace/brand.ts`).
 * @param orgId - The project.
 */
export async function readBrandForOrg(orgId: string): Promise<ReturnType<typeof readWorkspaceBrand>> {
  const { stored, files } = await readStoredFiles(orgId, BRAND_FILES);
  if (!stored) {
    const own = await ownWorkspaceFolder(orgId);
    return own ? readWorkspaceBrand(own.path) : { brand: null, issues: [] };
  }
  const path = BRAND_FILES.find(name => files.has(name));
  if (!path) {
    return { brand: null, issues: [] };
  }
  const read = () => substituteEnvTokens(storedText(files.get(path)!), path);
  let refs: string[] = [];
  try {
    refs = brandLogoRefs(read()).map(logoRefPath).filter((p): p is string => p !== null);
  } catch {
    // An unresolvable token: loadBrand reads it again and reports it.
  }
  const logos = refs.length > 0 ? (await readStoredFiles(orgId, refs)).files : new Map<string, StoredFile>();
  return loadBrand({
    file: path,
    read,
    logo: (ref) => {
      const at = logoRefPath(ref);
      const file = at ? logos.get(at) : undefined;
      const mime = at ? logoMimeType(at) : undefined;
      if (!file || !mime) {
        return undefined;
      }
      return `data:${mime};base64,${file.encoding === 'base64' ? file.content : Buffer.from(file.content, 'utf8').toString('base64')}`;
    },
  });
}

/**
 * The files behind a primitive's page — the source panel on an agent, a
 * mission, a workflow, an object type, a connector, a team — from the
 * project's stored workspace, or, before its first apply stored one, from its
 * own folder on this host ({@link ownWorkspaceFolder}); with neither, only the
 * inherited layer the base pack ships. Only this primitive's files are read.
 *
 * A file is editable only where this host has the project's own folder
 * mounted on `WORKSPACE_PATH`, since an edit writes that folder and applies;
 * anywhere else it is shown read-only and named by its path in the workspace
 * repo.
 * @param orgId - The project.
 * @param kind - The primitive kind.
 * @param slug - The primitive's slug.
 */
export async function readPrimitiveFilesForOrg(orgId: string, kind: PrimitiveKind, slug: string): Promise<PrimitiveFilesResult | null> {
  if (!WORKSPACE_SLUG_PATTERN.test(slug)) {
    return null;
  }
  const where = primitiveWorkspaceFiles(kind, slug);
  const { stored, files } = 'paths' in where ? await readStoredFiles(orgId, where.paths) : await listStoredFiles(orgId, where.prefix);
  if (!stored) {
    const own = await ownWorkspaceFolder(orgId);
    return own ? readPrimitiveFiles(kind, slug, own.path, own.mounted) : primitiveFilesFrom(kind, slug, null, null);
  }
  const editable = await mountedWorkspaceIsProjects(orgId).catch(() => false);
  const tree = storedTree(new Map([...files].map(([path, file]) => [path, storedText(file)])));
  return primitiveFilesFrom(kind, slug, tree, editable ? getWorkspacePath() : null);
}

/**
 * The project's guided tour (`pages/tour.yaml`), from its stored workspace,
 * or — before its first apply stored one — from its own folder, and none when
 * this host has no folder of the project's. Never throws: a tour that cannot
 * be read hides the launcher, logged (`libs/workspace/tour.ts`).
 * @param orgId - The project.
 */
export async function readTourForOrg(orgId: string): Promise<TourManifest | null> {
  const paths = TOUR_FILES.map(name => `pages/${name}`);
  const { stored, files } = await readStoredFiles(orgId, paths);
  if (!stored) {
    const own = await ownWorkspaceFolder(orgId);
    return own ? readWorkspaceTour(join(fromRepoRoot(own.path), 'pages')) : null;
  }
  const path = paths.find(p => files.has(p));
  return path ? parseTour(path, () => substituteEnvTokens(storedText(files.get(path)!), path)) : null;
}
