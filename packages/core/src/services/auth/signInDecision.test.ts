/**
 * The invite-only decision for Google, Microsoft and email-link sign-in:
 * sign in the linked person, link a verified address to its login, accept
 * pending invites (every Org on multi-Org, the one allowed Org on
 * single-Org), join an operator's auto-join domain, refuse everyone else.
 * Pure, so every branch is pinned here.
 */
import type { InviteFact, OrgFacts, SignInFacts } from './signInDecision';
import { describe, expect, it } from 'vitest';
import { autoJoinDomain, decideSignIn, invitesToJoin, mayEmailSignInLink, usableInvites } from './signInDecision';

const NOW = new Date('2026-10-08T12:00:00Z');
const NEXT_WEEK = new Date('2026-10-15T12:00:00Z');
const LAST_WEEK = new Date('2026-10-01T12:00:00Z');

const SINGLE: OrgFacts = { mode: 'single', memberOf: [], autoJoin: null };
const MULTI: OrgFacts = { mode: 'multi', memberOf: [], autoJoin: null };

function invite(over: Partial<InviteFact> = {}): InviteFact {
  return { token: 'tok-northwind', accountId: 'acct-northwind', email: 'dana@northwind.example', acceptedAt: null, expiresAt: NEXT_WEEK, ...over };
}

