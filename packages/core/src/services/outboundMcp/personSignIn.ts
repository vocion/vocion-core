/**
 * Per-person sign-in to a remote MCP source (`auth: person`, docs/guides/mcp-sources.md).
 *
 * A server that answers each person by their own identity (its own document
 * ACLs, roles and MFA) cannot be read with one workspace token: everyone would
 * read as whoever pasted it. So each person signs in once, the grant is a login
 * row in THEIR Personal (one per person per install), sealed under its key and
 * keyed by the endpoint, and a turn in any workspace that assigns the source
 * reads it only for the person in that turn. One sign-in serves every
 * workspace that declares the same endpoint. A turn with no person (an
 * automation, a mission's background step) has no grant to use and says so.
 *
 * The grant is never shown, never a source credential and never used for
 * anyone else. Leaving the Org deletes it with the rest of the person's
 * Personal credentials (`forgetPersonalConnections`).
 */

import type { McpCredentials } from '@/libs/outboundMcp/client';
import type { McpGrant } from '@/libs/outboundMcp/oauth';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { grantIsExpiring } from '@/libs/connect/loginGrant';
import { connectOrigin } from '@/libs/connect/routes';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { mcpCredentialsOf } from '@/libs/outboundMcp/client';
import { asMcpGrant, mcpEndpoint, refreshMcpGrant } from '@/libs/outboundMcp/oauth';
import { apiTokenSchema } from '@/models/Schema';
import { claimLoginRefresh, releaseLoginRefresh, resolveCredentialById, storeLoginCredential, updateLoginCredentialValues } from '@/services/ApiTokenService';
import { findPersonalProject } from '@/services/workspace/personalProject';

/** The platform the grant is stored under: an endpoint and a bearer token, as `mcpCredentialsOf` reads. */
const GRANT_PLATFORM = 'rest';

const REFRESH_CLAIM_MS = 30_000;

/** A person's credentials for an MCP endpoint, or the sentence that says why there are none. */
export type PersonMcpCredentials = { ok: true; credentials: McpCredentials } | { ok: false; why: string };

/** A source that signs each person in, as the start route and the tools name it. */
export type PersonMcpSource = { orgId: string; slug: string; name: string; url: string };

/**
 * Where the person signs in, as a link a chat answer can carry.
 * @param source - The source.
 */
export function signInLink(source: Pick<PersonMcpSource, 'orgId' | 'slug'>): string {
  const path = `/api/connect/mcp/start?${new URLSearchParams({ workspace: source.orgId, source: source.slug })}`;
  const origin = connectOrigin();
  return origin ? `${origin}${path}` : path;
}

/**
 * The sentence for a person who has not signed in yet.
 * @param source - The source.
 */
function signInNeeded(source: PersonMcpSource): string {
  return `${source.name} answers each person as themselves, and you have not signed in to it yet. Give the person this link to sign in once: [Sign in to ${source.name}](${signInLink(source)}). Then retry. No tool was called.`;
}

/**
 * Store a person's fresh grant in their Personal. Signing in again to the
 * same endpoint replaces the grant in place.
 * @param input - The person, the source and the grant.
 * @param input.userId - The person.
 * @param input.sourceName - What the row is called.
 * @param input.grant - From the code exchange.
 */
export async function storePersonGrant(input: { userId: string; sourceName: string; grant: McpGrant }): Promise<void> {
  const personal = await findPersonalProject(input.userId);
  if (!personal) {
    throw new Error('You have no Personal workspace to keep the sign-in in. Sign out and in again to create it.');
  }
  await storeLoginCredential({
    orgId: personal.id,
    platform: GRANT_PLATFORM,
    name: `${input.sourceName} (your sign-in)`,
    account: input.grant.baseUrl,
    values: input.grant,
    createdBy: input.userId,
  });
}

type StoredGrant = { personalId: string; tokenId: string; grant: McpGrant };

/**
 * The person's live grant for an endpoint, newest first.
 * @param userId - The person.
 * @param baseUrl - The MCP endpoint.
 */
