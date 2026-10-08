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
 *   - a project with none (never applied since the store existed) reads the
 *     folder exactly as it did before. That is the fallback, and the next
 *     apply retires it.
 *
 * The applier is the only writer, and it replaces the whole set: a file
 * deleted from the workspace is deleted here on the next apply, the same way
 * its rows are retired. Text is stored as authored; `{{env.NAME}}` tokens
 * resolve on the way out (`libs/workspace/template-vars.ts`), so apply time
 * and run time agree on the bytes and no per-host value is written down.
 */

import type { PrimitiveFilesResult, PrimitiveKind } from '@/libs/workspace/reader';
import type { CollectedFile, WorkspaceFileEncoding } from '@/libs/workspace/snapshot';
import { Buffer } from 'node:buffer';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { BRAND_FILES, brandLogoRefs, loadBrand, logoMimeType, logoRefPath, readWorkspaceBrand } from '@/libs/workspace/brand';
import { getWorkspacePath, primitiveFilesFrom, primitiveKindDir, readPrimitiveFiles, storedTree, WORKSPACE_SLUG_PATTERN } from '@/libs/workspace/reader';
import { MANIFEST_FILES } from '@/libs/workspace/snapshot';
import { substituteEnvTokens } from '@/libs/workspace/template-vars';
import { workspaceFileSchema } from '@/models/Schema';
import { mountedWorkspaceIsProjects } from '@/services/WorkspaceMountService';

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

/** The columns a read returns — built per call, so importing this module touches no table. */
function columns() {
  return {
    path: workspaceFileSchema.path,
    content: workspaceFileSchema.content,
    encoding: workspaceFileSchema.encoding,
    sha: workspaceFileSchema.sha,
    workspaceSha: workspaceFileSchema.workspaceSha,
  };
}

/**
 * Files at exact paths, in one query, plus whether the project is stored.
 * @param orgId - The project.
 * @param paths - Paths inside the workspace folder, `/`-separated.
 */
export async function readStoredFiles(orgId: string, paths: readonly string[]): Promise<StoredFiles> {
  const wanted = new Set(paths);
  const rows = await db
    .select(columns())
    .from(workspaceFileSchema)
    .where(and(eq(workspaceFileSchema.orgId, orgId), inArray(workspaceFileSchema.path, [...new Set([...paths, ...MANIFEST_FILES])])));
  return answer(rows, path => wanted.has(path));
}

/**
 * Every file under a folder (`pages/`, `agents/`), in one query, plus whether
 * the project is stored.
 * @param orgId - The project.
 * @param prefix - A folder path ending in `/`.
 * @param extensions - Only files ending in one of these (`.yaml`), when given.
 */
export async function listStoredFiles(orgId: string, prefix: string, extensions?: readonly string[]): Promise<StoredFiles> {
  const under = and(
    sql`starts_with(${workspaceFileSchema.path}, ${prefix})`,
    extensions && extensions.length > 0 ? or(...extensions.map(ext => sql`right(${workspaceFileSchema.path}, ${ext.length}) = ${ext}`)) : undefined,
  );
  const rows = await db
    .select(columns())
    .from(workspaceFileSchema)
    .where(and(eq(workspaceFileSchema.orgId, orgId), or(under, inArray(workspaceFileSchema.path, [...MANIFEST_FILES]))));
  return answer(rows, path => path.startsWith(prefix) && (!extensions || extensions.length === 0 || extensions.some(ext => path.endsWith(ext))));
}

function answer(rows: Array<Omit<StoredFile, 'encoding'> & { encoding: string }>, keep: (path: string) => boolean): StoredFiles {
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
 * Make the project's stored files exactly `files`: insert what is new, rewrite
 * what changed (by sha), delete what the workspace no longer has. One
 * transaction, so a reader never sees half of one apply and half of another.
 * Called by the applier, and only by it.
 * @param orgId - The project the apply wrote.
 * @param files - What the apply collected.
 * @param workspaceSha - The apply's workspace sha, stamped on each row it writes.
 * @returns How many rows were written and how many removed.
 */
export async function replaceStoredFiles(orgId: string, files: readonly CollectedFile[], workspaceSha: string): Promise<{ written: number; removed: number }> {
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
    // Batched: a workspace with many resources must not become one statement
    // past the parameter limit.
    for (let i = 0; i < changed.length; i += 200) {
      await tx
        .insert(workspaceFileSchema)
        .values(changed.slice(i, i + 200).map(f => ({ orgId, path: f.path, content: f.content, encoding: f.encoding, sha: f.sha, workspaceSha })))
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
    }
    const keep = files.map(f => f.path);
    const removed = await tx
      .delete(workspaceFileSchema)
      .where(and(
        eq(workspaceFileSchema.orgId, orgId),
        ...(keep.length > 0 ? [notInArray(workspaceFileSchema.path, keep)] : []),
      ))
      .returning({ id: workspaceFileSchema.id });
    return { written: changed.length, removed: removed.length };
  });
}

/**
 * The project's brand guide (`brand.yaml` and the logos it names), from its
 * stored workspace, or — when nothing is stored for it yet — from the folder,
 * as before. Same parse, same issues, either way (`libs/workspace/brand.ts`).
 * @param orgId - The project.
 */
export async function readBrandForOrg(orgId: string): Promise<ReturnType<typeof readWorkspaceBrand>> {
  const { stored, files } = await readStoredFiles(orgId, BRAND_FILES);
  if (!stored) {
    return readWorkspaceBrand();
  }
  const path = BRAND_FILES.find(name => files.has(name));
  if (!path) {
    return { brand: null, issues: [] };
  }
  const read = () => substituteEnvTokens(files.get(path)!.content, path);
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
 * project's stored workspace, or from the folder before its first apply
 * stored one.
 *
 * A stored file is editable only where this host has the project's own folder
 * mounted, since an edit writes the folder and applies; anywhere else it is
 * shown read-only and named by its path in the workspace repo.
 * @param orgId - The project.
 * @param kind - The primitive kind.
 * @param slug - The primitive's slug.
 */
export async function readPrimitiveFilesForOrg(orgId: string, kind: PrimitiveKind, slug: string): Promise<PrimitiveFilesResult | null> {
  if (!WORKSPACE_SLUG_PATTERN.test(slug)) {
    return null;
  }
  const { stored, files } = await listStoredFiles(orgId, `${primitiveKindDir(kind)}/`);
  if (!stored) {
    return readPrimitiveFiles(kind, slug);
  }
  const own = await mountedWorkspaceIsProjects(orgId).catch(() => false);
  const tree = storedTree(new Map([...files].map(([path, file]) => [path, file.content])));
  return primitiveFilesFrom(kind, slug, tree, own ? getWorkspacePath() : null);
}
