import { NextResponse } from 'next/server';
import { listAgents } from '@/services/AgentService';
import { authApi } from '../_shared';

export async function GET() {
  const auth = await authApi();
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
