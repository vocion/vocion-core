/**
 * The `rest` sources of a workspace, read off `knowledge_source` and parsed
 * into what the tool builder and the `rest.request` action work from.
 *
 * A REST source keeps the slug its manifest gave it (`billing-api`,
 * `cms`) — the row is recognised by the `_connector` stamp the writer puts in
 * its config, or by a `rest` / `rest-*` slug for a row added by hand from the
 * Connectors page, the same two tells the HubSpot and Apollo families use.
 * A row whose config no longer parses is skipped rather than half-built: the
 * apply is where a bad declaration is reported, not an agent turn.
 */

import type { RestSourceSpec } from './spec';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceNameOf } from '@/libs/sources/upsert';
import { knowledgeSourceSchema } from '@/models/Schema';
import { restConfigOf } from './spec';

/**
 * The parsed REST sources among `slugs` (every REST source when omitted),
 * in row order.
 * @param orgId - The workspace.
 * @param slugs - The source slugs to consider — an agent's `connectorSources`.
 */
export async function loadRestSources(orgId: string, slugs?: readonly string[]): Promise<RestSourceSpec[]> {
  if (slugs && slugs.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: knowledgeSourceSchema.id,
      slug: knowledgeSourceSchema.slug,
      configJson: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      or(
        sql`${knowledgeSourceSchema.slug} ~ '^rest(-|$)'`,
        sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'rest'`,
      ),
      ...(slugs ? [inArray(knowledgeSourceSchema.slug, [...slugs])] : []),
    ))
    .orderBy(knowledgeSourceSchema.id);
  const specs: RestSourceSpec[] = [];
  for (const row of rows) {
    const config = restConfigOf(row.configJson);
    if (config) {
      specs.push({ id: row.id, slug: row.slug, name: sourceNameOf(row.configJson, row.slug), config });
    }
  }
  return specs;
}

/**
 * One REST source by slug, or null when the org has no such source or the
 * row is not a REST source.
 * @param orgId - The workspace.
 * @param slug - The source slug.
 */
export async function restSourceForOrg(orgId: string, slug: string): Promise<RestSourceSpec | null> {
  const [spec] = await loadRestSources(orgId, [slug]);
  return spec ?? null;
}
