import { z } from 'zod';

export class ListValidationError extends Error {}

const key = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).refine(v => !['constructor', 'prototype', '__proto__'].includes(v), 'Reserved field name');
export const listFieldSchema = z.object({
  key,
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'number', 'boolean', 'date', 'select', 'reference']),
  options: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  referenceListId: z.string().uuid().optional(),
}).refine(f => f.type !== 'select' || !!f.options, 'Select fields need options').refine(f => f.type !== 'reference' || !!f.referenceListId, 'Reference fields need a target List');
export type ListField = z.infer<typeof listFieldSchema>;
export const listFieldsSchema = z.array(listFieldSchema).min(1).max(24).refine(fields => new Set(fields.map(f => f.key)).size === fields.length, 'Field keys must be unique');
export const listCellSchema = z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null()]);
export const listFilterSchema = z.object({ field: key, value: listCellSchema });
export const listViewSchema = z.object({
  name: z.string().min(1).max(80),
  columns: z.array(key).min(1).max(24),
  filters: z.array(listFilterSchema).max(8).default([]),
  sortBy: key.optional(),
  descending: z.boolean().default(false),
});
export type ListView = z.infer<typeof listViewSchema>;
export const createListSchema = z.object({
  id: z.string().uuid().describe('Stable request UUID; reuse on retries.'),
  title: z.string().trim().min(1).max(120),
  purpose: z.string().max(1000).default(''),
  scope: z.enum(['personal', 'workspace']).default('personal'),
  fields: listFieldsSchema,
});
export const readListSchema = z.object({
  id: z.string().uuid(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  view: z.string().max(80).optional(),
  filters: z.array(listFilterSchema).max(8).default([]),
});
export const writeListSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  records: z.array(z.object({
    id: z.string().uuid().describe('Stable record UUID; retain it when updating.'),
    values: z.record(key, listCellSchema),
  })).min(1).max(100),
});
export const configureListSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(),
  addFields: z.array(listFieldSchema).max(24).default([]),
  views: z.array(listViewSchema).max(20).optional(),
  scope: z.literal('workspace').optional().describe('Publish your personal List to this workspace; admin only.'),
  targetWorkspaceId: z.string().min(1).max(200).optional().describe('When publishing an owned personal List, move it to this workspace. Requires admin in the destination. Retains IDs and history.'),
  archived: z.boolean().optional(),
});
export const aggregateListSchema = z.object({
  id: z.string().uuid(),
  filters: z.array(listFilterSchema).max(8).default([]),
  groupBy: key.optional(),
  sum: key.optional(),
});

/**
 * Validate the complete merged record; absent fields remain optional.
 * @param fields
 * @param values
 */
export function validateListValues(fields: ListField[], values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    const field = fields.find(f => f.key === name);
    if (!field) {
      throw new ListValidationError(`Unknown field: ${name}`);
    }
    if (value === null) {
      continue;
    }
    const valid = field.type === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : field.type === 'boolean'
        ? typeof value === 'boolean'
        : typeof value === 'string' && value.length <= 10000
          && (field.type !== 'select' || field.options!.includes(value))
          && (field.type !== 'date' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value))
          && (field.type !== 'reference' || z.string().uuid().safeParse(value).success);
    if (!valid) {
      throw new ListValidationError(`Invalid ${field.type} value for ${name}`);
    }
  }
}

/**
 * Fail closed for both other people and other workspaces, including admins.
 * @param list
 * @param list.projectId
 * @param list.scope
 * @param list.ownerId
 * @param actor
 * @param actor.orgId
 * @param actor.userId
 */
export function canReadList(list: { projectId: string; scope: string; ownerId: string }, actor: { orgId: string; userId: string }): boolean {
  return list.projectId === actor.orgId && (list.scope === 'workspace' || list.ownerId === actor.userId);
}
