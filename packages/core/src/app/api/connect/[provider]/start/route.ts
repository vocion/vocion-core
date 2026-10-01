/**
 * GET /api/connect/[provider]/start?source=<slug>[&returnTo=/dashboard/...]
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
import { safeReturnPath } from '@/libs/connect/returnTo';
import { callbackUri, connectOrigin } from '@/libs/connect/routes';
import { findSourceBySlug } from '@/libs/connect/sources';
import { signState } from '@/libs/connect/state';
import { Env } from '@/libs/Env';

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { orgId, userId, role } = await auth();
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can connect a source' }, { status: 403 });
  }
  const { provider: providerId } = await ctx.params;
  const provider = providerFor(providerId);
  if (!provider) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }
  const sourceSlug = req.nextUrl.searchParams.get('source')?.trim() ?? '';
  if (!sourceSlug) {
    return NextResponse.json({ error: 'Missing source' }, { status: 400 });
  }
  const source = await findSourceBySlug(orgId, sourceSlug);
  if (!source) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  if (providerForConnector(source.connectorSlug)?.id !== provider.id) {
    return NextResponse.json({ error: `${source.slug} is not a ${provider.label} source` }, { status: 400 });
  }
  if (!provider.configured()) {
    return NextResponse.json(
      { error: `Connecting with ${provider.label} needs ${provider.requiredEnv.join(', ')} on the server.` },
      { status: 400 },
    );
  }
  const origin = connectOrigin();
  const missing = [
    ...(Env.AUTH_SECRET ? [] : ['AUTH_SECRET']),
    ...(origin ? [] : ['NEXT_PUBLIC_APP_URL']),
  ];
  if (missing.length > 0 || !origin) {
    return NextResponse.json(
      { error: `Connecting at a vendor needs ${missing.join(', ')} on the server.` },
      { status: 500 },
    );
  }
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get('returnTo'));
  const state = signState({ provider: provider.id, orgId, sourceSlug: source.slug, userId, ...(returnTo ? { returnTo } : {}) });
  return NextResponse.redirect(provider.authorizeUrl({ state, redirectUri: callbackUri(origin, provider.id) }), 302);
}
