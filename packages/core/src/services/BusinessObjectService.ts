import type { AddDocumentLinkInput, CreateBusinessObjectInput, CreateObjectTypeInput, UpdateBusinessObjectInput } from '@/validations/BusinessObjectValidation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema, objectDocumentLinkSchema } from '@/models/Schema';

/* ------------------------------------------------------------------ */
/* Object Types                                                        */
/* ------------------------------------------------------------------ */

export const listObjectTypes = (orgId: string) => {
  return db.query.businessObjectTypeSchema.findMany({
    where: eq(businessObjectTypeSchema.orgId, orgId),
  });
};

export const getObjectTypeBySlug = (orgId: string, slug: string) => {
  return db.query.businessObjectTypeSchema.findFirst({
    where: and(
      eq(businessObjectTypeSchema.orgId, orgId),
      eq(businessObjectTypeSchema.slug, slug),
    ),
  });
};

export const createObjectType = async (input: CreateObjectTypeInput, orgId: string) => {
  const created = await db
    .insert(businessObjectTypeSchema)
    .values({ ...input, orgId })
    .returning();
  // Review cards remember types for a few seconds; a type written now should
  // be the one the next card renders from.
  const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
  forgetCachedObjectTypes();
  return created;
};

/* ------------------------------------------------------------------ */
/* Business Objects                                                     */
/* ------------------------------------------------------------------ */

export const listBusinessObjects = async (orgId: string, typeSlug?: string) => {
  if (typeSlug) {
    const objType = await getObjectTypeBySlug(orgId, typeSlug);
    if (!objType) {
      return [];
    }
    return db.query.businessObjectSchema.findMany({
      where: and(
        eq(businessObjectSchema.orgId, orgId),
        eq(businessObjectSchema.typeId, objType.id),
      ),
      with: { type: true, documentLinks: true },
      orderBy: (obj, { desc }) => [desc(obj.createdAt)],
    });
  }

  return db.query.businessObjectSchema.findMany({
    where: eq(businessObjectSchema.orgId, orgId),
    with: { type: true, documentLinks: true },
    orderBy: (obj, { desc }) => [desc(obj.createdAt)],
  });
};

export const getBusinessObject = async (id: number, orgId: string) => {
  return db.query.businessObjectSchema.findFirst({
    where: and(
      eq(businessObjectSchema.id, id),
      eq(businessObjectSchema.orgId, orgId),
    ),
    with: { type: true, documentLinks: true },
  });
};

export const createBusinessObject = async (
  input: CreateBusinessObjectInput,
  orgId: string,
  userId: string,
) => {
  const objType = await getObjectTypeBySlug(orgId, input.typeSlug);
  if (!objType) {
    throw new Error(`Object type "${input.typeSlug}" not found`);
  }

  const [obj] = await db
    .insert(businessObjectSchema)
    .values({
      orgId,
      typeId: objType.id,
      title: input.title,
      status: input.status ?? 'active',
      metadata: input.metadata ?? {},
      createdBy: userId,
    })
    .returning();

  // Insert document links if provided
  if (input.documentLinks?.length && obj) {
    await db.insert(objectDocumentLinkSchema).values(
      input.documentLinks.map(link => ({
        objectId: obj.id,
        onyxDocumentId: link.onyxDocumentId,
        sourceType: link.sourceType,
        semanticIdentifier: link.semanticIdentifier,
        link: link.link,
        role: link.role,
      })),
    );
  }

  return obj;
};

export const updateBusinessObject = async (input: UpdateBusinessObjectInput, orgId: string) => {
  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) {
    updates.title = input.title;
  }
  if (input.status !== undefined) {
    updates.status = input.status;
  }
  if (input.metadata !== undefined) {
    updates.metadata = input.metadata;
  }
  if (input.summary !== undefined) {
    updates.summary = input.summary;
    updates.summaryGeneratedAt = new Date();
  }

  return db
    .update(businessObjectSchema)
    .set(updates)
    .where(and(
      eq(businessObjectSchema.id, input.id),
      eq(businessObjectSchema.orgId, orgId),
    ))
    .returning();
};

export const deleteBusinessObject = async (id: number, orgId: string) => {
  return db
    .delete(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.id, id),
      eq(businessObjectSchema.orgId, orgId),
    ))
    .returning();
};

/* ------------------------------------------------------------------ */
/* Document Links                                                      */
/* ------------------------------------------------------------------ */

export const addDocumentLink = async (input: AddDocumentLinkInput, orgId: string) => {
  // Verify the object belongs to the org
  const obj = await getBusinessObject(input.objectId, orgId);
  if (!obj) {
    throw new Error('Business object not found');
  }

  return db
    .insert(objectDocumentLinkSchema)
    .values({
      objectId: input.objectId,
      onyxDocumentId: input.onyxDocumentId,
      sourceType: input.sourceType,
      semanticIdentifier: input.semanticIdentifier,
      link: input.link,
      role: input.role,
    })
    .onConflictDoNothing()
    .returning();
};

export const removeDocumentLink = async (linkId: number, orgId: string) => {
  // Join check: ensure the link belongs to an object owned by this org
  const link = await db.query.objectDocumentLinkSchema.findFirst({
    where: eq(objectDocumentLinkSchema.id, linkId),
    with: { object: true },
  });

  if (!link || link.object.orgId !== orgId) {
    return [];
  }

  return db
    .delete(objectDocumentLinkSchema)
    .where(eq(objectDocumentLinkSchema.id, linkId))
    .returning();
};

/* ------------------------------------------------------------------ */
/* Lookup by external document IDs (for chat / retrieval integration) */
/* ------------------------------------------------------------------ */

