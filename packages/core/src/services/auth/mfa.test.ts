/**
 * Two-step sign-in, against real rows in PGlite and the local credential
 * vault: enrolment, the first code turning it on, codes and recovery codes at
 * sign-in (each spendable once), the lockout, and who is required to have it.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { totpCode, totpStep } from '@/libs/identity/totp';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { resetMemoryRateLimits } = await import('@/libs/rateLimit');
const schema = await import('@/models/Schema');
const mfa = await import('./mfa');

const NOW = new Date('2026-10-07T10:00:15.000Z');
const VAULT_KEY = randomBytes(32).toString('base64');
const SAM = 'usr-sam';

/**
 * Enrol Sam and turn it on, returning the secret and the recovery codes.
 * @param now - When the first code is typed.
 */
async function enrolSam(now = NOW) {
  const started = await mfa.beginEnrollment(SAM);
  if ('error' in started) {
    throw new Error(started.error);
  }
  const confirmed = await mfa.confirmEnrollment(SAM, totpCode(started.secret, totpStep(now)), now);
  if (!confirmed.ok) {
    throw new Error(confirmed.reason);
  }
  return { secret: started.secret, recoveryCodes: confirmed.recoveryCodes };
}

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', VAULT_KEY);
  resetCredentialVault();
});

