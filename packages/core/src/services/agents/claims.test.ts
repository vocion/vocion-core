/**
 * TenantClaim signing/verification — the trust anchor for the BYOA
 * transport seam. If these fail, nothing else about the runtime
 * architecture is safe to ship.
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { signClaim, verifyClaim } from './claims';

beforeEach(() => {
  process.env.VOCION_TOOL_SIGNING_SECRET = 'test-secret-for-claims';
});

describe('signClaim / verifyClaim', () => {
  it('round-trips a full claim', () => {
    const token = signClaim({
      orgId: 'org_a',
      agentSlug: 'helper',
      userId: 'usr-1',
      allowedSourceSlugs: ['gmail', 'drive'],
      missionSlug: 'weekly-brief',
    });
    const result = verifyClaim(token);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.claim.orgId).toBe('org_a');
      expect(result.claim.agentSlug).toBe('helper');
      expect(result.claim.userId).toBe('usr-1');
      expect(result.claim.allowedSourceSlugs).toEqual(['gmail', 'drive']);
      expect(result.claim.missionSlug).toBe('weekly-brief');
      expect(result.claim.exp).toBeGreaterThan(Date.now());
    }
  });

  it('rejects an expired claim', () => {
    const token = signClaim({ orgId: 'org_a', agentSlug: 'helper', exp: Date.now() - 1000 });

    expect(verifyClaim(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a tampered payload (org swap)', () => {
    const token = signClaim({ orgId: 'org_a', agentSlug: 'helper' });
    const [body, sig] = token.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.orgId = 'org_b';
    const forgedBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(verifyClaim(`${forgedBody}.${sig}`)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a claim signed with a different secret', () => {
    const token = signClaim({ orgId: 'org_a', agentSlug: 'helper' });
    process.env.VOCION_TOOL_SIGNING_SECRET = 'rotated-secret';

    expect(verifyClaim(token)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed tokens', () => {
    expect(verifyClaim('')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyClaim('no-dot-here')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyClaim('a.b.c').ok).toBe(false);
    expect(verifyClaim(`${Buffer.from('"not an object"').toString('base64url')}.AAAA`).ok).toBe(false);
  });
});
