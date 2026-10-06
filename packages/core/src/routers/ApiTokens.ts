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
 * 1. **Admins only.** A token acts with the `admin` workspace role, so issuing
 *    one is a privilege escalation for anybody who isn't already an admin.
 * 2. **Session only, never a token.** These procedures run behind the dashboard
 *    session (oRPC has no bearer path), so a leaked token cannot mint a fresh
 *    one for itself and outlive the revoke that was meant to kill it.
 */

import type { CredentialPlatformId } from '@/libs/platforms/registry';
import { os } from '@orpc/server';
import { z } from 'zod';
import { callbackUri, connectOrigin } from '@/libs/connect/routes';
import { VaultDecryptionError } from '@/libs/crypto/credentialVault';
import { CredentialValidationError, DEFAULT_PLATFORM_ID, getPlatform, isCredentialPlatformId, listPlatforms } from '@/libs/platforms/registry';
import { issueToken, listTokens, revealPlatformCredential, revokeToken, storePlatformKey } from '@/services/ApiTokenService';
import { LoginAppSaveConflictError, saveLoginApp } from '@/services/connect/loginApps';
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

/**
 * Save a credential an admin pasted. A login app goes through `saveLoginApp`,
 * the same path `/api/v1/login-apps` takes, so a save from either place writes
 * the same audit line and recovers the same way from two saves at once. Every
 * other platform goes straight to `storePlatformKey`.
 * @param input - What to save.
 * @param input.orgId - The workspace.
 * @param input.userId - The admin saving it.
 * @param input.name - What to call it.
 * @param input.platform - Which platform it belongs to.
 * @param input.values - Field values keyed by the platform's field names.
 */
async function storeSuppliedCredential(input: { orgId: string; userId: string; name: string; platform: CredentialPlatformId; values: Record<string, string> }): Promise<{ id: string; keyHint: string }> {
  const platform = getPlatform(input.platform);
  if (platform.loginAppFor) {
    // A missing field arrives blank, and `storePlatformKey` refuses a blank
    // one with the sentence the form shows.
    return saveLoginApp({ orgId: input.orgId, platform, name: input.name, clientId: input.values.clientId ?? '', clientSecret: input.values.clientSecret ?? '', savedBy: input.userId, origin: null });
  }
  return storePlatformKey({
    orgId: input.orgId,
    name: input.name,
    platform: input.platform,
    values: input.values,
    createdBy: input.userId,
    // A supplied key never carries an expiry of ours. The platform that
    // issued it owns its lifetime — OpenAI decides when an `sk-` key stops
    // working — so a second expiry here could only ever be wrong: it would
    // stop us using a key that is still perfectly valid at the vendor, and
    // the person who set it has no way to see that is what happened.
    // Revoking or replacing is how a supplied key ends.
    expiresAt: null,
  });
}

export const listTokensRoute = os
  .input(z
    .object({
      /**
       * True to include revoked rows. The dashboard asks for this only when an
       * admin turns on "show revoked", because a rotation leaves the old row
       * behind on purpose and the default list should be what is in use.
       */
      includeRevoked: z.boolean().optional(),
    })
    // Optional as a whole so an older client calling with no argument still
    // gets the default list rather than a validation error.
    .optional())
  .handler(async ({ input }) => {
    const { orgId } = await guardTokenAdmin();
    return listTokens(orgId, { includeRevoked: input?.includeRevoked ?? false });
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
    const { orgId, userId } = await guardTokenAdmin();
    // Scoped by orgId inside the service, so one tenant cannot revoke
    // another's credential by guessing an id.
    await revokeToken(orgId, input.tokenId);
    // The audit line for who revoked what; `warn` for the same reason as the
    // reveal's line below: the lint rule lets only warn and error through.
    console.warn('[apiTokens.revoke] credential revoked', { orgId, userId, tokenId: input.tokenId });
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
  const origin = connectOrigin();
  return listPlatforms().map(platform => ({
    id: platform.id,
    label: platform.label,
    keySource: platform.keySource,
    // Whether saving a second credential here replaces the first or sits
    // alongside it. The form's warnings turn on this, and getting it wrong
    // means either a false alarm or a key replaced without saying so.
    credentialsPerOrg: platform.credentialsPerOrg,
    keyShapeHint: platform.keyShapeHint,
    helpText: platform.helpText,
    // A login app has to be registered at the vendor with this server's
    // callback, so the form shows the exact URL to copy. Null for every other
    // platform, and when the server has no NEXT_PUBLIC_APP_URL to build it from.
    redirectUrl: platform.loginAppFor && origin ? callbackUri(origin, platform.loginAppFor) : null,
    // A login app's replace and revoke break the logins made with it, which
    // the form has to say; a key's do not.
    loginApp: Boolean(platform.loginAppFor),
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
      const { id, keyHint } = await storeSuppliedCredential({ orgId, userId, name: input.name, platform: input.platform as CredentialPlatformId, values: input.values });
      return { id, name: input.name, platform: input.platform, keyHint };
    } catch (error) {
      // Only `CredentialValidationError` and `LoginAppSaveConflictError` are
      // safe to show. Every one of those messages is authored here, describes
      // something the person can fix, and names no secret. Anything else came
      // from the database or the vault and can carry a constraint detail, a
      // connection string or a KMS error in its message, so it is logged here
      // and replaced with a message that says nothing.
      const isSafeToShow = error instanceof CredentialValidationError || error instanceof LoginAppSaveConflictError;
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
      // A ciphertext that will not open. Most of the reasons for that carry
      // detail nobody outside the server should read — a KMS response, a
      // connection string — so they are logged here and replaced with a
      // sentence that says nothing.
      //
      // `VaultDecryptionError` is the exception, and the reason it exists: the
      // vault authored that message for exactly this moment, it names the cause
      // and the fix, and it holds no secret. Flattening it sent the last person
      // who hit this to the container logs to learn something the screen
      // already knew.
      const isSafeToShow = error instanceof VaultDecryptionError;
      console.error('[apiTokens.revealPlatformKey] could not decrypt key', {
        tokenId: input.tokenId,
        message: error instanceof Error ? error.message : String(error),
        // The vault keeps the underlying failure — Node's own wording for a
        // ciphertext that will not authenticate — out of the message it hands
        // the dashboard. The log is where that half belongs.
        cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
      });
      throw ApiError.badRequest(isSafeToShow ? error.message : 'Could not read that key.');
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
