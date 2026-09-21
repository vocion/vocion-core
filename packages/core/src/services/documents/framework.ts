/**
 * Where a document's framework CSS comes from.
 *
 * The house framework is a resource on a workspace skill —
 * `skills/<slug>/framework.css` — and it is found the same way the agent
 * finds the skill itself: by the catalog row, through `readByOrigin`, so a
 * `core` row reads the plugin's copy, an `override` row reads the
 * workspace's copy first, and a workspace-only skill reads only its own.
 * The look therefore stays the workspace's to change, by replacing one file.
 *
 * Discovery is by resource, not by slug: core does not know the proposals
 * plugin's skill names, and a workspace's document skill may be called
 * anything. Any skill that ships a `framework.css` is offering one. If more
 * than one does, the lowest slug wins and the choice is recorded on the
 * block — two frameworks concatenated would be worse than either, and a
 * workspace that wants a different one renames or overrides the skill.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { injectFramework, stripFramework } from '@/libs/documents/framework';
import { logger } from '@/libs/Logger';
import { playbookSchema } from '@/models/Schema';
import { readByOrigin } from '@/services/playbooks/mount';

export const FRAMEWORK_FILE = 'framework.css';

export type DocumentFramework = { slug: string; css: string };

/**
 * The framework this workspace's documents are built on, or null when no
 * skill ships one (a workspace with no document skill renders exactly what
 * the model wrote, as it always did).
 * @param orgId - The project.
 */
export async function frameworkFor(orgId: string): Promise<DocumentFramework | null> {
  let rows: Array<Pick<typeof playbookSchema.$inferSelect, 'slug' | 'kind' | 'origin'>>;
  try {
    rows = await db
      .select({ slug: playbookSchema.slug, kind: playbookSchema.kind, origin: playbookSchema.origin })
      .from(playbookSchema)
      .where(and(
        eq(playbookSchema.orgId, orgId),
        eq(playbookSchema.kind, 'skill'),
        sql`${playbookSchema.sourceFiles} @> ${JSON.stringify([FRAMEWORK_FILE])}::jsonb`,
      ))
      .orderBy(playbookSchema.slug);
  } catch (err) {
    // A document that renders unstyled is far better than a document that
    // does not render: the catalog being unreachable is not this call's
    // problem to solve.
    logger.warn('could not look up the document framework', { orgId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  for (const row of rows) {
    const css = readByOrigin(row, FRAMEWORK_FILE);
    if (css?.trim()) {
      return { slug: row.slug, css };
    }
  }
  return null;
}

/**
 * The document as it will be STORED, rendered and printed: the author's HTML
 * with the current framework under it. Any framework already in it is
 * replaced, so a re-verify picks up an edited `framework.css`.
 * @param orgId - The project.
 * @param html - The document as authored (or as stored).
 */
export async function withFramework(orgId: string, html: string): Promise<string> {
  const framework = await frameworkFor(orgId);
  return framework ? injectFramework(html, framework.css, framework.slug) : stripFramework(html);
}
