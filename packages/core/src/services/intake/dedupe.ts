/**
 * THE SAME PERSON TWICE — within one batch, and against what the workspace
 * already holds.
 *
 * One identity rule everywhere: an email matches on its own; a name matches
 * only together with its company. Both are compared folded (case, accents and
 * punctuation away), so "Dana Reyes, Kestrel Capital" on a badge and
 * "dana reyes / KESTREL CAPITAL." on a card are one person.
 *
 * Inside a batch two reads of one person are merged — the surer value of each
 * field wins and both files stay in the provenance. Against the workspace a
 * match is never merged here: it is held for the person to decide, as one
 * Decision (`services/intake/intake.ts`). Two places are read:
 *
 *   - records of the same type already on file (`business_object`);
 *   - contacts a CRM sync mirrored into the index (`knowledge_document` rows
 *     the CRM connector files with `objectType: 'contacts'`,
 *     `services/CrmRecordsService.ts`). The connector that filed it names the
 *     system ("already in HubSpot"); nothing here names one.
 */

import type { IntakeIdentity } from './fields';
import type { ReadValue } from './read';

/** A record built from one or more reads, before anything is written. */
export type DraftRecord = {
  /** Stable within the batch: the first source's id and the record's index there. */
  key: string;
  fields: Record<string, ReadValue & { artifactId: number; file: string }>;
  confidence: number;
  sources: Array<{ artifactId: number; file: string }>;
  notes: string[];
};

/** Something already on file that a draft may be. */
export type ExistingMatch
  = | { kind: 'record'; recordId: number; title: string; on: 'email' | 'name+company' }
    | { kind: 'crm'; system: string; systemLabel: string; externalId: string; title: string; documentId: number; on: 'email' | 'name+company' };

/**
 * A value folded for comparison: lowercase, no accents, words only.
 * @param value - The value.
 */
export function fold(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }
  return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}@.]+/gu, ' ').trim().replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
}

/**
 * The identity keys of a set of values: `email:<addr>` and `who:<name>|<company>`.
 * @param values - Field name to value.
 * @param identity - Which fields identify.
 */
export function identityKeys(values: Record<string, unknown>, identity: IntakeIdentity): string[] {
  const keys: string[] = [];
  const email = identity.email ? fold(values[identity.email]) : '';
  if (email.includes('@')) {
    keys.push(`email:${email}`);
  }
  const name = identity.name ? fold(values[identity.name]) : '';
  const company = identity.company ? fold(values[identity.company]) : '';
  if (name && company) {
    keys.push(`who:${name}|${company}`);
  }
  return keys;
}

/**
 * A draft's values, without their provenance.
 * @param d - The draft.
 */
export function valuesOf(d: Pick<DraftRecord, 'fields'>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, v.value]));
}

/**
 * Two drafts as one: each field keeps its surer reading, both files stay.
 * @param a - The draft kept.
 * @param b - The draft folded into it.
 */
export function mergeDrafts(a: DraftRecord, b: DraftRecord): DraftRecord {
  const fields = { ...a.fields };
  for (const [k, v] of Object.entries(b.fields)) {
    if (!fields[k] || fields[k]!.confidence < v.confidence) {
      fields[k] = v;
    }
  }
  const sources = [...a.sources];
  for (const s of b.sources) {
    if (!sources.some(x => x.artifactId === s.artifactId)) {
      sources.push(s);
    }
  }
  return { key: a.key, fields, confidence: Math.max(a.confidence, b.confidence), sources, notes: [...a.notes, ...b.notes] };
}

/**
 * Fold a batch's drafts so each person appears once. Order is kept: a merged
 * draft stands where its first reading stood. Pure.
 * @param drafts - Every draft read from the batch.
 * @param identity - Which fields identify.
 * @returns The folded drafts, and how many readings were merged away.
 */
export function dedupeBatch(drafts: readonly DraftRecord[], identity: IntakeIdentity): { drafts: DraftRecord[]; merged: number } {
  const out: DraftRecord[] = [];
  const byKey = new Map<string, number>();
  let merged = 0;
  for (const d of drafts) {
    const keys = identityKeys(valuesOf(d), identity);
    const hit = keys.map(k => byKey.get(k)).find((i): i is number => i !== undefined);
    if (hit === undefined) {
      out.push(d);
      for (const k of keys) {
        byKey.set(k, out.length - 1);
      }
      continue;
    }
    out[hit] = mergeDrafts(out[hit]!, d);
    merged += 1;
    for (const k of identityKeys(valuesOf(out[hit]!), identity)) {
      byKey.set(k, hit);
    }
  }
  return { drafts: out, merged };
}

/**
 * What the workspace already holds for each draft: a record of the same type
 * first, then a CRM contact. One query per place, whatever the batch size.
 * @param opts - Where to look.
 * @param opts.orgId - The workspace.
 * @param opts.typeId - The type's row id.
 * @param opts.identity - Which fields identify.
 * @param opts.drafts - The batch, already folded.
 * @returns Matches by draft key.
 */
