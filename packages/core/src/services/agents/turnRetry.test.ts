/**
 * Which failures are worth a second attempt (#114).
 *
 * The cost of getting this wrong runs both ways: retry a refused request and
 * the workspace pays twice for the same failure, skip a dropped socket and a
 * person re-asks a question that would have worked on its own. Each case
 * below is a failure this product has actually seen from a provider.
 */
import { describe, expect, it } from 'vitest';
import { isTransientRunFailure, statusOf } from './turnRetry';

/**
 * An error carrying an HTTP status, the way the OpenAI and Anthropic clients throw one.
 * @param status - The status the provider returned.
 * @param message - What the error says.
 */
function providerError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe('isTransientRunFailure', () => {
  it('retries a rate limit, because the same request lands once the window rolls', () => {
    expect(isTransientRunFailure(providerError(429, 'rate_limit_error'))).toBe(true);
  });

  it('retries a provider that is briefly overloaded or down', () => {
    expect(isTransientRunFailure(providerError(529, 'overloaded_error'))).toBe(true);
    expect(isTransientRunFailure(providerError(503, 'service unavailable'))).toBe(true);
    expect(isTransientRunFailure(providerError(500, 'internal server error'))).toBe(true);
  });

  it('refuses to retry a request the provider rejected on its merits', () => {
    expect(isTransientRunFailure(providerError(400, 'prompt is too long: 250000 tokens > 200000 maximum'))).toBe(false);
    expect(isTransientRunFailure(providerError(401, 'invalid x-api-key'))).toBe(false);
    expect(isTransientRunFailure(providerError(403, 'not authorised for this model'))).toBe(false);
    expect(isTransientRunFailure(providerError(404, 'model not found'))).toBe(false);
  });

  it('believes the status over the words, so a 400 that happens to say "timeout" is still refused', () => {
    expect(isTransientRunFailure(providerError(400, 'invalid request: timeout must be a number'))).toBe(false);
  });

  it('retries a socket that died, which is how a turn usually dies mid-answer', () => {
    expect(isTransientRunFailure(new Error('socket hang up'))).toBe(true);
    expect(isTransientRunFailure(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientRunFailure(new Error('terminated'))).toBe(true);
    expect(isTransientRunFailure(new Error('fetch failed'))).toBe(true);
    expect(isTransientRunFailure(new Error('Request timed out after 600000ms'))).toBe(true);
  });

  it('does not retry our own budget cap — the second attempt refuses for the same reason and the wait is wasted', () => {
    const budget = new Error('Budget exceeded for agent "revenue-lead" (monthly: 5100/5000). Raise the cap on /dashboard/agents/revenue-lead or wait for the next period.');

    expect(isTransientRunFailure(budget)).toBe(false);
  });

  it('does not retry a failure nobody here recognises, because an unknown permanent error would double every broken turn', () => {
    expect(isTransientRunFailure(new Error('the agent has no tools configured'))).toBe(false);
    // An error with nothing to say matches no rule, so it is not retried.
    expect(isTransientRunFailure(Object.assign(new Error('x'), { message: '' }))).toBe(false);
    expect(isTransientRunFailure(null)).toBe(false);
    expect(isTransientRunFailure('something went wrong')).toBe(false);
  });
});

describe('statusOf', () => {
  it('reads the status wherever the live provider put it', () => {
    expect(statusOf(providerError(429, 'rate limited'))).toBe(429);
    expect(statusOf(Object.assign(new Error('nope'), { response: { status: 503 } }))).toBe(503);
    // Bedrock — the AWS SDK hides it under the response metadata.
    expect(statusOf(Object.assign(new Error('throttled'), { $metadata: { httpStatusCode: 429 } }))).toBe(429);
  });

  it('is null when the error carries no status at all, which is every dead socket', () => {
    expect(statusOf(new Error('socket hang up'))).toBeNull();
    expect(statusOf(undefined)).toBeNull();
  });
});
