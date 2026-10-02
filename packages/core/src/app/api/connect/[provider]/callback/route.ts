/**
 * GET /api/connect/[provider]/callback
 *
 * The vendor sends the person back here. The state decides everything the
 * route acts on: its signature, its expiry, its provider, its org and its
 * person must all check out against the session, and the session must be an
 * admin's. Only then does the provider turn the query into a credential bag.
 *
 * The grant is a login row in the workspace credential store (`api_token`),
 * not the install of a source (#1080): `completeLogin` stores it and links the
 * connector's sources to it, and records the dated attempt. A chat card the
 * login came from is marked approved by the person who logged in.
 *
 * Nothing is written, not even an attempt, until every state, org, person and
 * admin check has passed: a crafted or expired state leaves no trace. Nothing
 * the vendor sent is logged or echoed verbatim; a refusal reaches the landing
 * URL only as a sanitized short code.
 */

import type { NextRequest } from 'next/server';
import type { ConnectProvider } from '@/libs/connect/provider';
import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';
import { providerFor } from '@/libs/connect/registry';
import { returnUrl } from '@/libs/connect/returnTo';
import { callbackUri, connectOrigin } from '@/libs/connect/routes';
import { findSourceBySlug } from '@/libs/connect/sources';
import { stateIssuedAt, verifyState } from '@/libs/connect/state';
import { approveLoginCard, completeLogin, recordFailedLogin } from '@/services/connect/completeLogin';
import { createSourceWhenNoConfigNeeded, loginMakesItsSource } from '@/services/connect/createSourceOnLogin';

type Landing = { source?: string; connector?: string; returnTo?: string | null };
type ChatCard = { conversationId: number; cardId: string };
type FailedLogin = { orgId: string; userId: string; provider: ConnectProvider; connectorSlug: string; reason: string; card?: ChatCard; stateIssuedAt?: Date };

/**
 * Redirect the person to where the connect ends. A missing origin still lands
 * somewhere sensible: a relative URL.
 * @param request - The callback request, for resolving a relative URL.
 * @param origin - The configured public origin, or `''`.
 * @param outcome - `ok`, or the short refusal code.
 * @param params - The source, connector and return path to land with.
 */
function landAt(request: NextRequest, origin: string, outcome: { ok: true } | { ok: false; reason: string }, params: Landing = {}) {
  return NextResponse.redirect(new URL(returnUrl(origin, outcome, params), request.nextUrl), 303);
}

/**
 * Record a login that did not finish, then land with its reason. Called only
 * after the state's org, person and admin checks have passed.
 * @param request - The callback request.
 * @param origin - The configured public origin, or `''`.
 * @param failed - Who tried, with which provider, connector and reason.
 * @param landing - Where to land.
 */
