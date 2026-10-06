/**
 * A workspace's own vendor login apps (#1080), for callers other than the
 * Developers page: the public API (`/api/v1/login-apps`) and anything that
 * sets a workspace up by script.
 *
 * A login app is an ordinary `<vendor>-login-app` credential in `api_token`,
 * so this is a thin layer over `ApiTokenService`: saving goes through
 * `storePlatformKey` (validated, trimmed, encrypted, and replacing the live
 * one in one transaction, as the Developers form does), and listing reads only
 * the masked hints, never the vault. Nothing here returns or logs a secret.
 */
import type { CredentialPlatform } from '@/libs/platforms/registry';
import { callbackUri } from '@/libs/connect/routes';
import { loginAppPlatforms } from '@/libs/platforms/registry';
import { listPlatformCredentials, listTokens, revokeToken, storePlatformKey } from '@/services/ApiTokenService';

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
  const provider = platform.loginAppFor!;
  return {
    provider,
    vendor: vendorOf(platform),
    saved: Boolean(saved),
    name: saved?.name ?? null,
    keyHint: saved?.keyHint ?? null,
    savedAt: saved ? saved.createdAt.toISOString() : null,
    redirectUrl: origin ? callbackUri(origin, provider) : null,
  };
}

/**
 * Save the workspace's login app for one vendor, replacing the one saved
 * before, if any. Replacing ends the logins made with the old app at their
 * next refresh, which `replaced` tells the caller so it can say so.
 * Throws `CredentialValidationError` for a blank client ID or secret.
 * @param input - What to save.
 * @param input.orgId - The workspace.
 * @param input.platform - The vendor's login-app platform (`loginAppPlatformForProvider`).
 * @param input.name - What to call it on the Developers page.
 * @param input.clientId - The app's client ID.
 * @param input.clientSecret - The app's client secret.
 * @param input.createdBy - Who saved it: a user id, or `token:<id>` for an API token.
 */
export async function saveLoginApp(input: { orgId: string; platform: CredentialPlatform; name: string; clientId: string; clientSecret: string; createdBy: string }): Promise<{ id: string; keyHint: string; replaced: boolean }> {
  const before = await listPlatformCredentials(input.orgId, input.platform.id);
  const stored = await storePlatformKey({
    orgId: input.orgId,
    name: input.name,
    platform: input.platform.id,
    values: { clientId: input.clientId, clientSecret: input.clientSecret },
    createdBy: input.createdBy,
    expiresAt: null,
  });
  return { id: stored.id, keyHint: stored.keyHint, replaced: before.length > 0 };
}

/**
 * Revoke the workspace's login app for one vendor. New logins go back to the
 * server's app, if it has one, and logins made with this app need logging in
 * again. Answers false when none was saved, so a script can run it twice.
 * @param orgId - The workspace.
 * @param platform - The vendor's login-app platform.
 */
export async function revokeLoginApp(orgId: string, platform: CredentialPlatform): Promise<boolean> {
  const live = await listPlatformCredentials(orgId, platform.id);
  for (const row of live) {
    await revokeToken(orgId, row.id);
  }
  return live.length > 0;
}
