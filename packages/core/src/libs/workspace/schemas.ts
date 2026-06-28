import { z } from 'zod';

const SlugSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, {
  message: 'slug must be lowercase, start with a letter, and contain only letters, numbers, dashes, or underscores',
});

const FewShotExampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  label: z.string().optional(),
});

export const WorkspaceManifestSchema = z.object({
  version: z.literal(1).describe('manifest format version'),
  orgId: z.string().min(1).describe('Clerk organization id'),
  name: z.string().min(1),
  description: z.string().optional(),
  defaults: z.object({
    model: z.string().optional(),
    temperature: z.string().optional(),
  }).partial().optional(),
});
export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;

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
  connectorSources: z.array(z.string()).default([]).describe('source slugs (matching knowledge_source.slug) this agent can search'),
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
  /**
   * Sub-agent definitions (v0.2). Each entry compiles into a deepagents
   * `SubAgent` the parent dispatches via the `task` tool. `systemPrompt`
   * may be inlined here, or supplied via `systemPromptFile` (relative
   * path). At least one of the two is required per entry.
   */
  subagents: z.array(z.object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    description: z.string(),
    systemPrompt: z.string().optional(),
    systemPromptFile: z.string().optional(),
    tools: z.array(z.string()).optional(),
    model: z.string().optional(),
  }).refine(
    s => !!(s.systemPrompt || s.systemPromptFile),
    { message: 'subagent must have either systemPrompt or systemPromptFile' },
  )).default([]),
  /** Playbook-tag filter — see `playbook.tags`. */
  playbookTags: z.array(z.string()).default([]),
  /** Names of `learning_step` rows this agent owns. (Wired in Phase 5.) */
  learningSteps: z.array(z.string()).default([]),
  /** Empty-state suggestions shown in the chat UI. */
  suggestions: z.array(z.object({
    label: z.string(),
    prompt: z.string(),
  })).default([]),
  /** CSS color name for the agent's chat header / sidebar. */
  accent: z.string().optional(),
  /** Short tagline shown above the chat title. */
  eyebrow: z.string().optional(),
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
  scriptFile: z.string().optional().describe('path to .js/.ts postprocess module, relative to skill file. default export: (output, input, ctx) => output'),
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

/**
 * Playbook frontmatter schema (v0.2).
 *
 * A Playbook is a markdown + YAML procedural guide that the agent
 * reads on demand from its virtual filesystem at
 * `/playbooks/<slug>/SKILL.md`. The file's YAML frontmatter must
 * validate against this schema. The body is the agent-facing playbook
 * content — sections, rules, examples, anti-patterns — written as if
 * for a smart human collaborator.
 *
 * Naming note: the on-disk filename is `SKILL.md` (rather than
 * `playbook.md`) because deepagents's `createSkillsMiddleware` looks
 * for that exact name when lazy-loading on `task` activation. The
 * external concept is "Playbook"; the internal deepagents filename
 * is `SKILL.md`.
 */
/**
 * LearningStep authoring schema (v0.2). Each
 * `workspace/<org>/learnings/<name>.yaml` declares one named step
 * (`global`, `meeting_triage`, ...). Steps are whitelisted via this
 * authoring path so the rule store doesn't drift into a junk drawer.
 */
/**
 * Eval dataset authoring schema (v0.2). Each
 * `workspace/<org>/evals/<slug>.yaml` declares one dataset.
 */
export const EvalDatasetManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  description: z.string().optional(),
  agentSlug: z.string().describe('which agent slug this dataset evaluates'),
  version: z.number().int().positive().default(1),
  items: z.array(z.object({
    input: z.string().describe('the user message to send to the agent'),
    expectedOutput: z.string().optional().describe('substantive-equivalence guidance, not literal match'),
    rubric: z.string().optional().describe('per-case rubric the judge uses'),
    tags: z.array(z.string()).optional(),
  })).min(1),
});
export type EvalDatasetManifest = z.infer<typeof EvalDatasetManifestSchema>;

export const LearningStepManifestSchema = z.object({
  name: SlugSchema,
  title: z.string(),
  description: z.string(),
  /** Long-form intro shown above the rule list. Markdown allowed. */
  preamble: z.string().optional(),
  /** Which agent slugs own / read this step. */
  agents: z.array(z.string()).default([]),
});
export type LearningStepManifest = z.infer<typeof LearningStepManifestSchema>;

export const PlaybookManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().describe('Human-readable name for catalog UI.'),
  description: z.string().describe('One-line summary the agent reads to decide when to activate this playbook.'),
  tags: z.array(z.string()).default([]).describe('Per-agent filter — an agent\'s `playbookTags` field selects which playbooks mount into its virtual FS. Empty agent list = all playbooks mount.'),
  version: z.number().int().positive().default(1),
  /**
   * Sibling resource files (e.g. `REFERENCE.html`, `COMPONENTS.md`,
   * `examples/*.json`) that the playbook references. Listed here so
   * the catalog row is aware of them; the runtime mount helper picks
   * them up from the same folder regardless.
   */
  resources: z.array(z.string()).default([]),
  /**
   * Optional license string (e.g. `proprietary`, `Apache-2.0`,
   * `client:metacto`). Surfaced in the catalog so partners can
   * filter / audit by license.
   */
  license: z.string().optional(),
});
export type PlaybookManifest = z.infer<typeof PlaybookManifestSchema>;

export const SourceManifestSchema = z.object({
  slug: SlugSchema,
  name: z.string().describe('Human-readable name shown in the Sources page.'),
  description: z.string().optional().describe('One-line summary for the catalog UI.'),
  /**
   * Connector kind — must match a registered connector in
   * `libs/sources/registry`. Built-ins: `web`, `local-files`. Authored
   * sources can use a *labelled* kind (e.g. `zendesk`) that routes
   * through a built-in connector at the registry level when no live
   * implementation is wired yet — see the support-reply demo's
   * `sources/zendesk.yaml` for the Stripe-style test-mode pattern.
   */
  kind: z.string().describe('Connector kind. Maps to a SourceConnector slug.'),
  /** Resolved per-connector config (validated against the connector\'s configSchema at apply time). */
  config: z.record(z.string(), z.unknown()).default({}),
  /**
   * Sync schedule (cron expression) for Temporal scheduled syncs. When
   * omitted, the source only syncs on manual trigger via /dashboard/sources.
   */
  schedule: z.string().optional().describe('Cron expression for scheduled sync. Manual-only when omitted.'),
  enabled: z.boolean().default(true),
});
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
