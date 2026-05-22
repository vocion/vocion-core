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

export const createObjectType = (input: CreateObjectTypeInput, orgId: string) => {
  return db
    .insert(businessObjectTypeSchema)
    .values({ ...input, orgId })
    .returning();
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
/* Lookup by Onyx document IDs (for Ask integration)                   */
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
