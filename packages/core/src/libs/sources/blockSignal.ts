/**
 * Whether a failed page fetch was the site refusing a bot, rather than the page
 * being gone or the server being down.
 *
 * Only a block is worth a second read through another reader (the web
 * connector's `fallbackReader`): a 404 is the same page whoever asks, and a
 * plain 500 is the site's problem. The answer is read from the detail
 * `describeHttpFailure` already keeps, so nothing new is read from the response.
 */

import type { FetchFailureDetail } from './fetchFailure';

/** The statuses a site answers a bot it refuses with. */
const BLOCK_STATUSES = new Set([403, 429]);

/** An AWS WAF action that asks for a person rather than refusing the request outright. */
const WAF_CHALLENGE_ACTIONS = new Set(['challenge', 'captcha']);

/**
 * The titles of the interstitial pages edge networks serve while they check a
 * browser, which some send with a 503 rather than a 403.
 */
const CHALLENGE_TITLE_RE = /^just a moment|^attention required|checking your browser|verifying you are human/i;

/**
 * Why this failure reads as a block, as one short line for the run's log, or
 * null when it does not.
 * @param detail - what the failed response said about itself.
 */
export function blockSignalOf(detail: FetchFailureDetail): string | null {
  if (BLOCK_STATUSES.has(detail.status)) {
    return `HTTP ${detail.status}`;
  }
  const mitigated = detail.headers['cf-mitigated'];
  if (mitigated) {
    return `cf-mitigated: ${mitigated}`;
  }
  const wafAction = detail.headers['x-amzn-waf-action'];
  if (wafAction && WAF_CHALLENGE_ACTIONS.has(wafAction.toLowerCase())) {
    return `x-amzn-waf-action: ${wafAction}`;
  }
  if (detail.status === 503 && detail.title && CHALLENGE_TITLE_RE.test(detail.title)) {
    return `HTTP 503 · title: ${detail.title}`;
  }
  return null;
}
