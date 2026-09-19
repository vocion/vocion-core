/**
 * Browser OAuth — the two halves of a consent, and the rules that make the
 * callback answerable.
 *
 * `beginOAuth` mints a state row and returns the consent URL; `completeOAuth`
 * verifies that row, exchanges the code and stores the grant. Everything that
 * decides anything comes from the ROW, never from the callback's query string:
 * the callback is a GET anybody can hand a signed-in browser, so a crafted
 * link must not be able to say which org, which connector, or whose grant.
 *
 * The OAuth client is the workspace's own (`{ clientId, clientSecret }` stored
 * under API credentials). A Vocion-owned app would be one tap instead of that
 * setup step and costs a Google verification review for the restricted Gmail
 * scopes — weeks, and not a thing to block this on.
 */

import type { OAuthProvider } from '@/libs/oauth/providers';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { pkcePair, randomToken } from '@/libs/oauth/pkce';
import { OAUTH_PROVIDERS } from '@/libs/oauth/providers';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { resolveIdentity } from '@/libs/sources/types';
import { oauthStateSchema } from '@/models/Schema';
import { invalidateAgentGraphs } from '@/services/agents/harness';
import { listPlatformCredentials, resolveCredentialById } from '@/services/ApiTokenService';
import { storeCredentialForSource } from '@/services/SourceCredentialService';

/** How long a consent may sit unfinished. Long enough to read a scope list. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Written for the person who has to fix it, and safe to show.
 *
 * Every other failure in this file is logged and replaced with something
 * generic, because a token-exchange body can carry a client secret.
 */
export class OAuthSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthSetupError';
  }
}

/**
 * The workspace's OAuth client for a provider, or null when it stored none.
 * @param orgId
 * @param provider
 */
export async function oauthClientForOrg(
  orgId: string,
  provider: OAuthProvider,
): Promise<{ clientId: string; clientSecret: string } | null> {
  // Newest live credential that actually carries a client pair. A workspace
  // holds several Google credentials over its life (they differ by refresh
  // token) and they share one OAuth app, so "the newest that has a client" is
  // the answer rather than a guess between unlike things.
  for (const summary of await listPlatformCredentials(orgId, provider.platform)) {
    const resolved = await resolveCredentialById(orgId, summary.id);
    if (resolved.status !== 'ok') {
      continue;
    }
    const clientId = typeof resolved.values.clientId === 'string' ? resolved.values.clientId : '';
    const clientSecret = typeof resolved.values.clientSecret === 'string' ? resolved.values.clientSecret : '';
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
  }
  return null;
}

/**
 * Where the vendor sends the browser back. Must match the client's registered URI exactly.
 * @param origin
 * @param platform
 */
export function redirectUriFor(origin: string, platform: string): string {
  return `${origin}/api/oauth/${platform}/callback`;
}

/**
 * A return path that cannot leave this site.
 *
 * Anything but a single-slash-prefixed path is dropped: `//evil.com` is a
 * protocol-relative URL the browser follows off-site, which is the whole open-
 * redirect family in one string.
 * @param raw - Whatever the caller asked to return to.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return null;
  }
  return raw;
}

/**
 * Start a consent: mint the state row, return the URL to send the browser to.
 * @param input - Who is consenting and to what.
 * @param input.orgId - The workspace.
 * @param input.userId - The session's user. The grant is written against this.
 * @param input.connectorSlug - Which connector is being connected.
 * @param input.scopes - The vendor scopes to ask for, derived from the tool that triggered this.
 * @param input.origin - This deployment's origin, for the redirect URI.
 * @param input.returnTo - Same-site path to come back to.
 */
