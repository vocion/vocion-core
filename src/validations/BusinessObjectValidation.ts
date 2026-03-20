import * as z from 'zod';

/* ---- Object Types ---- */

export const CreateObjectTypeValidation = z.object({
  slug: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_]*$/, 'Must be lowercase snake_case'),
  label: z.string().min(1).max(100),
  description: z.string().optional(),
  icon: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
});

export type CreateObjectTypeInput = z.infer<typeof CreateObjectTypeValidation>;

/* ---- Document Links (embedded in object creation/update) ---- */

const DocumentLinkValidation = z.object({
  onyxDocumentId: z.string().min(1),
  sourceType: z.string().min(1),
  semanticIdentifier: z.string().optional(),
  link: z.string().optional(),
  role: z.string().min(1),
});

/* ---- Business Objects ---- */

export const CreateBusinessObjectValidation = z.object({
  typeSlug: z.string().min(1),
  title: z.string().min(1).max(255),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  documentLinks: z.array(DocumentLinkValidation).optional(),
});

export type CreateBusinessObjectInput = z.infer<typeof CreateBusinessObjectValidation>;

export const UpdateBusinessObjectValidation = z.object({
  id: z.coerce.number(),
  title: z.string().min(1).max(255).optional(),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().optional(),
});

export type UpdateBusinessObjectInput = z.infer<typeof UpdateBusinessObjectValidation>;

export const ListBusinessObjectsValidation = z.object({
  typeSlug: z.string().optional(),
});

export const GetBusinessObjectValidation = z.object({
  id: z.coerce.number(),
});

export const DeleteBusinessObjectValidation = z.object({
  id: z.coerce.number(),
});

export const AddDocumentLinkValidation = z.object({
  objectId: z.coerce.number(),
  ...DocumentLinkValidation.shape,
});

export type AddDocumentLinkInput = z.infer<typeof AddDocumentLinkValidation>;

export const GenerateSummaryValidation = z.object({
  id: z.coerce.number(),
});
