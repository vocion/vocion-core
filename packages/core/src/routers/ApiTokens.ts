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
 *     ours. Nothing reads these back out to a client; the only thing that ever
 *     leaves is the masked hint.
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
import { isCredentialPlatformId, listPlatforms } from '@/libs/platforms/registry';
import { issueToken, listTokens, revokeToken, storePlatformKey } from '@/services/ApiTokenService';
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
      // The plaintext in this response is the only time it exists outside the
      // caller's clipboard — only its SHA-256 is stored.
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
    platform: z.string().refine(isCredentialPlatformId, 'Unknown platform.'),
    /** Field values keyed by the platform's field names, e.g. `{ apiKey }`. */
    values: z.record(z.string(), z.string().min(1).max(8192)),
    /** ISO datetime, or null for a key with no expiry. */
    expiresAt: z.string().nullable(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardTokenAdmin();
    const expiresAt = readExpiry(input.expiresAt);
    try {
      const { id, keyHint } = await storePlatformKey({
        orgId,
        name: input.name,
        platform: input.platform as CredentialPlatformId,
        values: input.values,
        createdBy: userId,
        expiresAt,
      });
      return { id, name: input.name, platform: input.platform, keyHint, expiresAt };
    } catch (error) {
      // The validation errors from the registry are written for the person
      // pasting the key and name no secret, so they are safe to pass through.
      // Anything else is ours and gets a generic message.
      const message = error instanceof Error ? error.message : '';
      console.error('[apiTokens.createPlatformKey] could not store key', { platform: input.platform, message });
      throw ApiError.badRequest(message || 'Could not save the key.');
    }
  });
