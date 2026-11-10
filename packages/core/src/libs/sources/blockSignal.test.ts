/**
 * Only a site refusing a bot earns a second, paid read through Firecrawl. A
 * removed page, a broken server and a page that answered are never a block.
 */
import type { FetchFailureDetail } from './fetchFailure';
import { describe, expect, it } from 'vitest';
import { blockSignalOf, isChallengeTitle } from './blockSignal';

/**
 * A failure detail with only what the case needs.
 * @param status - the HTTP status.
 * @param extra - headers and title.
 */
function failure(status: number, extra: Partial<FetchFailureDetail> = {}): FetchFailureDetail {
  return { status, headers: {}, ...extra };
}

describe('blockSignalOf', () => {
  it('403 is a block', () => {
    expect(blockSignalOf(failure(403))).toBe('HTTP 403');
  });

  it('429 is a block', () => {
    expect(blockSignalOf(failure(429))).toBe('HTTP 429');
  });

  it('503 with cf-mitigated is a block', () => {
    expect(blockSignalOf(failure(503, { headers: { 'cf-mitigated': 'challenge' } }))).toBe('cf-mitigated: challenge');
  });

  it('an AWS WAF challenge or captcha is a block, a WAF answer that is neither is not', () => {
    expect(blockSignalOf(failure(405, { headers: { 'x-amzn-waf-action': 'captcha' } }))).toBe('x-amzn-waf-action: captcha');
    expect(blockSignalOf(failure(202, { headers: { 'x-amzn-waf-action': 'Challenge' } }))).toBe('x-amzn-waf-action: Challenge');
    expect(blockSignalOf(failure(500, { headers: { 'x-amzn-waf-action': 'allow' } }))).toBeNull();
  });

  it('503 with a browser-check title is a block', () => {
    expect(blockSignalOf(failure(503, { title: 'Just a moment...' }))).toBe('HTTP 503 · title: Just a moment...');
  });

  it('503 with an ordinary title is not a block', () => {
    expect(blockSignalOf(failure(503, { title: 'Bellwater Hall is down for maintenance' }))).toBeNull();
  });

  it('a browser-check title on a status other than 503 is not a block on its own', () => {
    expect(blockSignalOf(failure(500, { title: 'Just a moment...' }))).toBeNull();
  });

  it('404 is never a block', () => {
    expect(blockSignalOf(failure(404, { headers: { server: 'edge-proxy' }, title: 'Not found' }))).toBeNull();
  });

  it('a bare 500 is never a block', () => {
    expect(blockSignalOf(failure(500))).toBeNull();
  });

  it('200 is never a block', () => {
    expect(blockSignalOf(failure(200))).toBeNull();
  });
});

describe('isChallengeTitle', () => {
  it('reads the browser-check interstitials as challenges', () => {
    expect(isChallengeTitle('Just a moment...')).toBe(true);
    expect(isChallengeTitle('  Attention Required! | Bellwater Hall  ')).toBe(true);
    expect(isChallengeTitle('Verifying you are human')).toBe(true);
  });

  it('does not read an ordinary or missing title as a challenge', () => {
    expect(isChallengeTitle('Bellwater Hall: a moment of music')).toBe(false);
    expect(isChallengeTitle(undefined)).toBe(false);
    expect(isChallengeTitle('')).toBe(false);
  });
});
