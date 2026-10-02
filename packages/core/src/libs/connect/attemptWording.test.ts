/**
 * How a failed connect attempt reads to a person, with its date (#1080).
 * The date is the business rule: a time of day alone is how a stale failure
 * gets mistaken for today's.
 */
import { describe, expect, it } from 'vitest';
import { connectFailureSummary, describeLastAttempt } from './attemptWording';

describe('connectFailureSummary', () => {
  it.each([
    ['access_denied', 'GitHub denied access'],
    ['cancelled', 'The GitHub login was cancelled'],
    ['state_expired', 'The login took longer than 10 minutes'],
    ['not_admin', 'Only a workspace admin can connect GitHub'],
    ['wrong_person', 'The login was started by someone else or in another workspace'],
    ['wrong_workspace', 'The login was started by someone else or in another workspace'],
    ['store_failed', 'GitHub logged in, but the credential couldn\'t be saved'],
    ['provider_unreachable', 'GitHub could not be reached, so nothing was connected'],
    ['token_step_failed:refresh token', 'GitHub logged in, but refresh token is still missing'],
    ['server_error', 'GitHub refused the login (server_error)'],
  ])('%s', (reason, expected) => {
    expect(connectFailureSummary('GitHub', reason)).toBe(expected);
  });

  it('a missing reason still names the provider', () => {
    expect(connectFailureSummary('GitHub', null)).toBe('GitHub refused the login');
  });
});

describe('describeLastAttempt', () => {
  const summary = connectFailureSummary('GitHub', 'access_denied');
  const at = new Date('2026-10-01T16:12:00Z');

  it('states the date and the time', () => {
    expect(describeLastAttempt({ at, summary }, 'UTC')).toBe('Last attempt Oct 1, 4:12 PM: GitHub denied access');
  });

  it('reads in the given time zone', () => {
    expect(describeLastAttempt({ at, summary }, 'America/New_York')).toBe('Last attempt Oct 1, 12:12 PM: GitHub denied access');
  });

  it('accepts the ISO string a card run stores', () => {
    expect(describeLastAttempt({ at: at.toISOString(), summary }, 'UTC')).toBe('Last attempt Oct 1, 4:12 PM: GitHub denied access');
  });
});
