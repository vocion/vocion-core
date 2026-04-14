import type { LoadedAgent, LoadedContext, LoadedObjectType, LoadedSkill } from './loader';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, businessObjectTypeSchema, contextVersionSchema, skillSchema } from '@/models/Schema';

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
  return canonical({
    name: a.name,
    description: a.description,
    systemPrompt: a.systemPrompt,
    model: a.model,
    temperature: a.temperature,
    skillSlugs: a.skillSlugs,
    connectorSources: a.connectorSources,
    objectTypeSlugs: a.objectTypeSlugs,
    documentSetIds: a.documentSetIds,
    approvalPolicy: a.approvalPolicy,
    searchConfig: a.searchConfig,
    fewShotExamples: a.fewShotExamples,
    langfuseProjectId: a.langfuseProjectId,
    icon: a.icon,
    active: a.active,
  }) === canonical({
    name: b.name,
    description: b.description,
    systemPrompt: b.systemPrompt,
    model: b.model,
    temperature: b.temperature,
    skillSlugs: b.skillSlugs,
    connectorSources: b.connectorSources,
    objectTypeSlugs: b.objectTypeSlugs,
    documentSetIds: b.documentSetIds,
    approvalPolicy: b.approvalPolicy,
    searchConfig: b.searchConfig,
    fewShotExamples: b.fewShotExamples,
    langfuseProjectId: b.langfuseProjectId,
    icon: b.icon,
    active: b.active,
  });
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
