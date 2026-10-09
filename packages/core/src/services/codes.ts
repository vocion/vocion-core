import type { CoreNoun, TypeCodes } from '@/libs/codes';
import { and, eq, inArray } from 'drizzle-orm';
import { cache } from 'react';
import { assignTypeCodes, coreNounOf, formatCode, nounCode, parseCode, recordCode, TYPE_CODE_SCHEMA_KEY } from '@/libs/codes';
import { db } from '@/libs/DB';
import {
  actionRunSchema,
  artifactSchema,
  askSchema,
  automationRunSchema,
  businessObjectSchema,
  businessObjectTypeSchema,
  conversationSchema,
  goalSchema,
  workerRunSchema,
} from '@/models/Schema';

/**
 * The server half of SHORT TYPED CODES (`libs/codes.ts`): this org's type
 * codes, and the one resolver from a code to its row and back. Search, links
 * and tool inputs all go through {@link resolveCode}, so `FE-294` means the
 * same row wherever it is typed.
 */

/**
 * Every object type's code in one org. The applier stores each type's code on
 * its row; a type created before codes existed (or through the API) has its
 * code derived here, settled against the rest of the set so no two collide.
 * Read once per request under React's `cache`; a plain call elsewhere.
 * @param orgId - The workspace.
 */
export const typeCodesForOrg = cache(async (orgId: string): Promise<TypeCodes> => {
  const rows = await db
    .select({ slug: businessObjectTypeSchema.slug, schema: businessObjectTypeSchema.schema })
    .from(businessObjectTypeSchema)
    .where(eq(businessObjectTypeSchema.orgId, orgId));
  return typeCodesOfRows(rows);
});

/**
 * Type rows → slug → code, the same settlement {@link typeCodesForOrg} makes.
 * @param rows - Type rows (slug and stored schema).
 */
export function typeCodesOfRows(rows: ReadonlyArray<{ slug: string; schema?: Record<string, unknown> | null }>): TypeCodes {
  const declared = rows.map(r => ({ slug: r.slug, code: (r.schema?.[TYPE_CODE_SCHEMA_KEY] as string | undefined) ?? null }));
  return assignTypeCodes(declared).codes;
}

/** What a code resolves to. */
export type ResolvedCode
  = | { kind: 'record'; id: number; typeSlug: string; code: string; title: string }
    | { kind: CoreNoun; id: number; code: string };

/** Why a code resolved to nothing, said so the caller can pass it on. */
export type UnresolvedCode = { kind: 'none'; reason: string };

const NOUN_TABLES = {
  run: workerRunSchema,
  action: actionRunSchema,
  ask: askSchema,
  conversation: conversationSchema,
  artifact: artifactSchema,
  automation: automationRunSchema,
  goal: goalSchema,
} as const;

/**
 * A record's code from its id, or null when the org has no such record.
 * @param orgId - The workspace.
 * @param id - The record id.
 */
export async function codeForRecord(orgId: string, id: number): Promise<string | null> {
  const [row] = await db
    .select({ slug: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
    .limit(1);
  if (!row) {
    return null;
  }
  const codes = await typeCodesForOrg(orgId);
  return recordCode(codes, row.slug, id);
}

/**
 * Resolve a code a person or an agent typed — `FE-294`, `fe-294`, `RUN-439`,
 * or an old bare `#294` (a record, as it always meant) — to the row it names
 * in this org. Case-insensitive. A record's code must match its type's: FE-295
 * when 295 is a plan resolves to nothing and says which code it has, rather
 * than quietly opening the wrong kind of thing.
 * @param orgId - The workspace.
 * @param text - The typed reference.
 */
export async function resolveCode(orgId: string, text: string | number): Promise<ResolvedCode | UnresolvedCode> {
  const parsed = parseCode(text);
  if (!parsed) {
    return { kind: 'none', reason: `"${String(text)}" is not a code (codes look like FE-294 or RUN-439)` };
  }
  const noun = parsed.prefix ? coreNounOf(parsed.prefix) : null;
  if (noun) {
    const table = NOUN_TABLES[noun];
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.orgId, orgId), eq(table.id, parsed.id)))
      .limit(1);
    return row
      ? { kind: noun, id: parsed.id, code: nounCode(noun, parsed.id) }
      : { kind: 'none', reason: `no ${nounCode(noun, parsed.id)} in this workspace` };
  }
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, slug: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, parsed.id)))
    .limit(1);
  if (!row) {
    return { kind: 'none', reason: `no record ${parsed.prefix ? formatCode(parsed.prefix, parsed.id) : `#${parsed.id}`} in this workspace` };
  }
  const codes = await typeCodesForOrg(orgId);
  const code = recordCode(codes, row.slug, row.id);
  if (parsed.prefix && !code.startsWith(`${parsed.prefix}-`)) {
    return { kind: 'none', reason: `${formatCode(parsed.prefix, parsed.id)} does not exist; record ${parsed.id} is ${code} (${row.title})` };
  }
  return { kind: 'record', id: row.id, typeSlug: row.slug, code, title: row.title };
}

/**
 * Many records' codes in one read — id → code — for a tool or a surface
 * naming a list. Ids the org has no record for are left out.
 * @param orgId - The workspace.
 * @param ids - Record ids.
 */
export async function codesForRecords(orgId: string, ids: readonly number[]): Promise<Map<number, string>> {
  const wanted = [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, slug: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, wanted)));
  const codes = await typeCodesForOrg(orgId);
  return new Map(rows.map(r => [r.id, recordCode(codes, r.slug, r.id)]));
}
