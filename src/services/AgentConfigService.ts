import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, businessObjectSchema, businessObjectTypeSchema, skillSchema } from '@/models/Schema';

/**
 * Load a full agent configuration for display in the UI.
 * Resolves skill slugs to actual skill records, counts objects, etc.
 * @param orgId
 * @param slug
 */
export async function getAgentConfig(orgId: string, slug: string) {
  const agent = await db.query.agentSchema.findFirst({
    where: eq(agentSchema.slug, slug),
  });

  if (!agent) {
    return null;
  }

  // Resolve skills
  const allSkills = await db.query.skillSchema.findMany({
    where: eq(skillSchema.orgId, orgId),
  });

  const agentSkillSlugs = (agent.skillSlugs ?? []) as string[];
  const skills = allSkills.map(s => ({
    ...s,
    assignedToAgent: agentSkillSlugs.includes(s.slug),
  }));

  // Resolve object types with counts
  const objectTypes = await db.query.businessObjectTypeSchema.findMany({
    where: eq(businessObjectTypeSchema.orgId, orgId),
  });

  const objectCounts: Record<number, number> = {};
  const objects = await db.query.businessObjectSchema.findMany({
    where: eq(businessObjectSchema.orgId, orgId),
  });
  for (const obj of objects) {
    objectCounts[obj.typeId] = (objectCounts[obj.typeId] ?? 0) + 1;
  }

  const objectTypeSlugs = (agent.objectTypeSlugs ?? []) as string[];
  const typesWithCounts = objectTypes.map(t => ({
    ...t,
    count: objectCounts[t.id] ?? 0,
    assignedToAgent: objectTypeSlugs.includes(t.slug),
    sourceRelevance: t.sourceRelevance,
    classificationPrompt: t.classificationPrompt,
    fewShotExamples: t.fewShotExamples,
  }));

  return {
    agent,
    skills,
    objectTypes: typesWithCounts,
    connectorSources: (agent.connectorSources ?? []) as string[],
    approvalPolicy: (agent.approvalPolicy ?? {}) as Record<string, unknown>,
    searchConfig: (agent.searchConfig ?? {}) as {
      recencyDecay?: number;
      sourceWeights?: Record<string, number>;
      maxResults?: number;
      minRelevance?: number;
    },
    fewShotExamples: (agent.fewShotExamples ?? []) as Array<{
      input: string;
      output: string;
      label?: string;
    }>,
  };
}
