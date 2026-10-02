/**
 * GET /api/connect/[provider]/callback
 *
 * The vendor sends the person back here. The state decides everything the
 * route acts on: its signature, its expiry, its provider, its org and its
 * person must all check out against the session, and the session must be an
 * admin's. Then the provider turns the query into a credential bag, stored on
 * the org's install of the CONNECTOR (`config._connector`), which is where
 * sync reads it: one grant serves every source of that kind in the workspace.
 *
 * Nothing the vendor sent is logged or echoed verbatim; a refusal reaches the
 * landing URL only as a sanitized short code.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';
import { providerFor } from '@/libs/connect/registry';
import { callbackUri, connectOrigin, returnUrl } from '@/libs/connect/routes';
import { clearLinkedCredential, findSourceBySlug } from '@/libs/connect/sources';
import { verifyState } from '@/libs/connect/state';
import { storeCredentialForSource } from '@/services/SourceCredentialService';

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  // A missing origin still lands the person somewhere sensible: a relative URL.
  const origin = connectOrigin() ?? '';
  const land = (outcome: { ok: true } | { ok: false; reason: string }, sourceSlug?: string) =>
    NextResponse.redirect(new URL(returnUrl(origin, outcome, sourceSlug), req.nextUrl), 303);

  const { provider: providerId } = await ctx.params;
  const provider = providerFor(providerId);
  if (!provider) {
    return land({ ok: false, reason: 'unknown_provider' });
  }
  let verified: ReturnType<typeof verifyState>;
  try {
    verified = verifyState(req.nextUrl.searchParams.get('state'));
  } catch {
    // AUTH_SECRET is unset: nothing signed this and nothing can check it.
    return land({ ok: false, reason: 'server_unconfigured' });
  }
  if (!verified.ok) {
    return land({ ok: false, reason: `state_${verified.reason}` });
  }
  const { payload } = verified;
  if (payload.provider !== provider.id) {
    return land({ ok: false, reason: 'state_provider' });
  }
  const { orgId, userId, role } = await auth();
  if (!orgId || !userId) {
    return land({ ok: false, reason: 'signed_out' }, payload.sourceSlug);
  }
  if (orgId !== payload.orgId) {
    return land({ ok: false, reason: 'wrong_workspace' }, payload.sourceSlug);
  }
  if (userId !== payload.userId) {
    return land({ ok: false, reason: 'wrong_person' }, payload.sourceSlug);
  }
  if (role !== 'admin') {
    return land({ ok: false, reason: 'not_admin' }, payload.sourceSlug);
  }
  const source = await findSourceBySlug(orgId, payload.sourceSlug);
  if (!source) {
    return land({ ok: false, reason: 'source_missing' }, payload.sourceSlug);
  }
  if (!origin) {
    return land({ ok: false, reason: 'server_unconfigured' }, source.slug);
  }
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'state') {
      query[key] = value;
    }
  });
  const exchanged = await provider.exchange({ query, redirectUri: callbackUri(origin, provider.id) });
  if (!exchanged.ok) {
    console.error('[connect] vendor exchange refused', { provider: provider.id, source: source.slug, reason: exchanged.reason });
    return land({ ok: false, reason: exchanged.reason }, source.slug);
  }
  try {
    await storeCredentialForSource({
      orgId,
      // The connector, not the source: sync resolves the install by
      // `config._connector`, and one grant covers every source of the kind.
      sourceSlug: source.connectorSlug,
      raw: exchanged.credentials,
      displayName: `${exchanged.displayName} (${source.slug})`,
      userId,
    });
    await clearLinkedCredential(orgId, source.id);
  } catch (error) {
    console.error('[connect] could not store the grant', {
      provider: provider.id,
      source: source.slug,
      message: error instanceof Error ? error.message : String(error),
    });
    return land({ ok: false, reason: 'store_failed' }, source.slug);
  }
  return land({ ok: true }, source.slug);
}
