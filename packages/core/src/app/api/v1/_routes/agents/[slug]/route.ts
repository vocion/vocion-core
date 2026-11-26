import { NextResponse } from 'next/server';
import { getAgent } from '@/services/AgentService';
import { authApi, jsonError } from '../../_shared';

/**
 * GET /api/v1/agents/:slug
 *
 * One agent in full, including the system prompt it runs with and the model it
 * runs on. 404 when this workspace has no agent with that slug.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;
  const agent = await getAgent(auth.orgId, slug);
  if (!agent) {
    return jsonError('NOT_FOUND', `No agent found for slug "${slug}"`, 404);
  }
  return NextResponse.json({
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    active: agent.active === 'true',
    skillSlugs: agent.skillSlugs ?? [],
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    updatedAt: agent.updatedAt,
    createdAt: agent.createdAt,
  });
}
