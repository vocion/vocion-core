/**
 * SourceAccessService — per-connection ACL resolution.
 *
 * A source's `accessPolicy` is `{visibility: 'org' | 'restricted',
 * users: [emails]}` (null = org-wide). This service answers ONE question:
 * which source slugs may THIS member retrieve from? Enforcement is an
 * intersection at query time — the agent's configured scope ∩ the user's
 * grants — applied in chat (search_knowledge) and the Search page.
 *
 * Runs with no human in the loop (schedules, checks, e2e) don't call this;
 * the team keeps its configured access, and its OUTPUTS (briefs, proposals)
 * are the curated surface everyone sees.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema, userSchema } from '@/models/Schema';

/**
 * Source slugs the given user may retrieve from, across the whole org.
 * Unknown users get only org-visible sources.
 * @param orgId
 * @param userId
 */
export async function allowedSourceSlugsForUser(orgId: string, userId: string): Promise<string[]> {
  const [sources, [user]] = await Promise.all([
    db
      .select({ slug: knowledgeSourceSchema.slug, accessPolicy: knowledgeSourceSchema.accessPolicy })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.orgId, orgId)),
    db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1),
  ]);
  const email = user?.email?.toLowerCase() ?? null;

  return sources
    .filter((s) => {
      const policy = s.accessPolicy;
      if (!policy || policy.visibility !== 'restricted') {
        return true;
      }
      return email !== null && (policy.users ?? []).some(u => u.toLowerCase() === email);
    })
    .map(s => s.slug);
}
