/**
 * GET /api/connect/[provider]/callback
 *
 * The vendor sends the person back here. The state decides everything the
 * route acts on: its signature, its expiry and its org must all check out,
 * and the org must be the one the person is signed into. Then the provider
 * turns the query into a credential bag, which is stored on the source's
 * install and becomes the credential the connector uses. Nothing the vendor
 * sent is logged or echoed into the URL the person lands on.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';
import { providerFor } from '@/libs/connect/registry';
import { callbackUri, returnUrl } from '@/libs/connect/routes';
import { clearLinkedCredential, findSourceBySlug } from '@/libs/connect/sources';
import { verifyState } from '@/libs/connect/state';
import { storeCredentialForSource } from '@/services/SourceCredentialService';

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await ctx.params;
  const provider = providerFor(providerId);
  if (!provider) {
    return NextResponse.redirect(returnUrl(req, { ok: false, reason: 'unknown_provider' }), 303);
  }
  const verified = verifyState(req.nextUrl.searchParams.get('state'));
  if (!verified.ok) {
    return NextResponse.redirect(returnUrl(req, { ok: false, reason: `state_${verified.reason}` }), 303);
  }
  const { payload } = verified;
  if (payload.provider !== provider.id) {
    return NextResponse.redirect(returnUrl(req, { ok: false, reason: 'state_provider' }), 303);
  }
  const { orgId, userId } = await auth();
  if (!orgId || orgId !== payload.orgId) {
    return NextResponse.redirect(returnUrl(req, { ok: false, reason: 'wrong_workspace' }, payload.sourceSlug), 303);
  }
  const source = await findSourceBySlug(orgId, payload.sourceSlug);
  if (!source) {
    return NextResponse.redirect(returnUrl(req, { ok: false, reason: 'source_missing' }, payload.sourceSlug), 303);
  }
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'state') {
      query[key] = value;
    }
  });
  const exchanged = await provider.exchange({ query, redirectUri: callbackUri(req, provider.id) });
  if (!exchanged.ok) {
    console.error('[connect] vendor exchange refused', { provider: provider.id, source: source.slug, reason: exchanged.reason });
    return NextResponse.redirect(returnUrl(req, { ok: false, reason: exchanged.reason }, source.slug), 303);
  }
  try {
    await storeCredentialForSource({
      orgId,
      sourceSlug: source.slug,
      raw: exchanged.credentials,
      displayName: exchanged.displayName,
      userId: userId ?? payload.userId,
    });
    await clearLinkedCredential(orgId, source.id);
  } catch (error) {
    console.error('[connect] could not store the grant', {
      provider: provider.id,
      source: source.slug,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.redirect(returnUrl(req, { ok: false, reason: 'store_failed' }, source.slug), 303);
  }
  return NextResponse.redirect(returnUrl(req, { ok: true }, source.slug), 303);
}
