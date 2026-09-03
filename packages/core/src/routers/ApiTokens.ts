/**
 * Dashboard routes for an org's API credentials.
 *
 * Two kinds share this router, told apart by platform:
 *
 *   - **Vocion tokens** (`vcn_live_…`) — what an outside caller (an admin
 *     panel, a script, an MCP client) presents to `/api/v1/*` and `/api/mcp`.
 *     Before this router they could only be minted from a shell
 *     (`src/scripts/manage-tokens.ts`), which meant server access was a
 *     prerequisite for integrating anything.
 *   - **Supplied platform keys** — the org's own OpenAI or Anthropic key,
 *     stored encrypted so their model spend bills their account instead of
 *     ours.
 *
 * Both kinds are stored encrypted and both are readable back the same way: the
 * list only ever carries the masked hint, and the full value leaves the server
 * on one route, `revealPlatformKey`, and only when an admin asks for it by row.
 *
 * Two rules shape every handler here:
 *
 * 1. **Admins only.** A token acts with the `owner` workspace role, so issuing
 *    one is a privilege escalation for anybody who isn't already an admin.
 * 2. **Session only, never a token.** These procedures run behind the dashboard
 *    session (oRPC has no bearer path), so a leaked token cannot mint a fresh
 *    one for itself and outlive the revoke that was meant to kill it.
 */

import type { CredentialPlatformId } from '@/libs/platforms/registry';
import { os } from '@orpc/server';
import { z } from 'zod';
import { CredentialValidationError, DEFAULT_PLATFORM_ID, isCredentialPlatformId, listPlatforms } from '@/libs/platforms/registry';
import { issueToken, listTokens, revealPlatformCredential, revokeToken, storePlatformKey } from '@/services/ApiTokenService';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/** Longest expiry the dashboard will issue: ten years, i.e. "effectively never". */
const MAX_EXPIRY_YEARS = 10;

/**
 * Admin session context for a token operation. Tokens are scoped to the org
 * (project), so `orgId` is what the service needs; `userId` is recorded as the
 * issuer so an audit can answer who created a credential.
 */
async function guardTokenAdmin() {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN })) {
    throw ApiError.forbidden();
  }
  return { orgId: ctx.orgId, userId: ctx.userId };
}

/**
 * Read the requested expiry into a Date, or null for a token that never
 * expires. Rejects a date already in the past — a token that is born expired
 * is never what the caller meant — and anything absurdly far out, which is
 * usually a unit mix-up (milliseconds pasted where a date belongs).
 * @param raw - ISO 8601 datetime string, or null for no expiry.
 */
function readExpiry(raw: string | null): Date | null {
  if (raw === null) {
    return null;
  }
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw ApiError.badRequest('Expiry is not a valid date.');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest('Expiry must be in the future.');
  }
  const latest = new Date();
  latest.setFullYear(latest.getFullYear() + MAX_EXPIRY_YEARS);
  if (expiresAt.getTime() > latest.getTime()) {
    throw ApiError.badRequest(`Expiry cannot be more than ${MAX_EXPIRY_YEARS} years out. Choose "never" instead.`);
  }
  return expiresAt;
}

export const listTokensRoute = os.handler(async () => {
  const { orgId } = await guardTokenAdmin();
  return listTokens(orgId);
});

