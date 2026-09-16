import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeDocumentSchema } from '@/models/Schema';

/**
 * What a CRM record is CALLED, resolved from the mirror we already hold.
 *
 * A proposed action carries an object id and, if the proposer happened to
 * include one, a name. Seventeen proposals against one deal that nobody put a
 * `dealname` on therefore read as `Deal 63861129354` — the raw id, twice, in
 * the row and in its subline (Chris, 2026-09-16: "I should be able to see the
 * name of this deal").
 *
 * The name is already on this box. `libs/sources/hubspot` mirrors every deal,
 * contact and company into `knowledge_document` with `external_id` =
 * `<objectType>:<id>` and `title` = the record's name, so resolving an id is
 * one indexed read — never an outbound call to the CRM, which would put a
 * third-party API on the path of rendering a list.
 *
 * Batch by design: a decision sheet asks about N records at once and gets one
 * query, not N. Everything here is org-scoped on the same unique index the
 * mirror is written through.
 *
 * Shaped as a `label(ref)` resolver so the `RecordRef` preview registry
 * (`workforce/2026-09-16-evidence-preview`) can adopt it as the descriptor
 * for CRM refs instead of growing a second one.
 */

/** The object types the CRM mirror holds, and how each reads with only an id. */
const MIRROR_KINDS: Record<string, string> = { deals: 'Deal', contacts: 'Contact', companies: 'Company' };

/**
 * A record key as the mirror stores it, or null when the key names something
 * the mirror does not hold (an email address, a bare run).
 *
 * Accepts both the inbox's `hubspot:deals:1234` and the mirror's own
 * `deals:1234`, because callers hold one or the other and neither should have
 * to know which.
 * @param key - `hubspot:deals:1234`, or `deals:1234`.
 */
export function mirrorRef(key: string): string | null {
  const m = key.match(/^(?:hubspot:)?([a-z]+):(.+)$/);
  const kind = m?.[1];
  return m && kind && kind in MIRROR_KINDS ? `${kind}:${m[2]}` : null;
}

/**
 * The best name on a mirrored row, or null when the row carries none.
 *
 * The mirror's own `title` falls back to `<objectType> <id>` when the record
 * had no name upstream; that is the same non-answer the caller already has,
 * so it is treated as "no name" rather than passed off as one.
 * @param ref - The mirror ref, `deals:1234`.
 * @param title - The mirrored `title`.
 * @param metadata - The mirrored `metadata`.
 */
function labelFrom(ref: string, title: string | null, metadata: Record<string, unknown>): string | null {
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  const candidates = kind === 'companies'
    ? [metadata.name, metadata.domain, title]
    : kind === 'contacts'
      ? [title, metadata.primaryEmail]
      : [title, metadata.name];
  const found = candidates.find(v => typeof v === 'string' && v.trim() !== '' && v.trim() !== `${kind} ${id}`);
  return typeof found === 'string' ? found.trim() : null;
}

/**
 * Resolve record keys to names, in one query. Keys the mirror does not hold —
 * and keys whose mirrored record has no name — are simply absent from the
 * result, so a caller can tell "not synced" from "named".
 * @param orgId - The workspace.
 * @param keys - Record keys (`hubspot:deals:1234`), in any order, duplicates fine.
 */
export async function resolveRecordLabels(orgId: string, keys: string[]): Promise<Map<string, string>> {
  const byRef = new Map<string, string[]>();
  for (const key of keys) {
    const ref = mirrorRef(key);
    if (ref) {
      byRef.set(ref, [...(byRef.get(ref) ?? []), key]);
    }
  }
  const out = new Map<string, string>();
  if (byRef.size === 0) {
    return out;
  }
  const rows = await db
    .select({ externalId: knowledgeDocumentSchema.externalId, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.externalId, [...byRef.keys()])));
  for (const row of rows) {
    const label = labelFrom(row.externalId, row.title, row.metadata ?? {});
    if (label) {
      for (const key of byRef.get(row.externalId) ?? []) {
        out.set(key, label);
      }
    }
  }
  return out;
}
