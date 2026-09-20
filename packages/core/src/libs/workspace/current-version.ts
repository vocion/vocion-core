import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
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

type Cached = { orgId: string; version: AppliedWorkspaceVersion | null; cachedAt: number };

const CACHE_TTL_MS = 60_000;
let cache: Cached | null = null;

/**
 * The most recent applied workspace version for an org — sha, source folder,
 * project. Null when nothing has been applied yet.
 *
 * Cached for 60s — applies are infrequent (manual dev loop or CI), and every
 * skill run hitting the DB for this would be wasteful. The cache is
 * per-process; across processes, staleness is bounded by CACHE_TTL_MS.
 * @param orgId
 */
export async function getCurrentWorkspaceVersion(orgId: string): Promise<AppliedWorkspaceVersion | null> {
  const now = Date.now();
  if (cache && cache.orgId === orgId && now - cache.cachedAt < CACHE_TTL_MS) {
    return cache.version;
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
    cache = { orgId, version, cachedAt: now };
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

export function invalidateCurrentContextShaCache(): void {
  cache = null;
}
