/**
 * GET /api/connect/[provider]/start?source=<slug>
 *
 * Sends a workspace admin to the vendor to authorize a source. The state it
 * carries is signed and bound to this org, this source and this person; the
 * callback trusts nothing else. Same gate as pasting a key: admins only.
 *
 * Fails closed on configuration: no AUTH_SECRET means no state can be signed,
 * and no NEXT_PUBLIC_APP_URL means no redirect_uri can be named honestly.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';
import { providerFor, providerForConnector } from '@/libs/connect/registry';
import { callbackUri, connectOrigin, returnUrl } from '@/libs/connect/routes';
import { findSourceBySlug } from '@/libs/connect/sources';
import { signState } from '@/libs/connect/state';
import { Env } from '@/libs/Env';

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  // This route is a link a person follows — from the Connectors page, or a
  // chip in chat — so a refusal lands them back in the app with the reason
  // said (the same `returnUrl` the callback uses), never on a JSON body in
  // the tab they were reading in.
  const sourceSlug = req.nextUrl.searchParams.get('source')?.trim() ?? '';
  const land = (reason: string) => NextResponse.redirect(new URL(returnUrl('', { ok: false, reason }, sourceSlug || undefined), req.nextUrl.origin), 302);
  const { orgId, userId, role } = await auth();
  if (!orgId || !userId) {
    return land('signed_out');
  }
  if (role !== 'admin') {
    return land('not_admin');
  }
  const { provider: providerId } = await ctx.params;
  const provider = providerFor(providerId);
  if (!provider) {
    return land('unknown_provider');
  }
  if (!sourceSlug) {
    return land('source_missing');
  }
  const source = await findSourceBySlug(orgId, sourceSlug);
  if (!source) {
    return land('source_missing');
  }
  if (providerForConnector(source.connectorSlug)?.id !== provider.id) {
    return land('wrong_provider');
  }
  if (!provider.configured()) {
    return land('not_configured');
  }
  const origin = connectOrigin();
  if (!Env.AUTH_SECRET || !origin) {
    return land('server_unconfigured');
  }
  const state = signState({ provider: provider.id, orgId, sourceSlug: source.slug, userId });
  return NextResponse.redirect(provider.authorizeUrl({ state, redirectUri: callbackUri(origin, provider.id) }), 302);
}
