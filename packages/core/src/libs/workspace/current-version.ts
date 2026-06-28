import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceVersionSchema } from '@/models/Schema';

type Cached = { orgId: string; sha: string; cachedAt: number };

const CACHE_TTL_MS = 60_000;
let cache: Cached | null = null;

/**
 * Look up the most recent applied context SHA for an org.
 *
 * Cached for 60s — context applies are infrequent (manual dev loop or CI),
 * and every skill run hitting the DB for this would be wasteful. The cache
 * is per-process; across processes, staleness is bounded by CACHE_TTL_MS.
 *
 * Returns null if no version has been applied yet — callers should tolerate
 * that gracefully (store null in skill_run.workspace_sha).
 * @param orgId
 */
export async function getCurrentWorkspaceSha(orgId: string): Promise<string | null> {
  const now = Date.now();
  if (cache && cache.orgId === orgId && now - cache.cachedAt < CACHE_TTL_MS) {
    return cache.sha;
  }

  const [latest] = await db
    .select({ sha: workspaceVersionSchema.sha })
    .from(workspaceVersionSchema)
    .where(and(
      eq(workspaceVersionSchema.orgId, orgId),
      eq(workspaceVersionSchema.status, 'applied'),
    ))
    .orderBy(desc(workspaceVersionSchema.appliedAt))
    .limit(1);

  if (!latest) {
    return null;
  }

  cache = { orgId, sha: latest.sha, cachedAt: now };
  return latest.sha;
}

export function invalidateCurrentContextShaCache(): void {
  cache = null;
}
