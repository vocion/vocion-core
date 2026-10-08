/**
 * Every way a sign-in comes back to the page says what happened and what to
 * do, in a person's words — in English and in French.
 */
import type { SignInOutcome } from './signInMessages';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import { signInMessage } from './signInMessages';

const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'SignIn' });
const tFr = createTranslator({ locale: 'fr', messages: fr, namespace: 'SignIn' });

function say(outcome: SignInOutcome, t = tEn): string | null {
  const message = signInMessage(outcome);
  return message ? t(message.key, message.values) : null;
}

describe('signInMessage', () => {
  it('says nothing when nothing went wrong', () => {
    expect(signInMessage({ error: null })).toBeNull();
  });

  it('tells someone with no invite to ask for one', () => {
    expect(say({ error: 'AccessDenied', reason: 'no-invite', providerLabel: 'Google' })).toBe('No invite for this address. Ask an admin to invite you.');
    expect(say({ error: 'AccessDenied' })).toBe('No invite for this address. Ask an admin to invite you.');
  });

  it('names the provider that did not vouch for the address', () => {
    expect(say({ error: 'AccessDenied', reason: 'unverified-email', providerLabel: 'Microsoft' })).toMatch(/^Microsoft didn't confirm an email address/);
  });

  it('asks for a work or school account instead of a personal Microsoft one', () => {
    expect(say({ error: 'AccessDenied', reason: 'personal-account', providerLabel: 'Microsoft' })).toMatch(/work or school Microsoft account/);
  });

  it('explains a spent or expired link, and how long to wait after too many', () => {
    expect(say({ error: 'Verification' })).toMatch(/expired or was already used/);
    expect(say({ error: 'EmailLinkRateLimited', retryAfterSeconds: 61 })).toBe('Too many sign-in links asked for. Try again in 2 minutes.');
    expect(say({ error: 'EmailLinkRateLimited', retryAfterSeconds: 30 })).toBe('Too many sign-in links asked for. Try again in 1 minute.');
  });

  it('keeps the password answer, says to wait after a lockout, and has a fallback for anything else', () => {
    expect(say({ error: 'CredentialsSignin' })).toBe('Invalid email or password.');
    expect(say({ error: 'CredentialsSignin', code: 'rate_limited' })).toMatch(/^Too many sign-in attempts/);
    expect(say({ error: 'Configuration' })).toBe('Sign-in didn\'t finish. Try again.');
  });

  it('has every sentence in French too', () => {
    const outcomes: SignInOutcome[] = [
      { error: 'CredentialsSignin' },
      { error: 'CredentialsSignin', code: 'rate_limited' },
      { error: 'Verification' },
      { error: 'EmailLinkRateLimited', retryAfterSeconds: 120 },
      { error: 'OAuthAccountNotLinked', providerLabel: 'Google' },
      { error: 'AccessDenied', reason: 'unverified-email', providerLabel: 'Google' },
      { error: 'AccessDenied', reason: 'personal-account' },
      { error: 'AccessDenied', reason: 'untrusted-issuer', providerLabel: 'Microsoft' },
      { error: 'AccessDenied', reason: 'invite-failed' },
      { error: 'AccessDenied', reason: 'no-invite' },
      { error: 'Configuration' },
    ];
    for (const outcome of outcomes) {
      const french = say(outcome, tFr);

      expect(french).toBeTruthy();
      expect(french).not.toBe(say(outcome, tEn));
    }
  });
});
