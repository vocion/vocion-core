import { auth } from '@clerk/nextjs/server';
import { os } from '@orpc/server';
import { logger } from '@/libs/Logger';
import {
  addDocumentLink,
  createBusinessObject,
  createObjectType,
  deleteBusinessObject,
  getBusinessObject,
  listBusinessObjects,
  listObjectTypes,
  removeDocumentLink,
  updateBusinessObject,
} from '@/services/BusinessObjectService';
import { ORG_ROLE } from '@/types/Auth';
import {
  AddDocumentLinkValidation,
  CreateBusinessObjectValidation,
  CreateObjectTypeValidation,
  DeleteBusinessObjectValidation,
  GenerateSummaryValidation,
  GetBusinessObjectValidation,
  ListBusinessObjectsValidation,
  UpdateBusinessObjectValidation,
} from '@/validations/BusinessObjectValidation';
import { ApiError } from './ApiError';
import { guardAuth, guardRole } from './AuthGuards';

/* ---- Object Types ---- */

export const listTypes = os
  .handler(async () => {
    const { orgId } = await guardAuth();
    return listObjectTypes(orgId);
  });

export const createType = os
  .input(CreateObjectTypeValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardRole(ORG_ROLE.ADMIN);
    const [objType] = await createObjectType(input, orgId);
    logger.info(`Object type "${input.slug}" created`);
    return objType;
  });

/* ---- Business Objects ---- */

export const list = os
  .input(ListBusinessObjectsValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listBusinessObjects(orgId, input.typeSlug);
  });

export const get = os
  .input(GetBusinessObjectValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const obj = await getBusinessObject(input.id, orgId);
    if (!obj) {
      throw ApiError.notFound();
    }
    return obj;
  });

export const create = os
  .input(CreateBusinessObjectValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { userId } = await auth();
    const obj = await createBusinessObject(input, orgId, userId ?? 'unknown');
    logger.info(`Business object "${input.title}" created (type: ${input.typeSlug})`);
    return obj;
  });

export const update = os
  .input(UpdateBusinessObjectValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const result = await updateBusinessObject(input, orgId);
    if (result.length === 0) {
      throw ApiError.notFound();
    }
    logger.info(`Business object ${input.id} updated`);
    return result[0];
  });

export const remove = os
  .input(DeleteBusinessObjectValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardRole(ORG_ROLE.ADMIN);
    const result = await deleteBusinessObject(input.id, orgId);
    if (result.length === 0) {
      throw ApiError.notFound();
    }
    logger.info(`Business object ${input.id} deleted`);
    return {};
  });

/* ---- Document Links ---- */

export const addLink = os
  .input(AddDocumentLinkValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const [link] = await addDocumentLink(input, orgId);
    logger.info(`Document link added to object ${input.objectId}`);
    return link;
  });

export const removeLink = os
  .input(GetBusinessObjectValidation) // reuse {id} shape
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const result = await removeDocumentLink(input.id, orgId);
    if (result.length === 0) {
      throw ApiError.notFound();
    }
    return {};
  });

/* ---- Summary Generation ---- */

export const generateSummary = os
  .input(GenerateSummaryValidation)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const obj = await getBusinessObject(input.id, orgId);
    if (!obj) {
      throw ApiError.notFound();
    }

    // Build context from linked documents for the summary prompt
    const docDescriptions = obj.documentLinks.map(
      link => `[${link.sourceType}] ${link.semanticIdentifier ?? link.onyxDocumentId} (role: ${link.role})`,
    ).join('\n');

    const metadata = obj.metadata as Record<string, unknown>;
    const metaStr = Object.entries(metadata)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    // For now, generate a structured placeholder summary from the metadata.
    // Actual LLM call will be wired through the Onyx chat API in a future iteration.
    const summaryParts = [
      `${obj.type.label}: "${obj.title}"`,
      metaStr ? `Details: ${metaStr}.` : '',
      docDescriptions ? `Linked sources:\n${docDescriptions}` : '',
    ].filter(Boolean);
    const summary = summaryParts.join('\n');

    const [updated] = await updateBusinessObject(
      { id: input.id, summary },
      orgId,
    );

    logger.info(`Summary generated for business object ${input.id}`);
    return updated;
  });
