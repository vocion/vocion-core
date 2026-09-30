/**
 * Atlassian OAuth 2.0 (3LO) for Jira Cloud — the vendor calls, the grant
 * shape, and nothing about where it is stored.
 *
 * A grant is issued for an Atlassian account, not a site: one consent may
 * open several Jira Cloud sites, and every API call afterwards names the site
 * by its `cloudId` on `https://api.atlassian.com/ex/jira/{cloudId}`. So the
 * bag keeps every site the token can reach, and the connector picks the one
 * whose URL matches the source's `baseUrl`.
 *
 * Refresh tokens ROTATE: every refresh returns a new one and retires the old.
 * Whoever refreshes must persist what comes back at once, or the next refresh
 * fails and the person has to reconnect.
 */

export const ATLASSIAN_AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
export const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
export const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
export const ATLASSIAN_API_BASE = 'https://api.atlassian.com/ex/jira';

/** Read-only Jira plus the refresh token. `offline_access` is what earns the refresh token. */
export const JIRA_READ_SCOPES = ['read:jira-work', 'read:jira-user', 'offline_access'] as const;

/**
 * How far before Atlassian's own expiry the token is treated as expired.
 * Atlassian tokens last an hour; five minutes of slack covers a sync that
 * starts near the edge without paying a refresh on every run.
 */
const EXPIRY_MARGIN_SECONDS = 300;

export const ATLASSIAN_ENV = ['ATLASSIAN_CLIENT_ID', 'ATLASSIAN_CLIENT_SECRET'] as const;

/** One Jira Cloud site a grant can reach. */
export type AtlassianSite = { id: string; url: string; name: string };

/** The credential bag an Atlassian grant is stored as. */
export type AtlassianGrant = {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp, already shortened by the margin above. */
  expiresAt: string;
  scope: string;
  sites: AtlassianSite[];
  /** Pinned when the grant reached exactly one site; otherwise resolved per source. */
  cloudId?: string;
};

/** The deployment's OAuth client, or null when either half is unset. */
export function atlassianClient(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.ATLASSIAN_CLIENT_ID?.trim();
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Whether a credential bag is an Atlassian grant rather than a pasted
 * email + API token. `accessToken` is the tell; nothing else stores one.
 * @param credentials - The decrypted bag.
 */
export function isAtlassianGrant(credentials: Record<string, unknown> | undefined): credentials is AtlassianGrant {
  return typeof credentials?.accessToken === 'string' && typeof credentials.refreshToken === 'string';
}

/**
 * The expiry to store for a token issued now.
 * @param expiresIn - Atlassian's `expires_in`, seconds.
 * @param now - Injectable clock.
 */
export function expiresAtFrom(expiresIn: number, now: Date = new Date()): string {
  return new Date(now.getTime() + Math.max(0, expiresIn - EXPIRY_MARGIN_SECONDS) * 1000).toISOString();
}

/**
 * Whether a stored expiry is within `withinSeconds` of now (or already past).
 * @param expiresAt - The stored ISO expiry.
 * @param withinSeconds - The look-ahead.
 * @param now - Injectable clock.
 */
export function isExpiring(expiresAt: string, withinSeconds = 60, now: Date = new Date()): boolean {
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || at - now.getTime() <= withinSeconds * 1000;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

/**
 * One call to the token endpoint. Atlassian answers errors as JSON with
 * `error` and `error_description`; those are surfaced, the request body
 * (which carries the secret) never is.
 * @param body - The grant to send.
 */
async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    const why = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    throw new Error(`Atlassian token request failed: ${why}`);
  }
  return data as TokenResponse;
}

/**
 * Exchange the callback's authorization code for tokens.
 * @param input - The code and the redirect URI the authorize step used.
 * @param input.code
 * @param input.redirectUri
 */
export async function exchangeAuthorizationCode(input: { code: string; redirectUri: string }): Promise<TokenResponse> {
  const client = atlassianClient();
  if (!client) {
    throw new Error(`Atlassian OAuth is not configured — set ${ATLASSIAN_ENV.join(' and ')}.`);
  }
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
}

/**
 * Trade a refresh token for a new access token and, because Atlassian
 * rotates them, usually a new refresh token. The caller persists the result.
 * @param refreshToken - The stored refresh token.
 */
export async function refreshAtlassianGrant(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; scope?: string }> {
  const client = atlassianClient();
  if (!client) {
    throw new Error(`Atlassian OAuth is not configured — set ${ATLASSIAN_ENV.join(' and ')}.`);
  }
  const data = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
  });
  return {
    accessToken: data.access_token,
    // Rotation is the norm; keep the old one only when the reply carries none.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: expiresAtFrom(data.expires_in),
    scope: data.scope,
  };
}

/**
 * The Jira Cloud sites an access token can reach.
 * @param accessToken - A live access token.
 */
export async function listAccessibleSites(accessToken: string): Promise<AtlassianSite[]> {
  const res = await fetch(ATLASSIAN_RESOURCES_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Atlassian accessible-resources failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{ id: string; url: string; name: string }>;
  const seen = new Set<string>();
  const sites: AtlassianSite[] = [];
  for (const site of data) {
    if (!site?.id || seen.has(site.id)) {
      continue;
    }
    seen.add(site.id);
    sites.push({ id: site.id, url: site.url, name: site.name });
  }
  return sites;
}

/**
 * The site in a grant whose URL is the source's `baseUrl`, or null.
 * Trailing slashes and case in the host do not count as a difference.
 * @param grant - The stored grant.
 * @param baseUrl - The source's configured site URL.
 */
export function siteForBaseUrl(grant: Pick<AtlassianGrant, 'sites' | 'cloudId'>, baseUrl: string): AtlassianSite | null {
  const wanted = normaliseSiteUrl(baseUrl);
  if (grant.cloudId) {
    const pinned = grant.sites.find(site => site.id === grant.cloudId);
    if (pinned) {
      return pinned;
    }
  }
  return grant.sites.find(site => normaliseSiteUrl(site.url) === wanted) ?? null;
}

function normaliseSiteUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}
