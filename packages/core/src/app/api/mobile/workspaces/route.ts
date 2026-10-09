import { NextResponse } from 'next/server';
import { jsonError } from '@/app/api/v1/_shared';
import { auth } from '@/libs/Auth';
import { accountsForUser, listProjectsForUser } from '@/services/ProjectService';

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
 *
 * Only the Org the session is in ("Org" is what people call a
 * `tenant_account`). A person in two Orgs can hold the same slug in both, and
 * the share route names a workspace by slug alone, so listing the other Org
 * here would offer a target the share could resolve to the wrong one. The web
 * switcher is where Orgs are switched (vocion-core#128).
 *
 * `org` is the Org; `account` carries the same value for app builds that
 * still read it.
 */
export async function GET() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return jsonError('UNAUTHORIZED', 'Sign in first', 401);
  }
  const [everyProject, accounts] = await Promise.all([listProjectsForUser(user.id), accountsForUser(user.id)]);
  // This Org's workspaces, and the person's one Personal wherever it lives.
  const projects = everyProject.filter(p => p.accountId === user.accountId || p.kind === 'personal');
  const account = accounts.find(a => a.id === user.accountId) ?? null;
  const active = projects.find(p => p.id === user.projectId)?.slug ?? null;
  return NextResponse.json(
    {
      user: { id: user.id, email: user.email ?? null, name: user.name ?? null },
      org: account ? { name: account.name, slug: account.slug } : null,
      account: account ? { name: account.name, slug: account.slug } : null,
      active,
      workspaces: projects
        .map(p => ({ id: p.id, slug: p.slug, name: p.name, description: p.description, agentCount: p.agentCount }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