export const createTokenRoute = os
  .input(z.object({
    name: z.string().trim().min(1, 'Give the token a name.').max(80),
    /** ISO datetime, or null for a token with no expiry. */
    expiresAt: z.string().nullable(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardTokenAdmin();
    const expiresAt = readExpiry(input.expiresAt);
    try {
      // The token is returned in full so the panel can show it immediately.
      // It is also kept, encrypted, so the row can show it again later.
      const { token, id } = await issueToken({
        orgId,
        name: input.name,
        createdBy: userId,
        expiresAt,
      });
      return { id, token, name: input.name, expiresAt };
    } catch (error) {
      console.error('[apiTokens.create] could not issue token', error);
      throw ApiError.badRequest('Could not create the token.');
    }
  });

export const revokeTokenRoute = os
  .input(z.object({ tokenId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardTokenAdmin();
    // Scoped by orgId inside the service, so one tenant cannot revoke
    // another's credential by guessing an id.
    await revokeToken(orgId, input.tokenId);
    return { ok: true };
  });

/**
 * The platform selector's options. Everything the form needs to render and
 * validate a choice, so the UI never carries its own copy of the platform list.
 *
 * Public to any signed-in member: it is a static description of what this build
 * supports, not org data.
 */
export const listPlatformsRoute = os.handler(async () => {
  await guardAuth();
  return listPlatforms().map(platform => ({
    id: platform.id,
    label: platform.label,
    keySource: platform.keySource,
    keyShapeHint: platform.keyShapeHint,
    helpText: platform.helpText,
    // RegExp does not survive the wire, so the form gets the human hint and
    // the server stays the only place the shape is actually enforced.
    fields: platform.fields.map(field => ({
      name: field.name,
      label: field.label,
      shapeHint: field.shapeHint,
      secret: field.secret,
    })),
  }));
});

/**
 * Store a key the org supplied for a third-party platform.
 *
 * Separate from `create` rather than a branch inside it because the two have
 * genuinely different inputs and different outputs: one returns a generated
 * secret exactly once, the other accepts a secret and returns only a masked
 * hint. Folding them together would mean a response type where the dangerous
 * field is sometimes present.
 */
export const createPlatformKeyRoute = os
  .input(z.object({
    name: z.string().trim().min(1, 'Give the credential a name.').max(80),
    // Refuses `vocion` here rather than letting it travel two layers down to
    // the service. A Vocion token is minted by `create`, never supplied, so
    // this route has nothing it could do with one.
    platform: z
      .string()
      .refine(isCredentialPlatformId, 'Unknown platform.')
      .refine(value => value !== DEFAULT_PLATFORM_ID, 'Vocion tokens are created, not supplied.'),
    /** Field values keyed by the platform's field names, e.g. `{ apiKey }`. */
    values: z.record(z.string(), z.string().min(1).max(8192)),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardTokenAdmin();
    try {
      const { id, keyHint } = await storePlatformKey({
        orgId,
        name: input.name,
        platform: input.platform as CredentialPlatformId,
        values: input.values,
        createdBy: userId,
        // A supplied key never carries an expiry of ours. The platform that
        // issued it owns its lifetime — OpenAI decides when an `sk-` key stops
        // working — so a second expiry here could only ever be wrong: it would
        // stop us using a key that is still perfectly valid at the vendor, and
        // the person who set it has no way to see that is what happened.
        // Revoking or replacing is how a supplied key ends.
        expiresAt: null,
      });
      return { id, name: input.name, platform: input.platform, keyHint };
    } catch (error) {
      // Only `CredentialValidationError` is safe to show. Every one of those
      // messages is authored in the platform registry, describes something the
      // person can fix, and names no secret. Anything else came from the
      // database or the vault and can carry a constraint detail, a connection
      // string or a KMS error in its message, so it is logged here and
      // replaced with a message that says nothing.
      const isSafeToShow = error instanceof CredentialValidationError;
      console.error('[apiTokens.createPlatformKey] could not store key', {
        platform: input.platform,
        message: error instanceof Error ? error.message : String(error),
      });
      throw ApiError.badRequest(isSafeToShow ? error.message : 'Could not save the key.');
    }
  });

/**
 * Decrypt one stored credential so the admin who owns it can read it back —
 * either a supplied platform key or a Vocion-issued token.
 *
 * The dashboard masks every credential by default and calls this only when
 * someone asks to see one, so the plaintext crosses the wire on a deliberate
 * click rather than on every page load. Admin-only and session-only like the
 * rest of this router, and the reveal is logged — without the value — so an
 * audit can answer who looked at which credential.
 *
 * The refusals come back as ordinary results rather than errors, because
 * neither means the caller did anything wrong: a Vocion token issued before
 * minted tokens were stored encrypted has no plaintext left to show, and a
 * missing row is usually a stale tab.
 */
export const revealPlatformKeyRoute = os
  .input(z.object({ tokenId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardTokenAdmin();
    let revealed;
    try {
      revealed = await revealPlatformCredential(orgId, input.tokenId);
    } catch (error) {
      // A ciphertext that will not open. The message can carry KMS detail, so
      // it is logged and replaced with one that says nothing.
      console.error('[apiTokens.revealPlatformKey] could not decrypt key', {
        tokenId: input.tokenId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw ApiError.badRequest('Could not read that key.');
    }
    if (revealed.status === 'ok') {
      // `warn` rather than `info` because the lint rule allows only warn and
      // error through, and an audit line that never ships is worse than one
      // logged a level louder than it deserves.
      console.warn('[apiTokens.revealPlatformKey] credential revealed', {
        orgId,
        userId,
        tokenId: input.tokenId,
      });
    }
    return revealed;
  });
