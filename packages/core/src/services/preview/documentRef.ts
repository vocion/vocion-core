import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';

/**
 * Finding the ingested copy of a citation.
 *
 * Connectors stamp `knowledge_document.external_id` with their own prefix at
 * ingest time, and the shapes do not all match what a proposer writes in its
 * evidence:
 *
 *   granola   `granola:<noteId>`                    — cites the same thing
 *   zoom      `zoom:<uuid>`, `metadata.meetingId`   — often cited by TITLE
 *   gmail     `gmail:<messageId>` / `gmail-thread:` — often cited by SUBJECT
 *   hubspot   `deals:<id>` / `contacts:` / `companies:` — NO `hubspot:` prefix
 *
 * So a lookup tries, in order: the citation as an external id; the HubSpot
 * spelling when the citation used `hubspot:`; then the document title, which
 * is where a subject line or a meeting name actually lives. Title matching is
 * last and exact-insensitive only — a fuzzy match that shows the wrong meeting
 * is worse than saying we could not find it.
 *
 * Reads the mirror. No outbound call: the connectors already paid for it.
 */

export type DocumentHit = { id: number; sourceSlug: string };

const HUBSPOT_OBJECTS = ['deals', 'contacts', 'companies'];

/**
 * The external ids a citation could plausibly have been stored under.
 * @param citation
 */
export function externalIdCandidates(citation: string): string[] {
  const raw = citation.trim();
  const out = [raw];
  const m = /^([a-z][\w-]*):(.+)$/i.exec(raw);
  if (!m) {
    return out;
  }
  const prefix = m[1]!.toLowerCase();
  const rest = m[2]!.trim();
  if (prefix === 'hubspot') {
    // `hubspot:deals:123` → `deals:123`; `hubspot:123` → every object type.
    const inner = /^([a-z]+):(.+)$/i.exec(rest);
    if (inner && HUBSPOT_OBJECTS.includes(inner[1]!.toLowerCase())) {
      out.push(`${inner[1]!.toLowerCase()}:${inner[2]}`);
    } else {
      out.push(...HUBSPOT_OBJECTS.map(t => `${t}:${rest}`));
    }
  }
  if (prefix === 'gmail') {
    out.push(`gmail-thread:${rest}`);
  }
  return [...new Set(out)];
}

/**
 * The mirrored document for a citation, or null. Honours the org scope and
 * the caller's per-connection ACL.
 * @param orgId
 * @param citation - The evidence string, e.g. `granola:<id>` or `zoom:<title>`.
 * @param allowedSourceSlugs - Per-user connection ACL; omit for no restriction.
 */
export async function findDocumentForCitation(orgId: string, citation: string, allowedSourceSlugs?: string[]): Promise<DocumentHit | null> {
  const acl = allowedSourceSlugs ? inArray(knowledgeSourceSchema.slug, allowedSourceSlugs) : undefined;
  const pick = async (predicate: ReturnType<typeof or>) => {
    const rows = await db
      .select({ id: knowledgeDocumentSchema.id, sourceSlug: knowledgeSourceSchema.slug })
      .from(knowledgeDocumentSchema)
      .innerJoin(knowledgeSourceSchema, eq(knowledgeDocumentSchema.sourceId, knowledgeSourceSchema.id))
      .where(and(eq(knowledgeDocumentSchema.orgId, orgId), predicate, acl))
      .orderBy(sql`coalesce(${knowledgeDocumentSchema.lastModifiedAt}, ${knowledgeDocumentSchema.ingestedAt}) desc`)
      .limit(1);
    return rows[0] ?? null;
  };

  const byExternal = await pick(inArray(knowledgeDocumentSchema.externalId, externalIdCandidates(citation)));
  if (byExternal) {
    return byExternal;
  }

  // A citation whose tail is a name, not a handle: `zoom:Kickoff`, the subject
  // of a mail. The title is where the connector put it.
  const m = /^[a-z][\w-]*:(.+)$/i.exec(citation.trim());
  const tail = m?.[1]?.trim();
  if (!tail) {
    return null;
  }
  return pick(or(eq(knowledgeDocumentSchema.title, tail), ilike(knowledgeDocumentSchema.title, tail)));
}
