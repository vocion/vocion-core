import { z } from 'zod';

const SlugSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, {
  message: 'slug must be lowercase, start with a letter, and contain only letters, numbers, dashes, or underscores',
});

const FewShotExampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  label: z.string().optional(),
});

export const ContextManifestSchema = z.object({
  version: z.literal(1).describe('manifest format version'),
  orgId: z.string().min(1).describe('Clerk organization id'),
  name: z.string().min(1),
  description: z.string().optional(),
  defaults: z.object({
    model: z.string().optional(),
    temperature: z.string().optional(),
  }).partial().optional(),
});
export type ContextManifest = z.infer<typeof ContextManifestSchema>;

export const AgentManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  active: z.boolean().default(true),
  model: z.string().optional(),
  temperature: z.union([z.string(), z.number()]).optional(),
  systemPromptFile: z.string().optional().describe('path to markdown system prompt, relative to agent file'),
  systemPrompt: z.string().optional().describe('inline system prompt — prefer systemPromptFile for long prompts'),
  skills: z.array(z.string()).default([]).describe('skill slugs this agent can invoke'),
  connectorSources: z.array(z.string()).default([]).describe('onyx source_type values'),
  objectTypes: z.array(z.string()).default([]).describe('business object type slugs'),
  documentSetIds: z.array(z.number()).default([]),
  searchConfig: z.object({
    recencyDecay: z.number().optional(),
    sourceWeights: z.record(z.string(), z.number()).optional(),
    maxResults: z.number().optional(),
    minRelevance: z.number().optional(),
  }).partial().default({}),
  fewShotExamples: z.array(FewShotExampleSchema).default([]),
  approvalPolicy: z.record(z.string(), z.unknown()).default({}),
  langfuseProjectId: z.string().optional(),
}).refine(
  v => !!(v.systemPromptFile || v.systemPrompt),
  { message: 'agent must have either systemPromptFile or inline systemPrompt' },
);
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export const SkillManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  category: z.enum(['query', 'mutation', 'composite']).default('query'),
  status: z.enum(['active', 'disabled', 'draft']).default('active'),
  version: z.number().int().positive().default(1),
  model: z.string().optional(),
  temperature: z.union([z.string(), z.number()]).optional(),
  requiresApproval: z.boolean().default(true),
  promptFile: z.string().optional().describe('path to markdown prompt template, relative to skill file'),
  promptTemplate: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
}).refine(
  v => !!(v.promptFile || v.promptTemplate),
  { message: 'skill must have either promptFile or inline promptTemplate' },
);
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export const ObjectTypeManifestSchema = z.object({
  slug: SlugSchema,
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for metadata shape'),
  sourceRelevance: z.record(z.string(), z.number()).optional(),
  classificationPromptFile: z.string().optional(),
  classificationPrompt: z.string().optional(),
  fewShotExamples: z.array(FewShotExampleSchema).default([]),
});
export type ObjectTypeManifest = z.infer<typeof ObjectTypeManifestSchema>;
