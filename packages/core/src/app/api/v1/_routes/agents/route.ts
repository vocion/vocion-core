import { NextResponse } from 'next/server';
import { listAgents } from '@/services/AgentService';
import { authApi } from '../_shared';

/**
 * GET /api/v1/agents
 *
 * Every agent in the caller's workspace — slug, name, description, whether it
 * is active, and the skills it holds. This is the roster, not the definitions:
 * an agent's prompt and model come back from `/api/v1/agents/:slug`.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const agents = await listAgents(auth.orgId);
  return NextResponse.json({
    agents: agents.map(a => ({
      slug: a.slug,
      name: a.name,
      description: a.description,
      active: a.active === 'true',
      skillSlugs: a.skillSlugs ?? [],
      updatedAt: a.updatedAt,
    })),
  });
}
