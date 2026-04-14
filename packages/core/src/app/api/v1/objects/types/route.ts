import { NextResponse } from 'next/server';
import { listObjectTypes } from '@/services/BusinessObjectService';
import { authApi } from '../../_shared';

export async function GET() {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const types = await listObjectTypes(auth.orgId);
  return NextResponse.json({
    types: types.map(t => ({
      slug: t.slug,
      label: t.label,
      description: t.description,
      icon: t.icon,
      sourceRelevance: t.sourceRelevance ?? {},
      updatedAt: t.updatedAt,
    })),
  });
}