beforeEach(async () => {
  resetMemoryRateLimits();
  await db.delete(schema.rateLimitHitSchema);
  await db.delete(schema.userMfaRecoveryCodeSchema);
  await db.delete(schema.userMfaSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.userSchema).values({ id: SAM, email: 'sam@northwind.example', name: 'Sam' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', VAULT_KEY);
});

describe('setting up an authenticator', () => {
  it('stores the secret encrypted and hands back the QR code that carries it', async () => {
    const started = await mfa.beginEnrollment(SAM);
    if ('error' in started) {
      throw new Error(started.error);
    }

    expect(started.qrSvg.startsWith('<svg')).toBe(true);
    expect(started.otpauthUri).toContain('sam%40northwind.example');

    const [row] = await db.select().from(schema.userMfaSchema).where(eq(schema.userMfaSchema.userId, SAM));

    expect(row?.enabledAt).toBeNull();
    expect(row?.ciphertext).not.toContain(started.secret);
    // Not on until the first code proves the app reads it.
    expect(await mfa.signInGateFor(SAM)).toBeNull();
  });

  it('turns on with the first right code and mints ten recovery codes', async () => {
    const started = await mfa.beginEnrollment(SAM);
    if ('error' in started) {
      throw new Error(started.error);
    }

    expect(await mfa.confirmEnrollment(SAM, '000000', NOW)).toEqual({ ok: false, reason: 'invalid' });

    const confirmed = await mfa.confirmEnrollment(SAM, totpCode(started.secret, totpStep(NOW)), NOW);

    expect(confirmed.ok).toBe(true);
    expect(confirmed.ok && confirmed.recoveryCodes).toHaveLength(10);
    expect(await mfa.signInGateFor(SAM)).toBe('verify');
    expect(await mfa.mfaStatus(SAM)).toMatchObject({ enabled: true, recoveryCodesLeft: 10, requiredBy: null });
  });

  it('will not replace an authenticator that is on — a password alone must not swap it', async () => {
    await enrolSam();

    expect(await mfa.beginEnrollment(SAM)).toEqual({ error: 'already-enabled' });
  });

  it('restarting setup replaces only the unconfirmed secret', async () => {
    const first = await mfa.beginEnrollment(SAM);
    const second = await mfa.beginEnrollment(SAM);
    if ('error' in first || 'error' in second) {
      throw new Error('setup refused');
    }

    expect(await mfa.confirmEnrollment(SAM, totpCode(first.secret, totpStep(NOW)), NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect((await mfa.confirmEnrollment(SAM, totpCode(second.secret, totpStep(NOW)), NOW)).ok).toBe(true);
  });
});

describe('the second factor at sign-in', () => {
  it('accepts the app\'s code once — the same code is refused inside its own window', async () => {
    const { secret } = await enrolSam(NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const code = totpCode(secret, totpStep(later));

    expect(await mfa.verifySecondFactor(SAM, code, later)).toBe('totp');
    expect(await mfa.verifySecondFactor(SAM, code, later)).toBeNull();
  });

  it('refuses the code that turned it on (already spent at enrolment)', async () => {
    const { secret } = await enrolSam(NOW);

    expect(await mfa.verifySecondFactor(SAM, totpCode(secret, totpStep(NOW)), NOW)).toBeNull();
  });

  it('accepts each recovery code once, however it is typed', async () => {
    const { recoveryCodes } = await enrolSam();
    const code = recoveryCodes[0]!;

    expect(await mfa.verifySecondFactor(SAM, ` ${code.toUpperCase().replace('-', ' ')} `, NOW)).toBe('recovery');
    expect(await mfa.verifySecondFactor(SAM, code, NOW)).toBeNull();
    expect((await mfa.mfaStatus(SAM)).recoveryCodesLeft).toBe(9);
  });

  it('locks the second factor after five wrong codes, even against the right one', async () => {
    const { secret } = await enrolSam(NOW);
    const later = new Date(NOW.getTime() + 60_000);

    for (let i = 0; i < 5; i++) {
      expect(await mfa.checkSecondFactor(SAM, '000000', { ip: '198.51.100.4', now: later })).toEqual({ ok: false, reason: 'invalid' });
    }
    const locked = await mfa.checkSecondFactor(SAM, totpCode(secret, totpStep(later)), { ip: '198.51.100.4', now: later });

    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('clears the failures when a right code arrives before the lockout', async () => {
    const { secret } = await enrolSam(NOW);
    const later = new Date(NOW.getTime() + 60_000);
    for (let i = 0; i < 4; i++) {
      await mfa.checkSecondFactor(SAM, '000000', { ip: null, now: later });
    }

    expect(await mfa.checkSecondFactor(SAM, totpCode(secret, totpStep(later)), { ip: null, now: later })).toEqual({ ok: true, method: 'totp' });
    expect(await mfa.checkSecondFactor(SAM, '000000', { ip: null, now: later })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('who must have it', () => {
  it('owes nothing when nothing requires it and none is set up', async () => {
    expect(await mfa.signInGateFor(SAM)).toBeNull();
  });

  it('sends everyone to enrol when the deployment requires it', async () => {
    vi.stubEnv('VOCION_REQUIRE_MFA', '1');

    expect(await mfa.signInGateFor(SAM)).toBe('enroll');
    expect(await mfa.mfaRequirementFor(SAM)).toBe('deployment');
  });

  it('sends an account\'s members to enrol when that account requires it, and no one else', async () => {
    await db.insert(schema.userSchema).values({ id: 'usr-kim', email: 'kim@kestrel.example', name: 'Kim' });
    await db.insert(schema.tenantAccountSchema).values([
      { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
      { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel' },
    ]);
    await db.insert(schema.accountMembershipSchema).values([
      { accountId: 'acct-northwind', userId: SAM, role: 'member' },
      { accountId: 'acct-kestrel', userId: 'usr-kim', role: 'admin' },
    ]);

    await mfa.setAccountMfaRequirement('acct-northwind', true);

    expect(await mfa.accountRequiresMfa('acct-northwind')).toBe(true);
    expect(await mfa.signInGateFor(SAM)).toBe('enroll');
    expect(await mfa.signInGateFor('usr-kim')).toBeNull();
  });

  it('will not turn it off while it is required', async () => {
    await enrolSam();
    vi.stubEnv('VOCION_REQUIRE_MFA', '1');

    expect(await mfa.disableMfa(SAM)).toEqual({ ok: false, reason: 'required', requiredBy: 'deployment' });
    expect(await mfa.signInGateFor(SAM)).toBe('verify');
  });

  it('turns it off, codes and all, when nothing requires it', async () => {
    await enrolSam();

    expect(await mfa.disableMfa(SAM)).toEqual({ ok: true });
    expect(await mfa.signInGateFor(SAM)).toBeNull();
    expect(await db.select().from(schema.userMfaRecoveryCodeSchema)).toHaveLength(0);
  });

  it('replaces every recovery code when new ones are minted', async () => {
    const { recoveryCodes } = await enrolSam();
    const fresh = await mfa.regenerateRecoveryCodes(SAM);

    expect(fresh).toHaveLength(10);
    expect(await mfa.verifySecondFactor(SAM, recoveryCodes[0]!, NOW)).toBeNull();
    expect(await mfa.verifySecondFactor(SAM, fresh![0]!, NOW)).toBe('recovery');
  });
});
