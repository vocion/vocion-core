/**
 * A workspace's own vendor login apps (#1080): saving, listing and revoking
 * them, for the public API (`/api/v1/login-apps`), the Developers page's save,
 * and anything that sets a workspace up by script.
 *
 * A login app is an ordinary `<vendor>-login-app` credential in `api_token`,
 * so this is a thin layer over `ApiTokenService`: saving goes through
 * `storePlatformKey` (validated, trimmed, encrypted, and replacing the live
 * one in one transaction), and listing reads only the masked hints, never the
 * vault. Every save and revoke writes an audit line naming who did it. Nothing
 * here returns or logs a secret.
 */
import type { CredentialPlatform } from '@/libs/platforms/registry';
import { callbackUri } from '@/libs/connect/routes';
import { VaultDecryptionError } from '@/libs/crypto/credentialVault';
import { isUniqueViolation } from '@/libs/dbErrors';
import { logger } from '@/libs/Logger';
import { loginAppPlatforms } from '@/libs/platforms/registry';
import { listTokens, resolvePlatformCredential, revokeLivePlatformCredentials, storePlatformKey } from '@/services/ApiTokenService';

/**
 * How many times a save is tried when another save of the same vendor's app
 * lands at the same moment. The second try sees the other save's row and
 * replaces it, so the last save wins, as one PUT after another would.
 */
const SAVE_ATTEMPTS = 2;

/** One vendor's login app slot, as the API lists it. No secret, ever. */
export type LoginAppSummary = {
  /** The connect provider, as used in `/api/v1/login-apps/:provider`. */
  provider: string;
  /** The vendor's name, e.g. `Google`. */
  vendor: string;
  /** Whether the workspace has one saved. */
  saved: boolean;
  /** The saved app's name, its masked client ID and when it was saved; null when none is. */
  name: string | null;
  keyHint: string | null;
  savedAt: string | null;
  /** The callback to register at the vendor; null when the server has no public address. */
  redirectUrl: string | null;
};

/** What saving a login app did. No secret, ever. */
export type SavedLoginApp = {
  /** The new credential row's id. */
  id: string;
  provider: string;
  vendor: string;
  name: string;
  /** The saved client ID, masked. */
  keyHint: string;
  /** The callback to register at the vendor; null when the server has no public address. */
  redirectUrl: string | null;
  /** Whether a login app was saved for this vendor before, and this one took its place. */
  replaced: boolean;
  /**
   * Whether logins made with the app before now stop working until an admin
   * logs in again: true only when the client ID changed. A new secret for the
   * same app (a rotation) leaves them working.
   */
  loginsNeedLoggingInAgain: boolean;
  /** A sentence for the person, when there is something they need to do. */
  note: string | null;
};

/** Another save of the same vendor's app kept landing at the same moment. */
export class LoginAppSaveConflictError extends Error {
  constructor(vendor: string) {
    super(`Another save of the ${vendor} login app happened at the same moment. Send this one again to make it the saved app.`);
    this.name = 'LoginAppSaveConflictError';
  }
}

/**
 * The login-app platform a `:provider` path segment names, or null when no
 * vendor by that name takes a workspace login app.
 * @param provider - The path segment, e.g. `google`.
 */
export function loginAppPlatformForProvider(provider: string): CredentialPlatform | null {
  return loginAppPlatforms().find(platform => platform.loginAppFor === provider) ?? null;
}

/**
 * The vendor's name for a login-app platform: its label without " login app".
 * @param platform - A login-app platform.
 */
function vendorOf(platform: CredentialPlatform): string {
  return platform.label.replace(/ login app$/, '');
}

/**
 * The callback to register at the vendor for a login-app platform.
 * @param platform - A login-app platform.
 * @param origin - The server's public origin; null when unknown.
 */
function redirectUrlFor(platform: CredentialPlatform, origin: string | null): string | null {
  return origin ? callbackUri(origin, platform.loginAppFor!) : null;
}

/**
 * Every vendor a workspace can bring its own login app for, with whether it
 * has one saved. Reads only the masked hints, never the secret.
 * @param orgId - The workspace.
 * @param origin - The server's public origin, for the redirect URL; null when unknown.
 */
export async function listLoginApps(orgId: string, origin: string | null): Promise<LoginAppSummary[]> {
  // One read of the workspace's live credentials (a handful of rows), newest
  // first; each login-app platform holds one live row at most.
  const live = await listTokens(orgId);
  return loginAppPlatforms().map(platform => loginAppSummary(platform, live.find(row => row.platform === platform.id), origin));
}

/**
 * One vendor's slot in the list.
 * @param platform - The vendor's login-app platform.
 * @param saved - Its live row, if the workspace has one.
 * @param saved.name - The row's name.
 * @param saved.keyHint - The masked client ID.
 * @param saved.createdAt - When it was saved.
 * @param origin - The server's public origin; null when unknown.
 */
function loginAppSummary(platform: CredentialPlatform, saved: { name: string; keyHint: string | null; createdAt: Date } | undefined, origin: string | null): LoginAppSummary {
  return {
    provider: platform.loginAppFor!,
    vendor: vendorOf(platform),
    saved: Boolean(saved),
    name: saved?.name ?? null,
    keyHint: saved?.keyHint ?? null,
    savedAt: saved ? saved.createdAt.toISOString() : null,
    redirectUrl: redirectUrlFor(platform, origin),
  };
}

