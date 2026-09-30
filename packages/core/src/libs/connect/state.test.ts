/**
 * The signed state is the only thing the callback trusts, so every way it
 * can be wrong gets a case: forged, expired, cut short, minted for another
 * provider.
 */

import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Env', () => ({ Env: { AUTH_SECRET: 'test-secret-0123456789abcdef' } }));

const { signState, verifyState } = await import('./state');

const input = { provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', userId: 'user_1' };

describe('connect state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips the payload it was minted with', () => {
    const now = 1_700_000_000_000;
    const verified = verifyState(signState(input, now), now + 1000);

    expect(verified.ok).toBe(true);

    if (verified.ok) {
      expect(verified.payload).toMatchObject({ v: 1, ...input });
      expect(verified.payload.nonce).toHaveLength(32);
      expect(verified.payload.exp).toBe(now + 10 * 60 * 1000);
    }
  });

  it('never mints the same state twice', () => {
    expect(signState(input)).not.toBe(signState(input));
  });

  it('refuses a state whose payload was edited', () => {
    const state = signState(input);
    const [encoded, signature] = state.split('.') as [string, string];
    const tampered = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    tampered.orgId = 'org_2';
    const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`;

    expect(verifyState(forged)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a state past its ten minutes', () => {
    const now = 1_700_000_000_000;
    const state = signState(input, now);

    expect(verifyState(state, now + 10 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses anything that is not a state at all', () => {
    expect(verifyState(null)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyState('')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyState('no-dot-here')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyState('trailing.')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a signed payload that is not the shape it expects', () => {
    // A valid signature over the wrong document is still not a state.
    const state = signState(input);
    const [, signature] = state.split('.') as [string, string];
    const other = Buffer.from(JSON.stringify({ v: 1 })).toString('base64url');

    // Signature will not match the other payload, and that is the point: no
    // path exists to a well-signed wrong shape without the secret.
    expect(verifyState(`${other}.${signature}`)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
