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

/* ----------------------------------------------------------------
 * Workflow manifest
 * ---------------------------------------------------------------- */

const InterpolatableStringSchema = z.string().describe(
  'supports {{input.x}}, {{steps.name.output.y}}, {{trigger.y}}',
);

/**
 * Step types (v1):
 *   - `skill`   — invoke a skill with interpolated input
 *   - `approve` — HITL pause; workflow resumes after runtime_approve
 *   - `action`  — connector-backed action (v1 = registered stubs only)
 */
const SkillStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('skill').default('skill'),
  skill: z.string().describe('skill slug to invoke'),
  input: z.record(z.string(), z.unknown()).default({}),
  /** Optional — persist this step's output into named variable (defaults to step name). */
  outputAs: z.string().optional(),
});

const ApproveStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('approve'),
  prompt: z.string().describe('what is being approved — shown in the review queue'),
  /** Optional — reference to prior step whose output is being reviewed. */
  reviews: z.string().optional(),
});

const ActionStepSchema = z.object({
  name: SlugSchema,
  type: z.literal('action'),
  action: z.string().describe('registered action id, e.g. `gmail.send_email`'),
  input: z.record(z.string(), z.unknown()).default({}),
});

const WorkflowStepSchema = z.discriminatedUnion('type', [SkillStepSchema, ApproveStepSchema, ActionStepSchema]);

const ManualTriggerSchema = z.object({
  type: z.literal('manual').default('manual'),
});
const EventTriggerSchema = z.object({
  type: z.literal('event'),
  /** e.g. `object.created`, `skill.completed`, `external.zoom.meeting_ended` */
  event: z.string(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

const WorkflowTriggerSchema = z.discriminatedUnion('type', [ManualTriggerSchema, EventTriggerSchema]);

export const WorkflowManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'disabled', 'draft']).default('active'),
  version: z.number().int().positive().default(1),
  trigger: WorkflowTriggerSchema,
  steps: z.array(WorkflowStepSchema).min(1),
  /** Optional input JSON Schema for manual triggers. */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

// Re-export InterpolatableStringSchema for step authors who want to type inputs explicitly.
export { InterpolatableStringSchema };

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
