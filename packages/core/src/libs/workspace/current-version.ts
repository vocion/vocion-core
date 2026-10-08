import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { workspaceVersionSchema } from '@/models/Schema';

/** The last applied version's facts a caller needs — its sha and where it came from. */
export type AppliedWorkspaceVersion = {
  sha: string;
  /** The folder it was applied from, as the applier recorded it; null on rows older than the column. */
  sourcePath: string | null;
  /** The project it was applied to, when recorded (the column is nullable — Phase 1). */
  projectId: string | null;
  appliedAt: Date;
  /** Who applied — `ui-drift-banner`, `user:<id>`, the CLI's `--applied-by`, or a pipeline's name. */
  appliedBy: string | null;
};

type Cached = { version: AppliedWorkspaceVersion | null; cachedAt: number };

const CACHE_TTL_MS = 60_000;
/**
 * One entry per org. A host serves several companies, and a single-entry
 * cache thrashed between them: every rollup recompute of one org evicted the
 * other's reading. Bounded so a long-lived process cannot grow it without end.
 */
const CACHE_MAX_ORGS = 500;
const cache = new Map<string, Cached>();

/**
 * The most recent applied workspace version for an org — sha, source folder,
 * project. Null when nothing has been applied yet.
 *
 * Cached for 60s per org — applies are infrequent (manual dev loop or CI),
 * and every skill run hitting the DB for this would be wasteful. The cache is
 * per-process; across processes, staleness is bounded by CACHE_TTL_MS.
 * @param orgId
 */
export async function getCurrentWorkspaceVersion(orgId: string): Promise<AppliedWorkspaceVersion | null> {
  const now = Date.now();
  const hit = cache.get(orgId);
  if (hit && now - hit.cachedAt < CACHE_TTL_MS) {
    return hit.version;
  }

  const [latest] = await db
    .select({ sha: workspaceVersionSchema.sha, sourcePath: workspaceVersionSchema.sourcePath, projectId: workspaceVersionSchema.projectId, appliedAt: workspaceVersionSchema.appliedAt, appliedBy: workspaceVersionSchema.appliedBy })
    .from(workspaceVersionSchema)
    .where(and(
      eq(workspaceVersionSchema.orgId, orgId),
      eq(workspaceVersionSchema.status, 'applied'),
    ))
    .orderBy(desc(workspaceVersionSchema.appliedAt))
    .limit(1);

  const version = latest ? { sha: latest.sha, sourcePath: latest.sourcePath ?? null, projectId: latest.projectId ?? null, appliedAt: latest.appliedAt, appliedBy: latest.appliedBy ?? null } : null;
  // Only a found version is worth caching: a first apply should be seen at once.
  if (version) {
    cache.delete(orgId);
    if (cache.size >= CACHE_MAX_ORGS) {
      cache.delete(cache.keys().next().value!);
    }
    cache.set(orgId, { version, cachedAt: now });
  }
  return version;
}

/**
 * Look up the most recent applied context SHA for an org.
 *
 * Returns null if no version has been applied yet — callers should tolerate
 * that gracefully (store null in skill_run.workspace_sha).
 * @param orgId
 */
export async function getCurrentWorkspaceSha(orgId: string): Promise<string | null> {
  return (await getCurrentWorkspaceVersion(orgId))?.sha ?? null;
}

/**
 * Readings derived from what was applied (whose folder is whose), kept for a
 * moment and dropped with the version cache, so an apply is seen at once.
 */
const derived = new Map<string, { at: number; value: Promise<unknown> }>();

/**
 * Reuse a reading derived from the applied versions for `ttlMs`, until the
 * next apply clears it ({@link invalidateCurrentContextShaCache}). A reading
 * that fails is not kept.
 * @param key - What was read, including every input it depends on.
 * @param ttlMs - How long to reuse it.
 * @param read - Reads it fresh.
 */
export function memoUntilNextApply<T>(key: string, ttlMs: number, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = derived.get(key);
  if (hit && now - hit.at < ttlMs) {
    return hit.value as Promise<T>;
  }
  const value = read();
  derived.delete(key);
  if (derived.size >= CACHE_MAX_ORGS * 4) {
    derived.delete(derived.keys().next().value!);
  }
  derived.set(key, { at: now, value });
  value.catch(() => {
    if (derived.get(key)?.value === value) {
      derived.delete(key);
    }
  });
  return value;
}

export function invalidateCurrentContextShaCache(): void {
  cache.clear();
  derived.clear();
}

/**
 * Every spelling a folder may have been recorded under: as given, resolved,
 * and with its symlinks followed (a deploy mounts a checkout through a link).
 * @param path - The folder, absolute or repo-relative.
 */
export function folderSpellings(path: string): string[] {
  const abs = fromRepoRoot(path);
  const spellings = [path, abs, resolve(abs)];
  try {
    spellings.push(realpathSync.native(abs));
  } catch { /* the folder may be gone; the recorded spelling still counts */ }
  return [...new Set(spellings)];
}

/**
 * The project a folder was most recently applied to, by the source folder
 * the applier recorded — whichever project that was. Null when no apply
 * records this folder.
 * @param path - The folder, absolute or repo-relative.
 */
export async function folderLastAppliedTo(path: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: workspaceVersionSchema.orgId })
    .from(workspaceVersionSchema)
    .where(and(eq(workspaceVersionSchema.status, 'applied'), inArray(workspaceVersionSchema.sourcePath, folderSpellings(path))))
    .orderBy(desc(workspaceVersionSchema.appliedAt))
    .limit(1);
  return row?.orgId ?? null;
}

/**
 * Whether any apply to this org came from this folder — what makes a folder
 * an org's own to read from, whatever else is mounted on the host.
 * @param orgId - The org.
 * @param path - The folder, absolute or repo-relative.
 */
export async function orgWasAppliedFrom(orgId: string, path: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaceVersionSchema.id })
    .from(workspaceVersionSchema)
    .where(and(eq(workspaceVersionSchema.orgId, orgId), inArray(workspaceVersionSchema.sourcePath, folderSpellings(path))))
    .limit(1);
  return row !== undefined;
}