export async function matchExisting(opts: { orgId: string; typeId: number; identity: IntakeIdentity; drafts: readonly DraftRecord[] }): Promise<Map<string, ExistingMatch>> {
  const out = new Map<string, ExistingMatch>();
  const wanted = new Map<string, string[]>();
  for (const d of opts.drafts) {
    const keys = identityKeys(valuesOf(d), opts.identity);
    if (keys.length > 0) {
      wanted.set(d.key, keys);
    }
  }
  if (wanted.size === 0) {
    return out;
  }
  const allKeys = new Set([...wanted.values()].flat());
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');

  // Records of the type: read the identity fields only, keyed in memory —
  // a type holds hundreds of records, not millions, and the fold is ours.
  const idFields = [opts.identity.email, opts.identity.name, opts.identity.company].filter((f): f is string => Boolean(f));
  if (idFields.length > 0) {
    const rows = await db
      .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, opts.orgId), eq(businessObjectSchema.typeId, opts.typeId)));
    const byKey = new Map<string, { id: number; title: string }>();
    for (const r of rows) {
      for (const k of identityKeys(r.metadata ?? {}, opts.identity)) {
        if (allKeys.has(k) && !byKey.has(k)) {
          byKey.set(k, { id: r.id, title: r.title });
        }
      }
    }
    for (const [draftKey, keys] of wanted) {
      const k = keys.find(x => byKey.has(x));
      if (k) {
        const hit = byKey.get(k)!;
        out.set(draftKey, { kind: 'record', recordId: hit.id, title: hit.title, on: k.startsWith('email:') ? 'email' : 'name+company' });
      }
    }
  }

  // CRM contacts mirrored into the index, by email first, then name + company.
  const left = [...wanted].filter(([k]) => !out.has(k));
  if (left.length === 0) {
    return out;
  }
  const emails = [...new Set(left.flatMap(([, keys]) => keys.filter(k => k.startsWith('email:')).map(k => k.slice(6))))];
  const names = [...new Set(left.flatMap(([, keys]) => keys.filter(k => k.startsWith('who:')).map(k => k.slice(4).split('|')[0]!)))];
  if (emails.length === 0 && names.length === 0) {
    return out;
  }
  const matchSql = [
    ...(emails.length > 0 ? [sql`lower(${knowledgeDocumentSchema.metadata} ->> 'primaryEmail') IN (${sql.join(emails.map(e => sql`${e}`), sql`, `)})`] : []),
    ...(names.length > 0 ? [sql`lower(${knowledgeDocumentSchema.title}) IN (${sql.join(names.map(n => sql`${n}`), sql`, `)})`] : []),
  ];
  const docs = await db
    .select({
      id: knowledgeDocumentSchema.id,
      title: knowledgeDocumentSchema.title,
      externalId: knowledgeDocumentSchema.externalId,
      metadata: knowledgeDocumentSchema.metadata,
      sourceSlug: knowledgeSourceSchema.slug,
      sourceConfig: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeDocumentSchema)
    .innerJoin(knowledgeSourceSchema, eq(knowledgeSourceSchema.id, knowledgeDocumentSchema.sourceId))
    .where(and(
      eq(knowledgeDocumentSchema.orgId, opts.orgId),
      sql`${knowledgeDocumentSchema.metadata} ->> 'objectType' = 'contacts'`,
      sql`(${sql.join(matchSql, sql` OR `)})`,
    ))
    .limit(500);
  const crmByKey = new Map<string, ExistingMatch>();
  const { platformForConnectorSlug } = await import('@/libs/platforms/registry');
  for (const d of docs) {
    const meta = (d.metadata ?? {}) as Record<string, unknown>;
    const system = String((d.sourceConfig as { _connector?: string } | null)?._connector ?? d.sourceSlug);
    const systemLabel = platformForConnectorSlug(system)?.label ?? system;
    // The connector's own key is `<objectType>:<id>`; the id is what the CRM calls it.
    const externalId = String(d.externalId ?? d.id).split(':').pop() || String(d.id);
    const base = { kind: 'crm' as const, system, systemLabel, externalId, title: d.title ?? String(meta.primaryEmail ?? ''), documentId: d.id };
    const email = fold(meta.primaryEmail);
    if (email) {
      crmByKey.set(`email:${email}`, { ...base, on: 'email' });
    }
    const name = fold(d.title);
    const company = fold(meta.company);
    if (name && company) {
      crmByKey.set(`who:${name}|${company}`, { ...base, on: 'name+company' });
    }
  }
  for (const [draftKey, keys] of left) {
    const k = keys.find(x => crmByKey.has(x));
    if (k) {
      out.set(draftKey, crmByKey.get(k)!);
    }
  }
  return out;
}
