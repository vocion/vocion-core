/**
 * The token a GitLab call goes out with, whichever kind the workspace holds.
 *
 *   - A pasted personal, project or group access token (`{ token }`) is used
 *     as stored: GitLab owns its lifetime.
 *   - A "Connect with GitLab" login (`{ accessToken, refreshToken, expiresAt,
 *     baseUrl }`) lives two hours, so it is refreshed BEFORE the call when it
 *     is expiring, and the rotated pair is saved to the source it came from
 *     (`usableLoginGrant`), so the next caller does not refresh again with a
 *     refresh token GitLab has already retired.
 *
 * Every GitLab caller reads through here: the source's sync and Test
 * connection, the repo family's provider, the webhook's hydration and the
 * runner's push credential. A login's instance wins over the source's
 * configured one, since a token is good only where it was issued.
 */

import type { GrantPersistence, LoginGrant } from '@/libs/connect/loginGrant';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { normalizeBaseUrl } from './client';

/** A token and the instance it is good on. */
export type GitlabAccess = { token: string; baseUrl: string };

/**
 * The token to call GitLab with, refreshed first when it is a login that is
 * expiring. Null when the bag holds neither kind.
 * @param credentials - The decrypted credential bag.
 * @param persistence - Where a refreshed login is saved, or `never` (a form's Test connection).
 * @param configBaseUrl - The source's configured instance.
 */
export async function resolveGitlabAccess(credentials: Record<string, unknown> | undefined, persistence: GrantPersistence, configBaseUrl?: string | null): Promise<GitlabAccess | null> {
  if (isLoginGrant(credentials)) {
    const grant = credentials as LoginGrant & { baseUrl?: unknown };
    const baseUrl = normalizeBaseUrl(typeof grant.baseUrl === 'string' ? grant.baseUrl : configBaseUrl);
    const { refreshGitlabGrant } = await import('@/libs/connect/providers/gitlab');
    const fresh = await usableLoginGrant({
      vendor: 'GitLab',
      provider: 'gitlab',
      connectorSlug: 'gitlab',
      grant,
      persistence,
      refresh: (refreshToken, client) => refreshGitlabGrant(refreshToken, client, baseUrl),
    });
    return { token: fresh.accessToken, baseUrl };
  }
  const pasted = credentials?.token;
  return typeof pasted === 'string' && pasted.trim() ? { token: pasted.trim(), baseUrl: normalizeBaseUrl(configBaseUrl) } : null;
}