async function readGrant(userId: string, baseUrl: string): Promise<StoredGrant | null> {
  const personal = await findPersonalProject(userId);
  if (!personal) {
    return null;
  }
  const rows = await db
    .select({ id: apiTokenSchema.id })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, personal.id),
      eq(apiTokenSchema.platform, GRANT_PLATFORM),
      eq(apiTokenSchema.account, baseUrl),
      eq(apiTokenSchema.obtainedVia, 'login'),
      isNull(apiTokenSchema.revokedAt),
    ))
    .orderBy(desc(apiTokenSchema.createdAt));
  for (const row of rows) {
    const resolved = await resolveCredentialById(personal.id, row.id);
    const grant = resolved.status === 'ok' ? asMcpGrant(resolved.values as Record<string, unknown>) : null;
    if (grant && grant.baseUrl === baseUrl) {
      return { personalId: personal.id, tokenId: row.id, grant };
    }
  }
  return null;
}

/**
 * Refresh a grant once across concurrent callers: the claim holder spends the
 * refresh token, everyone else waits for what it saved.
 * @param stored - The grant as read.
 * @param userId - The person.
 */
async function refreshed(stored: StoredGrant, userId: string): Promise<McpGrant | null> {
  const deadline = Date.now() + REFRESH_CLAIM_MS + 500;
  while (Date.now() < deadline) {
    const claim = await claimLoginRefresh({ orgId: stored.personalId, tokenId: stored.tokenId, holdMs: REFRESH_CLAIM_MS });
    if (claim.kind === 'gone') {
      return null;
    }
    if (claim.kind === 'held') {
      await new Promise(resolve => setTimeout(resolve, 500));
      const latest = await readGrant(userId, stored.grant.baseUrl);
      if (latest && !grantIsExpiring(latest.grant.expiresAt)) {
        return latest.grant;
      }
      continue;
    }
    try {
      // Read again under the claim: the last holder may have rotated the refresh token.
      const latest = (await readGrant(userId, stored.grant.baseUrl)) ?? stored;
      if (!grantIsExpiring(latest.grant.expiresAt)) {
        await releaseLoginRefresh({ orgId: stored.personalId, tokenId: stored.tokenId, claimedUntil: claim.until });
        return latest.grant;
      }
      const next = await refreshMcpGrant(latest.grant);
      const saved = await updateLoginCredentialValues({ orgId: stored.personalId, tokenId: stored.tokenId, values: next, expectedRefreshToken: latest.grant.refreshToken });
      return saved ? next : (await readGrant(userId, stored.grant.baseUrl))?.grant ?? null;
    } catch (error) {
      await releaseLoginRefresh({ orgId: stored.personalId, tokenId: stored.tokenId, claimedUntil: claim.until }).catch(() => undefined);
      logger.warn('An MCP sign-in could not be refreshed', { baseUrl: stored.grant.baseUrl, errorName: error instanceof Error ? error.name : 'unknown' });
      return null;
    }
  }
  return null;
}

/**
 * THE way a per-person MCP source is read: the grant of the person in the
 * turn, refreshed when it is about to run out, or why there is none. Never
 * falls back to anyone else's grant or a workspace token.
 * @param input - The source and the person in the turn.
 * @param input.source - The source.
 * @param input.userId - The person, absent in a turn nobody started.
 */
export async function personMcpCredentials(input: { source: PersonMcpSource; userId?: string | null }): Promise<PersonMcpCredentials> {
  const { source } = input;
  if (!input.userId) {
    return { ok: false, why: `${source.name} answers each person as themselves, and nobody is in this turn, so there is no sign-in to use. Say it is unavailable here; no tool was called.` };
  }
  const stored = await readGrant(input.userId, mcpEndpoint(source.url));
  if (!stored) {
    return { ok: false, why: signInNeeded(source) };
  }
  const grant = grantIsExpiring(stored.grant.expiresAt) ? await refreshed(stored, input.userId) : stored.grant;
  if (!grant) {
    return { ok: false, why: `Your sign-in to ${source.name} has run out. Give the person this link to sign in again: [Sign in to ${source.name}](${signInLink(source)}). No tool was called.` };
  }
  return { ok: true, credentials: mcpCredentialsOf(grant) };
}
