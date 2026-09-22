/**
 * `/w/[workspace]/[[...path]]` — the fallback behind the canonical URL.
 *
 * Normally the proxy (`src/proxy.ts`) *rewrites* a canonical `/w/<slug>/…` to
 * the page and this handler never runs: the address bar keeps the workspace,
 * which is the whole point (`docs/routing.md`). It still runs where the proxy
 * cannot resolve a workspace — the demo sandbox, where PGlite cannot run in
 * the middleware bundle — and there it does the older, weaker thing: resolve
 * `[workspace]` within the signed-in user's account, make it active by setting
 * `vocion_active_project`, and 302 to the bare page. Keep it: it is the reason
 * a mailed link still opens the right workspace if the rewrite is ever off.
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
