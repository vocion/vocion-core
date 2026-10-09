/**
 * Whether a failed call means the person's own connection is broken — the
 * grant was revoked or expired, so only reconnecting fixes it — rather than a
 * passing failure worth trying again. Read from the error's TYPE and its
 * vendor code, never its words (docs/guides/push-to-you.md).
 */

import { GoogleRefreshRefused } from '@/libs/sources/googleAuth';
import { GithubCallError } from './github';
import { GoogleCallError } from './google';
import { SlackCallError } from './slack';

/** Slack's codes for a token that no longer works. */
const SLACK_DEAD = new Set(['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive', 'not_authed']);

/**
 * True when reconnecting is the fix.
 * @param error - What a personal call threw.
 */
export function isBrokenConnection(error: unknown): boolean {
  if (error instanceof GoogleRefreshRefused) {
    return error.fix !== 'try-later';
  }
  if (error instanceof GoogleCallError || error instanceof GithubCallError) {
    return error.status === 401;
  }
  if (error instanceof SlackCallError) {
    return SLACK_DEAD.has(error.code);
  }
  return false;
}
