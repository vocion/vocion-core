import type { LoadedAgent, LoadedContext, LoadedEvalDataset, LoadedLearningStep, LoadedObjectType, LoadedPlaybook, LoadedSkill, LoadedWorkflow } from './loader';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, businessObjectTypeSchema, contextVersionSchema, evalDatasetSchema, learningStepSchema, playbookSchema, skillSchema, workflowSchema } from '@/models/Schema';

export type ApplyOptions = {
  dryRun?: boolean;
  appliedBy?: string;
  /** Override orgId from manifest (useful for applying MetaCTO context to a different tenant for testing) */
  orgId?: string;
};

export type ResourceCounts = { created: number; updated: number; unchanged: number };

export type ApplyResult = {
  sha: string;
  orgId: string;
  sourcePath: string;
  dryRun: boolean;
  counts: {
    agents: ResourceCounts;
    skills: ResourceCounts;
    objectTypes: ResourceCounts;
    workflows: ResourceCounts;
    playbooks: ResourceCounts;
    learningSteps: ResourceCounts;
    evalDatasets: ResourceCounts;
  };
  errors: Array<{ resource: string; slug: string; message: string }>;
  versionId: number | null;
};

export async function applyContext(loaded: LoadedContext, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const orgId = opts.orgId ?? loaded.manifest.orgId;
  const dryRun = opts.dryRun ?? false;
  const defaults = loaded.manifest.defaults ?? {};

  const errors: ApplyResult['errors'] = [];
  const counts: ApplyResult['counts'] = {
    agents: blank(),
    skills: blank(),
    objectTypes: blank(),
    workflows: blank(),
    playbooks: blank(),
    learningSteps: blank(),
    evalDatasets: blank(),
  };

  // Object types first — agents and skills may reference them
  for (const ot of loaded.objectTypes) {
    try {
      const outcome = await upsertObjectType(orgId, ot, dryRun);
      bump(counts.objectTypes, outcome);
    } catch (err) {
      errors.push({ resource: 'objectType', slug: ot.slug, message: (err as Error).message });
    }
  }

  for (const skill of loaded.skills) {
    try {
      const outcome = await upsertSkill(orgId, skill, defaults, dryRun);
      bump(counts.skills, outcome);
    } catch (err) {
      errors.push({ resource: 'skill', slug: skill.slug, message: (err as Error).message });
    }
  }

  for (const agent of loaded.agents) {
    try {
      const outcome = await upsertAgent(orgId, agent, defaults, dryRun);
      bump(counts.agents, outcome);
    } catch (err) {
      errors.push({ resource: 'agent', slug: agent.slug, message: (err as Error).message });
    }
  }

  for (const workflow of loaded.workflows) {
    try {
      const outcome = await upsertWorkflow(orgId, workflow, dryRun);
      bump(counts.workflows, outcome);
    } catch (err) {
      errors.push({ resource: 'workflow', slug: workflow.slug, message: (err as Error).message });
    }
  }

  for (const pb of loaded.playbooks) {
    try {
      const outcome = await upsertPlaybook(orgId, pb, dryRun);
      bump(counts.playbooks, outcome);
    } catch (err) {
      errors.push({ resource: 'playbook', slug: pb.slug, message: (err as Error).message });
    }
  }

  for (const step of loaded.learningSteps) {
    try {
      const outcome = await upsertLearningStep(orgId, step, dryRun);
      bump(counts.learningSteps, outcome);
    } catch (err) {
      errors.push({ resource: 'learningStep', slug: step.name, message: (err as Error).message });
    }
  }

  for (const ds of loaded.evalDatasets) {
    try {
      const outcome = await upsertEvalDataset(orgId, ds, dryRun);
      bump(counts.evalDatasets, outcome);
    } catch (err) {
      errors.push({ resource: 'evalDataset', slug: ds.slug, message: (err as Error).message });
    }
  }

  let versionId: number | null = null;
  if (!dryRun) {
    const [row] = await db.insert(contextVersionSchema).values({
      orgId,
      sha: loaded.sha,
      sourcePath: loaded.sourcePath,
      status: errors.length > 0 ? 'partial' : 'applied',
      summary: counts as unknown as Record<string, Record<string, number>>,
      errors,
      appliedBy: opts.appliedBy ?? 'system',
    }).returning({ id: contextVersionSchema.id });
    versionId = row?.id ?? null;
  }

  return {
    sha: loaded.sha,
    orgId,
    sourcePath: loaded.sourcePath,
    dryRun,
    counts,
    errors,
    versionId,
  };
}

