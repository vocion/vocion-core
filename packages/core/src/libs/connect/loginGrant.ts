/**
 * Logins whose access token expires (#1080): the shape they store, the token
 * request every vendor shares, and the refresh a sync runs before it reads.
 *
 * A login grant is `{ accessToken, refreshToken, expiresAt }` plus whatever
 * the provider keeps beside it (the account, a workspace id). `expiresAt` is
 * ISO and five minutes early, so a token is never sent in its last minutes.
 *
 * The refresh is the one Jira's Atlassian grant runs (`sources/jira.ts`), for
 * every other vendor: refresh from the STORED refresh token, not the one this
 * run loaded, because another sync may already have rotated it; save the new
 * grant to the row it was read from, compare-and-swap on the refresh token
 * it came from; and when another sync won that race, use the winner's grant.
 * Test connection never refreshes: a rotated refresh token it could not save
 * would strand the stored one.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { knowledgeSourceSchema } from '@/models/Schema';
import { claimLoginRefresh, releaseLoginRefresh, updateLoginCredentialValues } from '@/services/ApiTokenService';
import { getCredentialsForConnector, updateCredentialValuesForConnector } from '@/services/SourceCredentialService';
import { refusalFix, TokenRequestError } from './tokenRequest';

export type LoginGrant = Record<string, unknown> & { accessToken: string; refreshToken: string; expiresAt: string };

/** What a vendor's refresh returns. A vendor that keeps the same refresh token returns the one it was given. */
export type RefreshedTokens = { accessToken: string; refreshToken: string; expiresAt: string; scope?: string };

/** Mints new tokens from a refresh token, or throws `TokenRequestError`. */
export type GrantRefresher = (refreshToken: string) => Promise<RefreshedTokens>;

/**
 * What a sync does with a rotated token: save it (a sync), or refuse to
 * refresh at all (Test connection, which has no source row to save it to).
 */
export type GrantPersistence
  = | { kind: 'persist'; orgId: string; sourceId: number; warn: (message: string) => void }
    | { kind: 'never' };

const EXPIRES_EARLY_MS = 5 * 60 * 1000;

/**
 * Whether a credential bag is a login grant: a non-empty access token,
 * refresh token and expiry. A pasted key never is.
 * @param credentials - The decrypted bag.
 */
export function isLoginGrant(credentials: unknown): credentials is LoginGrant {
  if (!credentials || typeof credentials !== 'object') {
    return false;
  }
  const bag = credentials as Record<string, unknown>;
  return typeof bag.accessToken === 'string' && bag.accessToken.length > 0
    && typeof bag.refreshToken === 'string' && bag.refreshToken.length > 0
    && typeof bag.expiresAt === 'string' && bag.expiresAt.length > 0;
}

/**
 * When a token from a response with `expires_in` should count as expired:
 * five minutes before the vendor's own expiry.
 * @param expiresInSeconds - The response's `expires_in`; anything but a positive number is a missing value.
 * @param fallbackSeconds - The vendor's documented lifetime, for a response without `expires_in`.
 * @param now - Injected for tests.
 */
export function grantExpiresAt(expiresInSeconds: unknown, fallbackSeconds: number, now: number = Date.now()): string {
  const seconds = typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? expiresInSeconds
    : fallbackSeconds;
  return new Date(now + seconds * 1000 - EXPIRES_EARLY_MS).toISOString();
}

/**
 * Whether a grant's access token must be refreshed before use. An expiry
 * that does not parse counts as expired, so a damaged bag refreshes rather
 * than failing every call.
 * @param expiresAt - The grant's `expiresAt`.
 * @param now - Injected for tests.
 */
export function grantIsExpiring(expiresAt: string, now: number = Date.now()): boolean {
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || at <= now;
}

/** The stored grant and the `api_token` row it was read from (null: the install's `source_credential`). */
type StoredGrant = { grant: LoginGrant; apiTokenId: string | null };