export async function beginOAuth(input: {
  orgId: string;
  userId: string;
  connectorSlug: string;
  scopes: string[];
  origin: string;
  returnTo?: string | null;
}): Promise<{ url: string }> {
  const connector = getConnector(input.connectorSlug);
  if (!connector) {
    throw new OAuthSetupError(`No connector named ${input.connectorSlug}.`);
  }
  const platform = platformForConnectorSlug(input.connectorSlug);
  const provider = platform ? OAUTH_PROVIDERS[platform.id] : undefined;
  if (!platform || !provider) {
    throw new OAuthSetupError(`${connector.name} does not sign in through the browser.`);
  }

  const client = await oauthClientForOrg(input.orgId, provider);
  if (!client) {
    // The BYO setup step, named plainly. Without this the person meets a
    // vendor error page saying `invalid_client`, which tells them nothing.
    throw new OAuthSetupError(
      `This workspace has no ${provider.label} OAuth client stored yet. An admin adds the client ID and secret under Settings → API credentials, once, and then anyone can connect.`,
    );
  }

  const scopes = input.scopes.length > 0 ? input.scopes : defaultScopesFor(input.connectorSlug);
  if (scopes.length === 0) {
    throw new OAuthSetupError(`${connector.name} declares no scopes to ask for.`);
  }

  const state = randomToken();
  const pkce = provider.pkce ? pkcePair() : null;
  await sweepExpiredStates();
  await db.insert(oauthStateSchema).values({
    state,
    orgId: input.orgId,
    userId: input.userId,
    connectorSlug: input.connectorSlug,
    platform: platform.id,
    codeVerifier: pkce?.verifier ?? null,
    scopes: scopes.join(' '),
    redirectTo: safeReturnPath(input.returnTo),
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUriFor(input.origin, platform.id));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(provider.scopeSeparator));
  url.searchParams.set('state', state);
  for (const [key, value] of Object.entries(provider.authorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  if (pkce) {
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', pkce.method);
  }
  return { url: url.toString() };
}

/**
 * Finish a consent: verify the state, exchange the code, store the grant.
 *
 * Returns where to send the browser. The org, the user and the connector all
 * come from the stored row — the only thing read out of the callback is the
 * code itself, and that is worthless without the row's verifier.
 * @param input - What came back from the vendor.
 * @param input.state - The state parameter, as returned.
 * @param input.code - The authorization code.
 * @param input.origin - This deployment's origin, for the redirect URI.
 */
export async function completeOAuth(input: {
  state: string;
  code: string;
  origin: string;
}): Promise<{ returnTo: string; connectorSlug: string; scope: 'user' | 'workspace' }> {
  const [row] = await db
    .select()
    .from(oauthStateSchema)
    .where(and(eq(oauthStateSchema.state, input.state), isNull(oauthStateSchema.consumedAt)));
  if (!row) {
    // Unknown, already used, or forged. One message for all three: telling a
    // caller which would let them probe for live states.
    throw new OAuthSetupError('That sign-in link is no longer valid. Start the connection again.');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new OAuthSetupError('That sign-in took too long to finish. Start the connection again.');
  }
  // Single-use, claimed before the exchange: two callbacks racing the same
  // state must not both store a grant.
  const claimed = await db
    .update(oauthStateSchema)
    .set({ consumedAt: new Date() })
    .where(and(eq(oauthStateSchema.state, input.state), isNull(oauthStateSchema.consumedAt)))
    .returning({ state: oauthStateSchema.state });
  if (claimed.length === 0) {
    throw new OAuthSetupError('That sign-in link was already used. Start the connection again.');
  }

  const provider = OAUTH_PROVIDERS[row.platform];
  if (!provider) {
    throw new OAuthSetupError('That connector no longer signs in through the browser.');
  }
  const client = await oauthClientForOrg(row.orgId, provider);
  if (!client) {
    throw new OAuthSetupError(`This workspace no longer has a ${provider.label} OAuth client stored.`);
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: redirectUriFor(input.origin, row.platform),
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  if (row.codeVerifier) {
    body.set('code_verifier', row.codeVerifier);
  }

  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // The response body can echo the request, client secret included, so it is
    // logged rather than shown. `error` alone is a vendor code and safe.
    console.error('[oauth] token exchange failed', {
      platform: row.platform,
      status: res.status,
      error: typeof payload.error === 'string' ? payload.error : undefined,
    });
    throw new OAuthSetupError(`${provider.label} refused the sign-in. Check the OAuth client's redirect URI and try again.`);
  }

  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';
  if (!refreshToken) {
    // Google returns one only with `access_type=offline` and `prompt=consent`,
    // and this is what it looks like when either is missing: an access token
    // that dies in an hour and nothing saying why.
    throw new OAuthSetupError(`${provider.label} returned no refresh token, so the connection would stop working within the hour. Remove the app's prior consent and connect again.`);
  }

  // Per-member for a personal connector, workspace-wide for a shared one — the
  // same fork `getCredentialsForConnector` resolves by, so a grant made here is
  // reachable by exactly whoever the tier says it should be.
  const identity = resolveIdentity(getConnector(row.connectorSlug)?.identity);
  const scope = identity === 'personal' ? 'user' : 'workspace';
  await storeCredentialForSource({
    orgId: row.orgId,
    sourceSlug: row.connectorSlug,
    raw: {
      refreshToken,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      ...(typeof payload.scope === 'string' ? { scope: payload.scope } : {}),
    },
    displayName: `${provider.label} — ${scope === 'user' ? row.userId : 'workspace'}`,
    userId: scope === 'user' ? row.userId : null,
    projectId: row.orgId,
  });
  // The tool surface changed: without this the next turn still holds connect
  // stubs and offers a card for a credential that now exists.
  invalidateAgentGraphs(row.orgId);

  return {
    returnTo: row.redirectTo ?? '/dashboard/connectors',
    connectorSlug: row.connectorSlug,
    scope,
  };
}

/**
 * The scopes to ask for when the caller named none — a connector's `default`.
 * @param connectorSlug - Which connector.
 */
function defaultScopesFor(connectorSlug: string): string[] {
  const scopes = getConnector(connectorSlug)?.scopes;
  return [...(scopes?.default ?? [])];
}

/** Drop states nobody finished. Cheap, and keeps the table from growing forever. */
async function sweepExpiredStates(): Promise<void> {
  await db.delete(oauthStateSchema).where(lt(oauthStateSchema.expiresAt, new Date(Date.now() - STATE_TTL_MS)));
}