async function failAndLand(request: NextRequest, origin: string, failed: FailedLogin, landing: Landing) {
  try {
    await recordFailedLogin(failed);
  } catch (error) {
    console.error('[connect] could not record the failed login', {
      provider: failed.provider.id,
      connector: failed.connectorSlug,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return landAt(request, origin, { ok: false, reason: failed.reason }, landing);
}

/**
 * Approve the chat card once the login and its source both exist. The card is
 * a view: a failure here is logged and the login stands.
 * @param orgId - The workspace.
 * @param userId - The admin who logged in.
 * @param provider - The provider the login was with.
 * @param connectorSlug - The connector it was for.
 * @param card - The chat card.
 */
async function approveCard(orgId: string, userId: string, provider: ConnectProvider, connectorSlug: string, card: ChatCard) {
  try {
    await approveLoginCard({ orgId, userId, card });
  } catch (error) {
    console.error('[connect] could not approve the chat card', {
      provider: provider.id,
      connector: connectorSlug,
      message: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/**
 * Finish a login whose exchange succeeded: store it, and land.
 * @param request - The callback request.
 * @param origin - The configured public origin, or `''`.
 * @param done - What `completeLogin` needs.
 * @param issuedAt - When the login's state was signed.
 * @param landing - Where to land.
 */
async function storeAndLand(request: NextRequest, origin: string, done: Parameters<typeof completeLogin>[0], issuedAt: Date, landing: Landing) {
  const { orgId, userId, provider, connectorSlug, card } = done;
  // A connector that makes its own source approves the card only once that source exists.
  const makesSource = loginMakesItsSource(connectorSlug);
  let outcome: Awaited<ReturnType<typeof completeLogin>>;
  try {
    outcome = await completeLogin(makesSource ? { ...done, card: undefined } : done);
  } catch (error) {
    // Nothing was written: the login ran in one transaction.
    console.error('[connect] could not store the login', {
      provider: provider.id,
      connector: connectorSlug,
      message: error instanceof Error ? error.message : String(error),
    });
    return failAndLand(request, origin, { orgId, userId, provider, connectorSlug, card, reason: 'store_failed', stateIssuedAt: issuedAt }, landing);
  }
  if (!outcome.ok) {
    console.error('[connect] login not finished', { provider: provider.id, connector: connectorSlug, reason: outcome.reason });
    return failAndLand(request, origin, { orgId, userId, provider, connectorSlug, card, reason: outcome.reason, stateIssuedAt: issuedAt }, landing);
  }
  // A connector that needs no picks has its source now; one that does is finished in chat or on the Connectors form.
  const made = await createSourceWhenNoConfigNeeded({ orgId, userId, connector: connectorSlug, linkedSourceIds: outcome.linkedSourceIds });
  if (made.failed) {
    // The login is stored and valid; the person is told the source is missing. No stateIssuedAt: this is a real failure after the success.
    return failAndLand(request, origin, { orgId, userId, provider, connectorSlug, card, reason: 'source_not_created' }, landing);
  }
  if (card && makesSource) {
    await approveCard(orgId, userId, provider, connectorSlug, card);
  }
  return landAt(request, origin, { ok: true }, landing);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const origin = connectOrigin() ?? '';

  const { provider: providerId } = await ctx.params;
  const provider = providerFor(providerId);
  if (!provider) {
    return landAt(req, origin, { ok: false, reason: 'unknown_provider' });
  }
  let verified: ReturnType<typeof verifyState>;
  try {
    verified = verifyState(req.nextUrl.searchParams.get('state'));
  } catch {
    // AUTH_SECRET is unset: nothing signed this and nothing can check it.
    return landAt(req, origin, { ok: false, reason: 'server_unconfigured' });
  }
  if (!verified.ok) {
    return landAt(req, origin, { ok: false, reason: `state_${verified.reason}` });
  }
  const { payload } = verified;
  if (payload.provider !== provider.id) {
    return landAt(req, origin, { ok: false, reason: 'state_provider' }, { returnTo: payload.returnTo });
  }
  const { orgId, userId, role } = await auth();
  const early: Landing = { source: payload.sourceSlug, connector: payload.connectorSlug, returnTo: payload.returnTo };
  if (!orgId || !userId) {
    return landAt(req, origin, { ok: false, reason: 'signed_out' }, early);
  }
  if (orgId !== payload.orgId) {
    return landAt(req, origin, { ok: false, reason: 'wrong_workspace' }, early);
  }
  if (userId !== payload.userId) {
    return landAt(req, origin, { ok: false, reason: 'wrong_person' }, early);
  }
  if (role !== 'admin') {
    return landAt(req, origin, { ok: false, reason: 'not_admin' }, early);
  }

  // Every check on who is asking has passed: from here a failure is recorded.
  const issuedAt = stateIssuedAt(payload);
  const card = payload.conversationId !== undefined && payload.cardId
    ? { conversationId: payload.conversationId, cardId: payload.cardId }
    : undefined;
  const source = payload.sourceSlug ? await findSourceBySlug(orgId, payload.sourceSlug) : null;
  const connectorSlug = payload.connectorSlug ?? source?.connectorSlug;
  if (!connectorSlug) {
    // A state naming only a source that is gone: there is no connector to
    // record the attempt against.
    return landAt(req, origin, { ok: false, reason: 'source_missing' }, early);
  }
  const landing: Landing = { source: payload.sourceSlug, connector: connectorSlug, returnTo: payload.returnTo };
  if (payload.sourceSlug && !source) {
    return failAndLand(req, origin, { orgId, userId, provider, connectorSlug, reason: 'source_missing', card, stateIssuedAt: issuedAt }, landing);
  }
  if (!origin) {
    return failAndLand(req, origin, { orgId, userId, provider, connectorSlug, reason: 'server_unconfigured', card, stateIssuedAt: issuedAt }, landing);
  }
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'state') {
      query[key] = value;
    }
  });
  let exchanged: Awaited<ReturnType<typeof provider.exchange>>;
  try {
    exchanged = await provider.exchange({ query, redirectUri: callbackUri(origin, provider.id) });
  } catch (error) {
    // The vendor timed out, refused the connection or sent something unreadable. Nothing was stored.
    console.error('[connect] vendor exchange threw', {
      provider: provider.id,
      connector: connectorSlug,
      message: error instanceof Error ? error.name : 'unknown',
    });
    return failAndLand(req, origin, { orgId, userId, provider, connectorSlug, reason: 'provider_unreachable', card, stateIssuedAt: issuedAt }, landing);
  }
  if (!exchanged.ok) {
    console.error('[connect] vendor exchange refused', { provider: provider.id, connector: connectorSlug, reason: exchanged.reason });
    return failAndLand(req, origin, { orgId, userId, provider, connectorSlug, reason: exchanged.reason, card, stateIssuedAt: issuedAt }, landing);
  }
  return storeAndLand(
    req,
    origin,
    { orgId, userId, provider, connectorSlug, sourceSlug: source?.slug, exchanged: { credentials: exchanged.credentials, displayName: exchanged.displayName }, card },
    issuedAt,
    landing,
  );
}
