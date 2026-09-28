import { NextResponse } from 'next/server';
import { jsonError } from '@/app/api/v1/_shared';
import { auth } from '@/libs/Auth';
import { accountForUser, listProjectsForUser } from '@/services/ProjectService';

/**
 * `GET /api/mobile/workspaces` — the native workspace picker's list.
 *
 * The iOS app signs in with the dashboard's own session and then asks which
 * workspaces this person can open, so it can offer them before loading
 * `/w/<slug>/…`. Session auth only, like the composer's upload route: a
 * tenant token names one workspace and has nothing to pick between.
 *
 * `active` is the workspace a bare `/dashboard` would land in, so a first
 * launch can pre-select it.
 */
export async function GET() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return jsonError('UNAUTHORIZED', 'Sign in first', 401);
  }
  const [projects, account] = await Promise.all([listProjectsForUser(user.id), accountForUser(user.id)]);
  const active = projects.find(p => p.id === user.projectId)?.slug ?? null;
  return NextResponse.json(
    {
      user: { id: user.id, email: user.email ?? null, name: user.name ?? null },
      account: account ? { name: account.name, slug: account.slug } : null,
      active,
      workspaces: projects
        .map(p => ({ id: p.id, slug: p.slug, name: p.name, description: p.description, agentCount: p.agentCount }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
