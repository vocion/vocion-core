/**
 * Every way a sign-in comes back to the page says what happened and what to
 * do, in a person's words.
 */
import { describe, expect, it } from 'vitest';
import { signInMessage } from './signInMessages';

describe('signInMessage', () => {
  it('says nothing when nothing went wrong', () => {
    expect(signInMessage({ error: null })).toBeNull();
  });

  it('tells someone with no invite to ask for one', () => {
    expect(signInMessage({ error: 'AccessDenied', reason: 'no-invite', providerLabel: 'Google' })).toBe('No invite for this address. Ask an admin to invite you.');
    expect(signInMessage({ error: 'AccessDenied' })).toBe('No invite for this address. Ask an admin to invite you.');
  });

  it('names the provider that did not vouch for the address', () => {
    expect(signInMessage({ error: 'AccessDenied', reason: 'unverified-email', providerLabel: 'Microsoft' })).toMatch(/^Microsoft didn't confirm an email address/);
  });

  it('asks for a work or school account instead of a personal Microsoft one', () => {
    expect(signInMessage({ error: 'AccessDenied', reason: 'personal-account', providerLabel: 'Microsoft' })).toMatch(/work or school Microsoft account/);
  });

  it('explains a spent or expired link, and how long to wait after too many', () => {
    expect(signInMessage({ error: 'Verification' })).toMatch(/expired or was already used/);
    expect(signInMessage({ error: 'EmailLinkRateLimited', retryAfterSeconds: 61 })).toBe('Too many sign-in links asked for. Try again in 2 minutes.');
    expect(signInMessage({ error: 'EmailLinkRateLimited', retryAfterSeconds: 30 })).toBe('Too many sign-in links asked for. Try again in 1 minute.');
  });

  it('keeps the password answer and has a fallback for anything else', () => {
    expect(signInMessage({ error: 'CredentialsSignin' })).toBe('Invalid email or password.');
    expect(signInMessage({ error: 'Configuration' })).toBe('Sign-in didn\'t finish. Try again.');
  });
});
