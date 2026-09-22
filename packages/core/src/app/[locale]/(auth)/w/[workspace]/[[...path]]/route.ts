/**
 * `/w/[workspace]/[[...path]]` — the workspace entry route.
 *
 * A link mailed or posted about one workspace must open THAT workspace, not
 * whichever one the reader's browser last had active (design principle 8: "where
 * am I" must be obvious). This handler resolves `[workspace]` as a project
 * slug within the signed-in user's account, makes it the active project by
 * setting `vocion_active_project` — the very cookie the sidebar switcher
 * sets and `auth()` reads — and 302s to the page under `/dashboard`,
 * preserving the query string. Phase 2 (`docs/routing.md`) turns this
 * redirect into the canonical URL.
 *
 * - `/w/vocion-workforce`                → `/dashboard`
 * - `/w/vocion-workforce/dashboard/inbox` → `/dashboard/inbox`
 * - `/w/vocion-workforce/inbox?x=1`       → `/dashboard/inbox?x=1`
 * - `/w/Vocion-Workforce/...`             → same (case-insensitive slug)
 * - unknown slug, or a project on another account → 404 (indistinguishable
 *   on purpose: the reader learns nothing about other tenants' slugs)
 *
 * The auth proxy protects this segment, so an unsigned reader is sent to
 * sign-in with a `callbackUrl` pointing back here and lands in the right
 * workspace after signing in. The check below is the belt to that brace.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ACTIVE_PROJECT_COOKIE, ACTIVE_PROJECT_COOKIE_OPTIONS } from '@/libs/activeProject';
import { auth } from '@/libs/Auth';
import { publicOrigin } from '@/libs/http/publicOrigin';
import { routing } from '@/libs/I18nRouting';
import { workspaceRedirectPath } from '@/libs/links';
import { resolveProjectForUser } from '@/services/ProjectService';

type Params = { params: Promise<{ locale: string; workspace: string; path?: string[] }> };

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { locale, workspace, path } = await params;
  const origin = publicOrigin(request);

  const session = await auth();
  if (!session?.user?.id) {
    const prefix = locale !== routing.defaultLocale ? `/${locale}` : '';
    const signIn = new URL(`${prefix}/sign-in`, origin);
    signIn.searchParams.set('callbackUrl', new URL(request.nextUrl.pathname + request.nextUrl.search, origin).toString());
    return NextResponse.redirect(signIn, 302);
  }

  const project = await resolveProjectForUser(session.user.id, { slug: workspace });
  if (!project) {
    return new NextResponse('No such workspace', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const target = new URL(workspaceRedirectPath({ segments: path, search: request.nextUrl.search, locale }), origin);
  const response = NextResponse.redirect(target, 302);
  response.cookies.set(ACTIVE_PROJECT_COOKIE, project.id, ACTIVE_PROJECT_COOKIE_OPTIONS);
  return response;
}