function facts(over: Partial<SignInFacts> = {}): SignInFacts {
  return {
    method: 'oauth',
    identity: { ok: true, email: 'dana@northwind.example' },
    linkedUserId: null,
    userIdByEmail: null,
    invites: [],
    orgs: MULTI,
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

  it('on a multi-Org server, accepts every usable invite, soonest to expire first', () => {
    const decision = decideSignIn(facts({
      invites: [
        invite({ token: 'tok-kestrel', accountId: 'acct-kestrel', expiresAt: new Date('2026-10-20T00:00:00Z') }),
        invite({ token: 'tok-northwind', expiresAt: new Date('2026-10-10T00:00:00Z') }),
        invite({ token: 'tok-used', accountId: 'acct-contoso', acceptedAt: LAST_WEEK }),
      ],
    }));

    expect(decision).toEqual({ kind: 'accept-invite', email: 'dana@northwind.example', inviteTokens: ['tok-northwind', 'tok-kestrel'] });
  });

  it('on a single-Org server, accepts only the one Org this install allows', () => {
    const decision = decideSignIn(facts({
      orgs: SINGLE,
      invites: [
        invite({ token: 'tok-kestrel', accountId: 'acct-kestrel', expiresAt: new Date('2026-10-20T00:00:00Z') }),
        invite({ token: 'tok-northwind', expiresAt: new Date('2026-10-10T00:00:00Z') }),
      ],
    }));

    expect(decision).toEqual({ kind: 'accept-invite', email: 'dana@northwind.example', inviteTokens: ['tok-northwind'] });
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

describe('decideSignIn — auto-join domains', () => {
  const POLICY = { domains: ['northwind.example'], accountId: 'acct-northwind' };

  it('makes a login in the install\'s Org for a verified address in a listed domain, on a single-Org install', () => {
    expect(decideSignIn(facts({ orgs: { ...SINGLE, autoJoin: POLICY } })))
      .toEqual({ kind: 'auto-join', email: 'dana@northwind.example', accountId: 'acct-northwind', domain: 'northwind.example' });
    expect(decideSignIn(facts({ method: 'email-link', orgs: { ...SINGLE, autoJoin: POLICY } })))
      .toMatchObject({ kind: 'auto-join' });
  });

  it('prefers an invite, whose role an admin chose, over the domain', () => {
    expect(decideSignIn(facts({ orgs: { ...SINGLE, autoJoin: POLICY }, invites: [invite()] })))
      .toMatchObject({ kind: 'accept-invite' });
  });

  it('never joins by domain on a multi-Org server, an unlisted domain, or an unverified address', () => {
    expect(decideSignIn(facts({ orgs: { ...MULTI, autoJoin: POLICY } }))).toEqual({ kind: 'refuse', reason: 'no-invite' });
    expect(decideSignIn(facts({ orgs: { ...SINGLE, autoJoin: POLICY }, identity: { ok: true, email: 'dana@kestrel.example' } })))
      .toEqual({ kind: 'refuse', reason: 'no-invite' });
    expect(decideSignIn(facts({ orgs: { ...SINGLE, autoJoin: POLICY }, identity: { ok: false, reason: 'unverified-email' } })))
      .toEqual({ kind: 'refuse', reason: 'unverified-email' });
  });

  it('matches the domain exactly — no subdomain, no look-alike', () => {
    const orgs = { mode: 'single' as const, autoJoin: POLICY };

    expect(autoJoinDomain('dana@NORTHWIND.example', orgs)).toBe('northwind.example');
    expect(autoJoinDomain('dana@mail.northwind.example', orgs)).toBeNull();
    expect(autoJoinDomain('dana@evilnorthwind.example', orgs)).toBeNull();
    expect(autoJoinDomain('northwind.example', orgs)).toBeNull();
  });

  it('leaves an address that already has a login to sign in, never to join by domain', () => {
    expect(decideSignIn(facts({ userIdByEmail: 'usr-dana', orgs: { ...SINGLE, autoJoin: POLICY } }))).toEqual({ kind: 'link', userId: 'usr-dana' });
  });
});

describe('invitesToJoin — the one rule for joining, at a first sign-in and every sign-in after', () => {
  const kestrel = invite({ token: 'tok-kestrel', accountId: 'acct-kestrel', expiresAt: new Date('2026-10-20T00:00:00Z') });
  const northwind = invite({ token: 'tok-northwind', expiresAt: new Date('2026-10-10T00:00:00Z') });

  it('multi-Org: every Org that asked, except the ones the person is already in', () => {
    expect(invitesToJoin([kestrel, northwind], 'dana@northwind.example', NOW, { mode: 'multi', memberOf: [] }).map(i => i.token)).toEqual(['tok-northwind', 'tok-kestrel']);
    expect(invitesToJoin([kestrel, northwind], 'dana@northwind.example', NOW, { mode: 'multi', memberOf: ['acct-northwind'] }).map(i => i.token)).toEqual(['tok-kestrel']);
  });

  it('single-Org: only the Org the person is already in — so an existing member joins nothing new', () => {
    expect(invitesToJoin([kestrel, northwind], 'dana@northwind.example', NOW, { mode: 'single', memberOf: ['acct-northwind'] })).toEqual([]);
    expect(invitesToJoin([kestrel], 'dana@northwind.example', NOW, { mode: 'single', memberOf: ['acct-northwind'] })).toEqual([]);
  });

  it('single-Org: someone in no Org yet joins the Org of the invite that expires first, once', () => {
    const twice = invite({ token: 'tok-northwind-2', expiresAt: new Date('2026-10-12T00:00:00Z') });

    expect(invitesToJoin([kestrel, northwind, twice], 'dana@northwind.example', NOW, { mode: 'single', memberOf: [] }).map(i => i.token)).toEqual(['tok-northwind']);
  });

  it('never an expired, used or someone else\'s invite', () => {
    const refused = [
      invite({ expiresAt: LAST_WEEK }),
      invite({ acceptedAt: LAST_WEEK }),
      invite({ email: 'sam@northwind.example' }),
    ];

    expect(invitesToJoin(refused, 'dana@northwind.example', NOW, { mode: 'multi', memberOf: [] })).toEqual([]);
  });
});

describe('usableInvites', () => {
  it('matches the address case-insensitively, as the invite form does', () => {
    expect(usableInvites([invite({ email: 'Dana@Northwind.example' })], 'dana@northwind.example', NOW)).toHaveLength(1);
  });
});

describe('mayEmailSignInLink', () => {
  it('sends to a login, a usable invite or an auto-join domain, and to nobody else', () => {
    const base = { email: 'dana@northwind.example', orgs: SINGLE, now: NOW };

    expect(mayEmailSignInLink({ ...base, userIdByEmail: 'usr-dana', invites: [] })).toBe(true);
    expect(mayEmailSignInLink({ ...base, userIdByEmail: null, invites: [invite()] })).toBe(true);
    expect(mayEmailSignInLink({ ...base, userIdByEmail: null, invites: [invite({ expiresAt: LAST_WEEK })] })).toBe(false);
    expect(mayEmailSignInLink({ ...base, userIdByEmail: null, invites: [] })).toBe(false);
    expect(mayEmailSignInLink({ ...base, userIdByEmail: null, invites: [], orgs: { ...SINGLE, autoJoin: { domains: ['northwind.example'], accountId: 'acct-northwind' } } })).toBe(true);
  });
});