/**
 * The grant stored now for a source, read the way a sync loads it: the
 * source's own `api_token_id`, else the connector's install credential.
 * Null when the stored bag is not a grant, or cannot be read.
 * @param orgId - The workspace.
 * @param sourceId - The source being synced.
 * @param connectorSlug - The source's connector.
 */
async function readStoredGrant(orgId: string, sourceId: number, connectorSlug: string): Promise<StoredGrant | null> {
  try {
    const [row] = await db
      .select({ apiTokenId: knowledgeSourceSchema.apiTokenId })
      .from(knowledgeSourceSchema)
      .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)))
      .limit(1);
    const apiTokenId = row?.apiTokenId ?? null;
    const stored = await getCredentialsForConnector({ orgId, connectorSlug, apiTokenId });
    return isLoginGrant(stored) ? { grant: stored, apiTokenId } : null;
  } catch (error) {
    // Unreadable is "nothing stored": the refresh then uses the token this run
    // loaded, and the save after it reports whatever is wrong with the row.
    logger.warn('readStoredGrant could not read the stored login', { orgId, sourceId, connectorSlug, errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/**
 * Save a refreshed grant to the row it was read from, compare-and-swap on the
 * refresh token it came from.
 * @param input - Where the grant came from, the new bag and its parent token.
 * @param input.orgId - The workspace.
 * @param input.connectorSlug - The source's connector.
 * @param input.apiTokenId - The login row it was read from, or null for the install's `source_credential`.
 * @param input.grant - The complete new bag.
 * @param input.parentRefreshToken - The refresh token it was refreshed from.
 */
async function saveRefreshedGrant(input: { orgId: string; connectorSlug: string; apiTokenId: string | null; grant: LoginGrant; parentRefreshToken: string }): Promise<boolean> {
  if (input.apiTokenId !== null) {
    return updateLoginCredentialValues({ orgId: input.orgId, tokenId: input.apiTokenId, values: input.grant, expectedRefreshToken: input.parentRefreshToken });
  }
  return updateCredentialValuesForConnector({ orgId: input.orgId, connectorSlug: input.connectorSlug, raw: input.grant, expectedRefreshToken: input.parentRefreshToken });
}

/** How long a refresh claim lasts: the vendor's 15-second timeout, the save, and room to spare. */
const REFRESH_CLAIM_MS = 30_000;

/**
 * How a caller waits out another caller's refresh: how often it looks for the
 * new token, and how long before it gives up.
 */
export type RefreshWait = { pollMs: number; limitMs: number };

/**
 * Look twice a second. By the limit the holder has saved, failed and let go,
 * or run out its claim, so one more try then always lands.
 */
const REFRESH_WAIT: RefreshWait = { pollMs: 500, limitMs: REFRESH_CLAIM_MS + 500 };

/**
 * Pause between looks at the saved login while another caller refreshes it.
 * @param ms - How long to wait.
 */
function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** This caller's claim on a login row, to lift once the refresh is over. */
type HeldClaim = { tokenId: string; until: Date };

type RefreshTurn
  = | { kind: 'ours'; claim: HeldClaim | null; stored: StoredGrant | null }
    | { kind: 'refreshedByAnother'; grant: LoginGrant };

/**
 * Take the turn to refresh a login, or wait out the caller who has it. A
 * sync and an agent tool can find the same login expired at the same moment;
 * only the one whose claim lands calls the vendor. The other re-reads the
 * saved login until the new token is there and uses it, so a refresh token
 * is never spent twice. A claim runs out after `REFRESH_CLAIM_MS`, so if its
 * holder crashed, the waiter takes the turn instead. A login revoked or
 * removed while waiting ends the wait at once with "log in again".
 *
 * A login saved on the install's `source_credential` (no `api_token` row,
 * from before #1080's move) has nowhere to hold a claim, and refreshes
 * unclaimed with the compare-and-swap save alone.
 * @param input - The login and how to wait.
 * @param input.vendor - The vendor's name, for messages.
 * @param input.orgId - The workspace.
 * @param input.sourceId - The source being synced.
 * @param input.connectorSlug - The source's connector.
 * @param input.stored - The saved login as first read.
 * @param input.wait - How often to look while waiting, and for how long.
 * @param input.now - Injected for tests: the time token expiry is judged at.
 */
async function takeRefreshTurn(input: { vendor: string; orgId: string; sourceId: number; connectorSlug: string; stored: StoredGrant | null; wait: RefreshWait; now?: number }): Promise<RefreshTurn> {
  const tokenId = input.stored?.apiTokenId;
  if (!tokenId) {
    return { kind: 'ours', claim: null, stored: input.stored };
  }
  const deadline = Date.now() + input.wait.limitMs;
  while (Date.now() < deadline) {
    const claim = await claimLoginRefresh({ orgId: input.orgId, tokenId, holdMs: REFRESH_CLAIM_MS });
    if (claim.kind === 'gone') {
      throw new Error(`The ${input.vendor} login was revoked or removed. Log in with ${input.vendor} again on the Connectors page.`);
    }
    if (claim.kind === 'claimed') {
      // Read again under the claim: the last holder may have saved since the
      // first read, and refreshing from that first read would spend a refresh
      // token the vendor already rotated away.
      const latest = await readStoredGrant(input.orgId, input.sourceId, input.connectorSlug);
      return { kind: 'ours', claim: { tokenId, until: claim.until }, stored: latest };
    }
    await pause(input.wait.pollMs);
    const latest = await readStoredGrant(input.orgId, input.sourceId, input.connectorSlug);
    if (latest && !grantIsExpiring(latest.grant.expiresAt, input.now)) {
      return { kind: 'refreshedByAnother', grant: latest.grant };
    }
  }
  throw new Error(`Another ${input.vendor} refresh of this login is still running. Try again in a minute.`);
}

/**
 * Lift this caller's refresh claim. A save already lifted it, so this only
 * matters after a refresh that saved nothing; failing here costs nothing but
 * the wait until the claim runs out, so it is logged and not thrown.
 * @param orgId - The workspace.
 * @param tokenId - The login's `api_token` row.
 * @param claimedUntil - The claim's end time.
 */
async function letGoOfRefresh(orgId: string, tokenId: string, claimedUntil: Date): Promise<void> {
  try {
    await releaseLoginRefresh({ orgId, tokenId, claimedUntil });
  } catch (error) {
    logger.warn('refreshLoginGrant could not lift its refresh claim; it runs out on its own', { orgId, tokenId, errorName: error instanceof Error ? error.name : 'unknown' });
  }
}

/**
 * Refresh a source's login grant and save it. Only one caller refreshes a
 * login at a time (`takeRefreshTurn`); a caller that finds the login being
 * refreshed waits and uses the new token. Refreshes from the stored refresh
 * token, and only when the stored grant is itself expiring. A save that
 * fails keeps this run going on the fresh token and warns that the next run
 * needs a new login.
 * @param input - The grant, the vendor and where to save.
 * @param input.vendor - The vendor's name, for messages: "HubSpot".
 * @param input.connectorSlug - The source's connector.
 * @param input.grant - The grant this run loaded.
 * @param input.persistence - The sync's org, source and warning channel.
 * @param input.refresh - The vendor's refresh.
 * @param input.now - Injected for tests: the time token expiry is judged at.
 * @param input.wait - Injected for tests: how a caller waits out another's refresh.
 */
export async function refreshLoginGrant(input: {
  vendor: string;
  connectorSlug: string;
  grant: LoginGrant;
  persistence: Extract<GrantPersistence, { kind: 'persist' }>;
  refresh: GrantRefresher;
  now?: number;
  wait?: RefreshWait;
}): Promise<LoginGrant> {
  const { orgId, sourceId } = input.persistence;
  const firstRead = await readStoredGrant(orgId, sourceId, input.connectorSlug);
  // Another caller refreshed while this one was loading: use its grant.
  if (firstRead && !grantIsExpiring(firstRead.grant.expiresAt, input.now)) {
    return firstRead.grant;
  }
  const turn = await takeRefreshTurn({ vendor: input.vendor, orgId, sourceId, connectorSlug: input.connectorSlug, stored: firstRead, wait: input.wait ?? REFRESH_WAIT, now: input.now });
  if (turn.kind === 'refreshedByAnother') {
    return turn.grant;
  }
  try {
    if (turn.claim && !turn.stored) {
      // The login row is live (the claim landed) but the source no longer
      // reads a grant from it: its credential was replaced or is unreadable.
      throw new Error(`The saved ${input.vendor} login could not be read. Try again in a minute.`);
    }
    if (turn.stored && !grantIsExpiring(turn.stored.grant.expiresAt, input.now)) {
      return turn.stored.grant;
    }
    return await refreshAndSave({ ...input, stored: turn.stored });
  } finally {
    if (turn.claim) {
      await letGoOfRefresh(orgId, turn.claim.tokenId, turn.claim.until);
    }
  }
}

/**
 * Call the vendor's refresh and save the result, once this caller holds the
 * turn. The fallbacks here cover the logins that refresh unclaimed (saved on
 * `source_credential`) and a claim that ran out mid-refresh: a refused
 * refresh first looks for a grant another caller saved, and a save that
 * loses uses the winner's grant.
 * @param input - As `refreshLoginGrant`, with the saved login read under the turn.
 * @param input.vendor - The vendor's name, for messages.
 * @param input.connectorSlug - The source's connector.
 * @param input.grant - The grant this run loaded.
 * @param input.persistence - The sync's org, source and warning channel.
 * @param input.refresh - The vendor's refresh.
 * @param input.stored - The saved login, read under the turn.
 * @param input.now - Injected for tests.
 */
async function refreshAndSave(input: {
  vendor: string;
  connectorSlug: string;
  grant: LoginGrant;
  persistence: Extract<GrantPersistence, { kind: 'persist' }>;
  refresh: GrantRefresher;
  stored: StoredGrant | null;
  now?: number;
}): Promise<LoginGrant> {
  const { orgId, sourceId, warn } = input.persistence;
  const base = input.stored?.grant ?? input.grant;
  const parentRefreshToken = base.refreshToken;
  let fresh: RefreshedTokens;
  try {
    fresh = await input.refresh(parentRefreshToken);
  } catch (error) {
    const winner = await grantSavedByAnotherRun({ orgId, sourceId, connectorSlug: input.connectorSlug, parentRefreshToken, now: input.now });
    if (winner) {
      return winner;
    }
    throw refreshFailure(input.vendor, input.connectorSlug, orgId, error);
  }
  const next: LoginGrant = {
    ...base,
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
    expiresAt: fresh.expiresAt,
    ...(fresh.scope ? { scope: fresh.scope } : {}),
  };
  let saved = false;
  try {
    saved = await saveRefreshedGrant({ orgId, connectorSlug: input.connectorSlug, apiTokenId: input.stored?.apiTokenId ?? null, grant: next, parentRefreshToken });
    if (!saved) {
      // Another run saved first. Its grant is the one on file, whether or not
      // the vendor rotated the refresh token, so this run uses it too.
      const winner = await readStoredGrant(orgId, sourceId, input.connectorSlug);
      if (winner && !grantIsExpiring(winner.grant.expiresAt, input.now)) {
        return winner.grant;
      }
    }
  } catch (error) {
    // The run holds a working token; a vault or database failure must not end it.
    logger.warn('refreshLoginGrant could not save the refreshed login', { orgId, sourceId, connectorSlug: input.connectorSlug, errorName: error instanceof Error ? error.name : 'unknown' });
  }
  if (!saved) {
    warn(`${input.vendor} issued a new token but the saved login could not be updated. Log in with ${input.vendor} again before the next sync.`);
  }
  return next;
}

/**
 * The grant another run saved while this one's refresh failed, or null. A
 * vendor that rotates refresh tokens refuses the old one once a parallel
 * sync has used it; that sync's saved grant is good, so this run uses it
 * instead of telling the person to log in again.
 * @param input - Where the grant is stored, and the refresh token this run tried.
 * @param input.orgId - The workspace.
 * @param input.sourceId - The source being synced.
 * @param input.connectorSlug - The source's connector.
 * @param input.parentRefreshToken - The refresh token this run sent.
 * @param input.now - Injected for tests.
 */
async function grantSavedByAnotherRun(input: { orgId: string; sourceId: number; connectorSlug: string; parentRefreshToken: string; now?: number }): Promise<LoginGrant | null> {
  try {
    const stored = await readStoredGrant(input.orgId, input.sourceId, input.connectorSlug);
    const rotatedByAnotherRun = stored && stored.grant.refreshToken !== input.parentRefreshToken && !grantIsExpiring(stored.grant.expiresAt, input.now);
    return rotatedByAnotherRun ? stored.grant : null;
  } catch (error) {
    logger.warn('refreshLoginGrant could not re-read the login after a refused refresh', { orgId: input.orgId, sourceId: input.sourceId, connectorSlug: input.connectorSlug, errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/**
 * The error a failed refresh ends the run with, naming the one thing that
 * fixes it. A refused login says to log in again. A refused OAuth client says
 * an admin has to fix the server's client, since a new login would be refused
 * the same way. A vendor that did not answer (a timeout, a 5xx) says to try
 * again later, so nobody re-authorizes a good login over an outage. Worded for
 * a sync and a chat tool alike, since both refresh through here.
 * @param vendor - The vendor's name, for the sentence.
 * @param connectorSlug - The source's connector, for the log line.
 * @param orgId - The workspace, for the log line.
 * @param error - What the refresh threw.
 */
function refreshFailure(vendor: string, connectorSlug: string, orgId: string, error: unknown): Error {
  const code = error instanceof TokenRequestError ? error.code : 'unknown';
  const fix = error instanceof TokenRequestError ? refusalFix(error) : 'try-later';
  logger.warn('refreshLoginGrant: the vendor refused or did not answer the refresh', { orgId, connectorSlug, code, fix, errorName: error instanceof Error ? error.name : 'unknown' });
  if (fix === 'log-in-again') {
    return new Error(`${vendor} would not refresh the login (${code}). Log in with ${vendor} again on the Connectors page.`);
  }
  if (fix === 'check-server-client') {
    return new Error(`${vendor} refused this server's OAuth client (${code}), so logging in again will not help. An admin needs to check the ${vendor} client ID and secret set on the server.`);
  }
  return new Error(`${vendor} could not refresh the login just now (${code}). The saved login is unchanged; try again in a few minutes.`);
}

/**
 * The grant to call the vendor with: as loaded while its access token is
 * good, refreshed and saved once it is expiring. Test connection
 * (`persistence.kind === 'never'`) gets a sentence instead of a refresh.
 * @param input - The grant, the vendor and where a refresh would be saved.
 * @param input.vendor - The vendor's name, for messages.
 * @param input.connectorSlug - The source's connector.
 * @param input.grant - The grant this run loaded.
 * @param input.persistence - Save (a sync) or never refresh (Test connection).
 * @param input.refresh - The vendor's refresh.
 * @param input.now - Injected for tests.
 * @param input.wait - Injected for tests: how a caller waits out another's refresh.
 */
export async function usableLoginGrant(input: {
  vendor: string;
  connectorSlug: string;
  grant: LoginGrant;
  persistence: GrantPersistence;
  refresh: GrantRefresher;
  now?: number;
  wait?: RefreshWait;
}): Promise<LoginGrant> {
  if (!grantIsExpiring(input.grant.expiresAt, input.now)) {
    return input.grant;
  }
  if (input.persistence.kind === 'never') {
    throw new Error(`The ${input.vendor} access token has expired, and Test connection does not refresh it because it cannot save the new one. Run Sync now, which refreshes and saves it, then test again.`);
  }
  return refreshLoginGrant({ vendor: input.vendor, connectorSlug: input.connectorSlug, grant: input.grant, persistence: input.persistence, refresh: input.refresh, now: input.now, wait: input.wait });
}
