import { NextResponse } from 'next/server';
import { listSkills } from '@/services/SkillService';
import { authApi } from '../_shared';

export async function GET() {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const skills = await listSkills(auth.orgId);
  return NextResponse.json({
    skills: skills.map(s => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      category: s.category,
      status: s.status,
      version: s.version,
      model: s.model,
      requiresApproval: s.requiresApproval === 'true',
      updatedAt: s.updatedAt,
    })),
  });
}