type UpsertOutcome = 'created' | 'updated' | 'unchanged';

async function upsertObjectType(orgId: string, ot: LoadedObjectType, dryRun: boolean): Promise<UpsertOutcome> {
  const [existing] = await db
    .select()
    .from(businessObjectTypeSchema)
    .where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, ot.slug)));

  const payload = {
    orgId,
    slug: ot.slug,
    label: ot.label,
    description: ot.description ?? null,
    icon: ot.icon ?? null,
    schema: ot.schema ?? null,
    sourceRelevance: ot.sourceRelevance ?? null,
    classificationPrompt: ot.resolvedClassificationPrompt,
    fewShotExamples: ot.fewShotExamples.length > 0 ? ot.fewShotExamples : null,
  };

  if (!existing) {
    if (!dryRun) {
      await db.insert(businessObjectTypeSchema).values(payload);
    }
    return 'created';
  }

  if (isObjectTypeEqual(existing, payload)) {
    return 'unchanged';
  }

  if (!dryRun) {
    await db
      .update(businessObjectTypeSchema)
      .set(payload)
      .where(eq(businessObjectTypeSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertSkill(orgId: string, skill: LoadedSkill, defaults: { model?: string; temperature?: string }, dryRun: boolean): Promise<UpsertOutcome> {
  const [existing] = await db
    .select()
    .from(skillSchema)
    .where(and(eq(skillSchema.orgId, orgId), eq(skillSchema.slug, skill.slug)));

  const payload = {
    orgId,
    slug: skill.slug,
    name: skill.name,
    description: skill.description ?? null,
    promptTemplate: skill.resolvedPromptTemplate,
    scriptFile: skill.scriptFile ?? null,
    inputSchema: skill.inputSchema ?? null,
    model: skill.model ?? defaults.model ?? 'gpt-4o',
    temperature: String(skill.temperature ?? defaults.temperature ?? '0.3'),
    requiresApproval: String(skill.requiresApproval),
    category: skill.category,
    status: skill.status,
    version: skill.version,
  };

  if (!existing) {
    if (!dryRun) {
      await db.insert(skillSchema).values(payload);
    }
    return 'created';
  }

  if (isSkillEqual(existing, payload)) {
    return 'unchanged';
  }

  if (!dryRun) {
    await db.update(skillSchema).set(payload).where(eq(skillSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertAgent(orgId: string, agent: LoadedAgent, defaults: { model?: string; temperature?: string }, dryRun: boolean): Promise<UpsertOutcome> {
  const [existing] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agent.slug)));

  const payload = {
    orgId,
    slug: agent.slug,
    name: agent.name,
    description: agent.description ?? null,
    systemPrompt: agent.resolvedSystemPrompt,
    model: agent.model ?? defaults.model ?? 'gpt-4o',
    temperature: String(agent.temperature ?? defaults.temperature ?? '0.3'),
    skillSlugs: agent.skills,
    connectorSources: agent.connectorSources,
    objectTypeSlugs: agent.objectTypes,
    documentSetIds: agent.documentSetIds,
    approvalPolicy: agent.approvalPolicy,
    searchConfig: agent.searchConfig,
    fewShotExamples: agent.fewShotExamples,
    subagents: agent.resolvedSubagents,
    playbookTags: agent.playbookTags,
    learningSteps: agent.learningSteps,
    suggestions: agent.suggestions,
    accent: agent.accent ?? null,
    eyebrow: agent.eyebrow ?? null,
    langfuseProjectId: agent.langfuseProjectId ?? null,
    icon: agent.icon ?? null,
    active: String(agent.active),
  };

  if (!existing) {
    if (!dryRun) {
      await db.insert(agentSchema).values(payload);
    }
    return 'created';
  }

  if (isAgentEqual(existing, payload)) {
    return 'unchanged';
  }

  if (!dryRun) {
    await db.update(agentSchema).set(payload).where(eq(agentSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertWorkflow(orgId: string, workflow: LoadedWorkflow, dryRun: boolean): Promise<UpsertOutcome> {
  const [existing] = await db
    .select()
    .from(workflowSchema)
    .where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.slug, workflow.slug)));

  const payload = {
    orgId,
    slug: workflow.slug,
    name: workflow.name,
    description: workflow.description ?? null,
    version: workflow.version,
    status: workflow.status,
    trigger: workflow.trigger as unknown as Record<string, unknown>,
    steps: workflow.steps as unknown as Array<Record<string, unknown>>,
    inputSchema: workflow.inputSchema ?? null,
  };

  if (!existing) {
    if (!dryRun) {
      await db.insert(workflowSchema).values(payload);
    }
    return 'created';
  }

  if (isWorkflowEqual(existing, payload)) {
    return 'unchanged';
  }

  if (!dryRun) {
    await db.update(workflowSchema).set(payload).where(eq(workflowSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertPlaybook(orgId: string, pb: LoadedPlaybook, dryRun: boolean): Promise<UpsertOutcome> {
  const [existing] = await db
    .select()
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, pb.slug)));

  const payload = {
    orgId,
    slug: pb.slug,
    name: pb.name,
    description: pb.description,
    tags: pb.tags,
    frontmatter: {
      slug: pb.slug,
      name: pb.name,
      description: pb.description,
      tags: pb.tags,
      version: pb.version,
      resources: pb.resources,
      license: pb.license,
    } as Record<string, unknown>,
    contentSha: pb.contentSha,
    sourceFiles: pb.sourceFiles,
    license: pb.license ?? null,
    version: pb.version,
  };

  if (!existing) {
    if (!dryRun) {
      await db.insert(playbookSchema).values(payload);
    }
    return 'created';
  }

  if (
    existing.contentSha === payload.contentSha
    && existing.name === payload.name
    && existing.description === payload.description
    && existing.version === payload.version
    && canonical(existing.tags) === canonical(payload.tags)
    && canonical(existing.sourceFiles) === canonical(payload.sourceFiles)
  ) {
    return 'unchanged';
  }

  if (!dryRun) {
    await db.update(playbookSchema).set(payload).where(eq(playbookSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertEvalDataset(orgId: string, ds: LoadedEvalDataset, dryRun: boolean): Promise<UpsertOutcome> {
  const [existing] = await db
    .select()
    .from(evalDatasetSchema)
    .where(and(eq(evalDatasetSchema.orgId, orgId), eq(evalDatasetSchema.slug, ds.slug)));

  const payload = {
    orgId,
    slug: ds.slug,
    name: ds.name,
    description: ds.description ?? null,
    agentSlug: ds.agentSlug,
    items: ds.items,
    version: ds.version,
  };

  if (!existing) {
    if (!dryRun) {
      await db.insert(evalDatasetSchema).values(payload);
    }
    return 'created';
  }

  if (
    existing.name === payload.name
    && (existing.description ?? null) === payload.description
    && existing.agentSlug === payload.agentSlug
    && existing.version === payload.version
    && canonical(existing.items) === canonical(payload.items)
  ) {
    return 'unchanged';
  }
  if (!dryRun) {
    await db.update(evalDatasetSchema).set(payload).where(eq(evalDatasetSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertLearningStep(orgId: string, step: LoadedLearningStep, dryRun: boolean): Promise<UpsertOutcome> {
  const [existing] = await db
    .select()
    .from(learningStepSchema)
    .where(and(eq(learningStepSchema.orgId, orgId), eq(learningStepSchema.name, step.name)));

  const payload = {
    orgId,
    name: step.name,
    title: step.title,
    description: step.description,
    preamble: step.preamble ?? null,
    agentSlugs: step.agents,
  };

  if (!existing) {
    if (!dryRun) {
      await db.insert(learningStepSchema).values(payload);
    }
    return 'created';
  }

  if (
    existing.title === payload.title
    && existing.description === payload.description
    && (existing.preamble ?? null) === payload.preamble
    && canonical(existing.agentSlugs) === canonical(payload.agentSlugs)
  ) {
    return 'unchanged';
  }
  if (!dryRun) {
    await db.update(learningStepSchema).set(payload).where(eq(learningStepSchema.id, existing.id));
  }
  return 'updated';
}

function isWorkflowEqual(a: typeof workflowSchema.$inferSelect, b: Record<string, unknown>): boolean {
  return canonical({
    name: a.name,
    description: a.description,
    version: a.version,
    status: a.status,
    trigger: a.trigger,
    steps: a.steps,
    inputSchema: a.inputSchema,
  }) === canonical({
    name: b.name,
    description: b.description,
    version: b.version,
    status: b.status,
    trigger: b.trigger,
    steps: b.steps,
    inputSchema: b.inputSchema,
  });
}

function blank(): ResourceCounts {
  return { created: 0, updated: 0, unchanged: 0 };
}

function bump(counts: ResourceCounts, outcome: UpsertOutcome): void {
  counts[outcome] += 1;
}

// Equality helpers — JSON-stringify for structural comparison; avoids diffing timestamps/ids.
function isObjectTypeEqual(a: typeof businessObjectTypeSchema.$inferSelect, b: Record<string, unknown>): boolean {
  return canonical({
    label: a.label,
    description: a.description,
    icon: a.icon,
    schema: a.schema,
    sourceRelevance: a.sourceRelevance,
    classificationPrompt: a.classificationPrompt,
    fewShotExamples: a.fewShotExamples,
  }) === canonical({
    label: b.label,
    description: b.description,
    icon: b.icon,
    schema: b.schema,
    sourceRelevance: b.sourceRelevance,
    classificationPrompt: b.classificationPrompt,
    fewShotExamples: b.fewShotExamples,
  });
}

function isSkillEqual(a: typeof skillSchema.$inferSelect, b: Record<string, unknown>): boolean {
  return canonical({
    name: a.name,
    description: a.description,
    promptTemplate: a.promptTemplate,
    scriptFile: a.scriptFile,
    inputSchema: a.inputSchema,
    model: a.model,
    temperature: a.temperature,
    requiresApproval: a.requiresApproval,
    category: a.category,
    status: a.status,
    version: a.version,
  }) === canonical({
    name: b.name,
    description: b.description,
    promptTemplate: b.promptTemplate,
    scriptFile: b.scriptFile,
    inputSchema: b.inputSchema,
    model: b.model,
    temperature: b.temperature,
    requiresApproval: b.requiresApproval,
    category: b.category,
    status: b.status,
    version: b.version,
  });
}

function isAgentEqual(a: typeof agentSchema.$inferSelect, b: Record<string, unknown>): boolean {
  const fields = [
    'name',
    'description',
    'systemPrompt',
    'model',
    'temperature',
    'skillSlugs',
    'connectorSources',
    'objectTypeSlugs',
    'documentSetIds',
    'approvalPolicy',
    'searchConfig',
    'fewShotExamples',
    'subagents',
    'playbookTags',
    'learningSteps',
    'suggestions',
    'accent',
    'eyebrow',
    'langfuseProjectId',
    'icon',
    'active',
  ] as const;
  const pick = (src: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      out[f] = src[f];
    }
    return out;
  };
  return canonical(pick(a as unknown as Record<string, unknown>)) === canonical(pick(b));
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as object).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}
