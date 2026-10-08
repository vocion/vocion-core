/**
 * The invite-only decision for Google, Microsoft and email-link sign-in:
 * sign in the linked person, link a verified address to its login, accept a
 * pending invite, refuse everyone else. Pure, so every branch is pinned here.
 */
import type { InviteFact, SignInFacts } from './signInDecision';
import { describe, expect, it } from 'vitest';
import { decideSignIn, mayEmailSignInLink, usableInvites } from './signInDecision';

const NOW = new Date('2026-10-08T12:00:00Z');
const NEXT_WEEK = new Date('2026-10-15T12:00:00Z');
const LAST_WEEK = new Date('2026-10-01T12:00:00Z');

function invite(over: Partial<InviteFact> = {}): InviteFact {
  return { token: 'tok-northwind', email: 'dana@northwind.example', acceptedAt: null, expiresAt: NEXT_WEEK, ...over };
}

function facts(over: Partial<SignInFacts> = {}): SignInFacts {
  return {
    method: 'oauth',
    identity: { ok: true, email: 'dana@northwind.example' },
    linkedUserId: null,
    userIdByEmail: null,
    invites: [],
    now: NOW,
    ...over,
  };
}

describe('decideSignIn', () => {
  it('signs in the login a provider account is already linked to', () => {
    expect(decideSignIn(facts({ linkedUserId: 'usr-dana' }))).toEqual({ kind: 'sign-in', userId: 'usr-dana' });
  });

  it('keeps an existing link even when today\'s token carries no verified address', () => {
    expect(decideSignIn(facts({ linkedUserId: 'usr-dana', identity: { ok: false, reason: 'unverified-email' } })))
      .toEqual({ kind: 'sign-in', userId: 'usr-dana' });
  });

  it('links a provider to the login with the verified address', () => {
    expect(decideSignIn(facts({ userIdByEmail: 'usr-dana' }))).toEqual({ kind: 'link', userId: 'usr-dana' });
  });

  it('signs in by email link without linking anything', () => {
    expect(decideSignIn(facts({ method: 'email-link', userIdByEmail: 'usr-dana' }))).toEqual({ kind: 'sign-in', userId: 'usr-dana' });
  });

  it('accepts a pending, unexpired invite for an address with no login', () => {
    expect(decideSignIn(facts({ invites: [invite()] })))
      .toEqual({ kind: 'accept-invite', email: 'dana@northwind.example', inviteTokens: ['tok-northwind'] });
  });

  it('accepts every usable invite, soonest to expire first', () => {
    const decision = decideSignIn(facts({
      invites: [
        invite({ token: 'tok-kestrel', expiresAt: new Date('2026-10-20T00:00:00Z') }),
        invite({ token: 'tok-northwind', expiresAt: new Date('2026-10-10T00:00:00Z') }),
        invite({ token: 'tok-used', acceptedAt: LAST_WEEK }),
      ],
    }));

    expect(decision).toEqual({ kind: 'accept-invite', email: 'dana@northwind.example', inviteTokens: ['tok-northwind', 'tok-kestrel'] });
  });

  it('refuses an address with no login and no usable invite', () => {
    const refused = { kind: 'refuse', reason: 'no-invite' };

    expect(decideSignIn(facts())).toEqual(refused);
    expect(decideSignIn(facts({ invites: [invite({ expiresAt: LAST_WEEK })] }))).toEqual(refused);
    expect(decideSignIn(facts({ invites: [invite({ acceptedAt: LAST_WEEK })] }))).toEqual(refused);
    expect(decideSignIn(facts({ invites: [invite({ email: 'someone-else@northwind.example' })] }))).toEqual(refused);
  });

  it('never links or accepts on an address the provider did not vouch for — no takeover by unverified email', () => {
    const unverified = facts({ identity: { ok: false, reason: 'unverified-email' }, userIdByEmail: 'usr-dana', invites: [invite()] });

    expect(decideSignIn(unverified)).toEqual({ kind: 'refuse', reason: 'unverified-email' });
    expect(decideSignIn({ ...unverified, identity: { ok: false, reason: 'personal-account' } })).toEqual({ kind: 'refuse', reason: 'personal-account' });
  });

  it('does not honour a stale link for an email link (there are none)', () => {
    expect(decideSignIn(facts({ method: 'email-link', linkedUserId: 'usr-other' }))).toEqual({ kind: 'refuse', reason: 'no-invite' });
  });
});

describe('usableInvites', () => {
  it('matches the address case-insensitively, as the invite form does', () => {
    expect(usableInvites([invite({ email: 'Dana@Northwind.example' })], 'dana@northwind.example', NOW)).toHaveLength(1);
  });
});

describe('mayEmailSignInLink', () => {
  it('sends to a login or a usable invite, and to nobody else', () => {
    expect(mayEmailSignInLink({ email: 'dana@northwind.example', userIdByEmail: 'usr-dana', invites: [], now: NOW })).toBe(true);
    expect(mayEmailSignInLink({ email: 'dana@northwind.example', userIdByEmail: null, invites: [invite()], now: NOW })).toBe(true);
    expect(mayEmailSignInLink({ email: 'dana@northwind.example', userIdByEmail: null, invites: [invite({ expiresAt: LAST_WEEK })], now: NOW })).toBe(false);
    expect(mayEmailSignInLink({ email: 'dana@northwind.example', userIdByEmail: null, invites: [], now: NOW })).toBe(false);
  });
});