/**
 * The client ID of the app saved before this save, so the answer can say
 * whether logins made with it keep working. `none` when there was no app, and
 * `unreadable` when its stored values no longer decrypt: logins made with it
 * fail already, so the caller treats it as a changed app.
 * @param orgId - The workspace.
 * @param platform - The vendor's login-app platform.
 */
async function previousClientIdOf(orgId: string, platform: CredentialPlatform): Promise<{ kind: 'none' } | { kind: 'unreadable' } | { kind: 'saved'; clientId: string }> {
  try {
    const previous = await resolvePlatformCredential(orgId, platform.id);
    if (!previous) {
      return { kind: 'none' };
    }
    return { kind: 'saved', clientId: typeof previous.clientId === 'string' ? previous.clientId : '' };
  } catch (error) {
    if (!(error instanceof VaultDecryptionError)) {
      throw error;
    }
    logger.warn('[login-apps] the login app being replaced could not be read', { orgId, platform: platform.id });
    return { kind: 'unreadable' };
  }
}

/**
 * Save the workspace's login app for one vendor, replacing the one saved
 * before, if any. Replacing it with a different client ID ends the logins
 * made with the old app at their next refresh (`loginsNeedLoggingInAgain`);
 * a new secret for the same client ID leaves them working.
 *
 * Throws `CredentialValidationError` for a blank client ID or secret, and
 * `LoginAppSaveConflictError` when another save of the same app keeps landing
 * at the same moment.
 * @param input - What to save.
 * @param input.orgId - The workspace.
 * @param input.platform - The vendor's login-app platform (`loginAppPlatformForProvider`).
 * @param input.name - What to call it on the Developers page; null for the platform's label.
 * @param input.clientId - The app's client ID.
 * @param input.clientSecret - The app's client secret.
 * @param input.savedBy - Who saved it: a user id, or `token:<id>` for an API token.
 * @param input.origin - The server's public origin, for the redirect URL; null when unknown.
 */
export async function saveLoginApp(input: { orgId: string; platform: CredentialPlatform; name: string | null; clientId: string; clientSecret: string; savedBy: string; origin: string | null }): Promise<SavedLoginApp> {
  const vendor = vendorOf(input.platform);
  const name = input.name ?? input.platform.label;
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
    // Read before each try: a retry follows another save, so the app being
    // replaced is that one, not the one read the first time.
    const previous = await previousClientIdOf(input.orgId, input.platform);
    let stored;
    try {
      stored = await storePlatformKey({
        orgId: input.orgId,
        name,
        platform: input.platform.id,
        values: { clientId: input.clientId, clientSecret: input.clientSecret },
        createdBy: input.savedBy,
        expiresAt: null,
      });
    } catch (error) {
      // Two saves at once: both revoked the old row, then the second insert
      // hit the one-live-app index. Trying again replaces the first save.
      if (isUniqueViolation(error) && attempt < SAVE_ATTEMPTS) {
        logger.warn('[login-apps] another save landed at the same moment; trying again', { orgId: input.orgId, platform: input.platform.id });
        continue;
      }
      if (isUniqueViolation(error)) {
        throw new LoginAppSaveConflictError(vendor);
      }
      throw error;
    }
    const replaced = previous.kind !== 'none';
    // Compared with the trimmed value, as `storePlatformKey` stores it.
    const loginsNeedLoggingInAgain = previous.kind === 'unreadable' || (previous.kind === 'saved' && previous.clientId !== input.clientId.trim());
    logger.info('[login-apps] login app saved', { orgId: input.orgId, provider: input.platform.loginAppFor, credentialId: stored.id, savedBy: input.savedBy, replaced, loginsNeedLoggingInAgain });
    return {
      id: stored.id,
      provider: input.platform.loginAppFor!,
      vendor,
      name,
      keyHint: stored.keyHint,
      redirectUrl: redirectUrlFor(input.platform, input.origin),
      replaced,
      loginsNeedLoggingInAgain,
      note: loginsNeedLoggingInAgain
        ? `Logins made with the previous ${vendor} login app need an admin to log in with ${vendor} again.`
        : null,
    };
  }
  // The loop returns or throws on its last try; this line is never reached.
  throw new LoginAppSaveConflictError(vendor);
}

/**
 * Revoke the workspace's login app for one vendor. New logins go back to the
 * server's app, if it has one, and logins made with this app need logging in
 * again. Answers false when none was saved, so a script can run it twice.
 * @param input - What to revoke.
 * @param input.orgId - The workspace.
 * @param input.platform - The vendor's login-app platform.
 * @param input.revokedBy - Who revoked it: a user id, or `token:<id>` for an API token.
 */
export async function revokeLoginApp(input: { orgId: string; platform: CredentialPlatform; revokedBy: string }): Promise<boolean> {
  const revokedIds = await revokeLivePlatformCredentials(input.orgId, input.platform.id);
  if (revokedIds.length > 0) {
    logger.info('[login-apps] login app revoked', { orgId: input.orgId, provider: input.platform.loginAppFor, credentialIds: revokedIds, revokedBy: input.revokedBy });
  }
  return revokedIds.length > 0;
}
