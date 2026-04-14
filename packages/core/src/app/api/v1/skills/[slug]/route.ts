import { NextResponse } from 'next/server';
import { getSkill } from '@/services/SkillService';
import { authApi, jsonError } from '../../_shared';

export async function GET(_req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;
  const skill = await getSkill(auth.orgId, slug);
  if (!skill) {
    return jsonError('NOT_FOUND', `No skill found for slug "${slug}"`, 404);
  }
  return NextResponse.json({
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    status: skill.status,
    version: skill.version,
    model: skill.model,
    temperature: skill.temperature,
    requiresApproval: skill.requiresApproval === 'true',
    inputSchema: skill.inputSchema,
    promptTemplate: skill.promptTemplate,
    updatedAt: skill.updatedAt,
    createdAt: skill.createdAt,
  });
}