export const findObjectsByDocumentIds = async (documentIds: string[], orgId: string) => {
  if (documentIds.length === 0) {
    return [];
  }

  const links = await db.query.objectDocumentLinkSchema.findMany({
    where: and(
      // Filter by document IDs using SQL IN via drizzle's inArray
      ...documentIds.length === 1
        ? [eq(objectDocumentLinkSchema.onyxDocumentId, documentIds[0]!)]
        : [],
    ),
    with: {
      object: {
        with: { type: true },
      },
    },
  });

  // Filter to objects in this org
  return links
    .filter(link => link.object.orgId === orgId)
    .map(link => ({
      documentId: link.onyxDocumentId,
      role: link.role,
      object: {
        id: link.object.id,
        title: link.object.title,
        status: link.object.status,
        typeSlug: link.object.type.slug,
        typeLabel: link.object.type.label,
        metadata: link.object.metadata,
      },
    }));
};

/* ------------------------------------------------------------------ */
/* Candidate queues — objects proposed by an agent, decided by a human */
/* ------------------------------------------------------------------ */

/** One page of objects, plus the real total so a caller can paginate. */
export type BusinessObjectPage = {
  items: Array<{
    id: number;
    typeSlug: string;
    typeLabel: string;
    title: string;
    status: string | null;
    metadata: Record<string, unknown>;
    provenance: Record<string, unknown> | null;
    summary: string | null;
    externalSystem: string | null;
    externalId: string | null;
    reviewActionRunId: number | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  total: number;
  limit: number;
  offset: number;
};

export type ListBusinessObjectsOptions = {
  /** Object type slug, e.g. `event-candidate`. */
  typeSlug?: string;
  /** Lifecycle state: `candidate`, `approved`, `rejected`, `active`. */
  status?: string;
  /** Only objects already linked to (or still missing) a downstream record. */
  linked?: boolean;
  /** Case-insensitive match on the title. */
  search?: string;
  limit?: number;
  offset?: number;
};

/**
 * Make a search term mean itself.
 *
 * `%` and `_` are wildcards to LIKE, so a moderator searching for `50%` would
 * otherwise match anything starting `50`. Backslash first, or it would escape
 * the escapes that follow it.
 * @param term - What the person typed.
 */
function escapeLikeWildcards(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
}

/**
 * A filtered, ordered, counted page of an org's business objects.
 *
 * Every filter, the sort and the count run in the database — a panel showing
 * a moderation queue must never pull the whole table to count it. Newest
 * first, with the id as the tie-break so two objects created in the same
 * millisecond keep a stable order across pages.
 * @param orgId - The tenant.
 * @param options - Filters and the page window.
 */
export const listBusinessObjectPage = async (
  orgId: string,
  options: ListBusinessObjectsOptions = {},
): Promise<BusinessObjectPage> => {
  const { and, count, desc, eq, ilike, isNotNull, isNull } = await import('drizzle-orm');

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const conditions = [eq(businessObjectSchema.orgId, orgId)];
  if (options.typeSlug) {
    conditions.push(eq(businessObjectTypeSchema.slug, options.typeSlug));
  }
  if (options.status) {
    conditions.push(eq(businessObjectSchema.status, options.status));
  }
  if (options.linked === true) {
    conditions.push(isNotNull(businessObjectSchema.externalId));
  }
  if (options.linked === false) {
    conditions.push(isNull(businessObjectSchema.externalId));
  }
  if (options.search) {
    conditions.push(ilike(businessObjectSchema.title, `%${escapeLikeWildcards(options.search)}%`));
  }
  const where = and(...conditions);

  const rows = await db
    .select({
      id: businessObjectSchema.id,
      typeSlug: businessObjectTypeSchema.slug,
      typeLabel: businessObjectTypeSchema.label,
      title: businessObjectSchema.title,
      status: businessObjectSchema.status,
      metadata: businessObjectSchema.metadata,
      provenance: businessObjectSchema.provenance,
      summary: businessObjectSchema.summary,
      externalSystem: businessObjectSchema.externalSystem,
      externalId: businessObjectSchema.externalId,
      reviewActionRunId: businessObjectSchema.reviewActionRunId,
      createdAt: businessObjectSchema.createdAt,
      updatedAt: businessObjectSchema.updatedAt,
    })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectSchema.typeId, businessObjectTypeSchema.id))
    .where(where)
    .orderBy(desc(businessObjectSchema.createdAt), desc(businessObjectSchema.id))
    .limit(limit)
    .offset(offset);

  const [totals] = await db
    .select({ total: count() })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectSchema.typeId, businessObjectTypeSchema.id))
    .where(where);

  return {
    items: rows.map(row => ({ ...row, metadata: row.metadata ?? {} })),
    total: totals?.total ?? 0,
    limit,
    offset,
  };
};

/**
 * Point a business object at the record another system now holds for it —
 * what an admin panel calls after it has published an approved candidate.
 *
 * Separate from the approve path on purpose: approving with the id in hand is
 * one call, but a panel that published first and crashed before approving can
 * still repair the link with this. Idempotent, and org-scoped.
 * @param orgId - The tenant.
 * @param objectId - The business object to link.
 * @param externalRef - The owning system and its id for the record.
 * @param externalRef.system
 * @param externalRef.id
 */
export const linkExternalRecord = async (
  orgId: string,
  objectId: number,
  externalRef: { system: string; id: string },
) => {
  const [updated] = await db
    .update(businessObjectSchema)
    .set({ externalSystem: externalRef.system, externalId: externalRef.id })
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      eq(businessObjectSchema.id, objectId),
    ))
    .returning();

  return updated ?? null;
};
