/**
 * Forgot-password against real rows in PGlite, with the mail transport
 * stubbed: the link is single-use, short-lived and hash-only; the answer never
 * says whether an email has a login; the link names the configured address,
 * never the request's, and carries the token in its fragment, never its query;
 * a reset ends every session the person had.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const sendMail = vi.fn(async (_message: { to: string; text?: string }) => ({ skipped: false as const, provider: 'resend' as const, id: 'msg-1' }));
vi.mock('@/libs/mail', () => ({ sendMail: (message: { to: string; text?: string }) => sendMail(message) }));

const { db } = await import('@/libs/DB');
const { hashPassword, verifyPassword } = await import('@/libs/identity/password');
const { hit, RATE_LIMITS, resetMemoryRateLimits } = await import('@/libs/rateLimit');
const { passwordLockout } = await import('./passwordCheck');
const { passwordResetTokenSchema, rateLimitHitSchema, userSchema } = await import('@/models/Schema');
const { requestPasswordReset, resetLinkIsLive, resetPassword } = await import('./passwordReset');

const NOW = new Date('2026-10-07T10:00:15.000Z');
const SAM = { id: 'usr-sam', email: 'sam@northwind.example' };

/** The token in the last mailed link. */
function mailedToken(): string {
  const text = sendMail.mock.calls.at(-1)?.[0]?.text ?? '';
  const match = /reset-password#token=(\S+)/.exec(text);
  if (!match) {
    throw new Error('no link mailed');
  }
  return decodeURIComponent(match[1]!);
}

async function ask(email: string, opts: { ip?: string | null; now?: Date; requestOrigin?: string | null } = {}) {
  const outcome = await requestPasswordReset({ email, ip: opts.ip ?? null, requestOrigin: opts.requestOrigin ?? null, now: opts.now ?? NOW });
  if (outcome.ok) {
    await outcome.delivery;
  }
  return outcome;
}

beforeEach(async () => {
  sendMail.mockClear();
  resetMemoryRateLimits();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.northwind.example/');
  await db.delete(rateLimitHitSchema);
  await db.delete(passwordResetTokenSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values({ ...SAM, name: 'Sam', passwordHash: await hashPassword('old-password') });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('asking for a reset link', () => {
  it('mails a link to the configured address and keeps only the token\'s hash', async () => {
    expect((await ask('Sam@Northwind.example')).ok).toBe(true);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0].to).toBe('sam@northwind.example');
    // In the fragment: a browser never sends it, so no access log or error
    // tracker's request record holds a live link.
    expect(sendMail.mock.calls[0]![0].text).toContain('https://app.northwind.example/reset-password#token=');
    expect(sendMail.mock.calls[0]![0].text).not.toContain('?token=');

    const token = mailedToken();
    const rows = await db.select().from(passwordResetTokenSchema);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.expiresAt.getTime() - NOW.getTime()).toBe(30 * 60_000);
  });

  it('answers an unknown email exactly as a known one, and mails nothing', async () => {
    const known = await requestPasswordReset({ email: SAM.email, ip: null, requestOrigin: null, now: NOW });
    const unknown = await requestPasswordReset({ email: 'nobody@northwind.example', ip: null, requestOrigin: null, now: NOW });

    expect(Object.keys(unknown)).toEqual(Object.keys(known));
    expect(unknown.ok).toBe(true);

    await (unknown.ok && unknown.delivery);
    await (known.ok && known.delivery);

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('never builds the link from the request in production', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('NODE_ENV', 'production');

    await ask(SAM.email, { requestOrigin: 'https://attacker.example' });

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('spends the older link when a newer one is asked for', async () => {
    await ask(SAM.email);
    const first = mailedToken();
    await ask(SAM.email);

    expect(await resetLinkIsLive(first, NOW)).toBe(false);
    expect(await resetLinkIsLive(mailedToken(), NOW)).toBe(true);
  });

  it('allows three requests an hour per email, for every email alike', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await ask(SAM.email)).ok).toBe(true);
      expect((await ask('nobody@northwind.example')).ok).toBe(true);
    }

    expect(await ask(SAM.email)).toMatchObject({ ok: false });
    expect(await ask('nobody@northwind.example')).toMatchObject({ ok: false });
  });

  it('allows ten requests an hour per address', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await ask(`person${i}@northwind.example`, { ip: '198.51.100.4' })).ok).toBe(true);
    }

    expect(await ask('another@northwind.example', { ip: '198.51.100.4' })).toMatchObject({ ok: false });
  });
});

describe('using the link', () => {
  it('sets the new password and works once', async () => {
    await ask(SAM.email);
    const token = mailedToken();

    expect(await resetPassword({ token, password: 'new-password-1', now: NOW })).toEqual({ ok: true, email: SAM.email });

    const [user] = await db.select().from(userSchema).where(eq(userSchema.id, SAM.id));

    expect(await verifyPassword('new-password-1', user!.passwordHash!)).toBe(true);
    expect(await resetPassword({ token, password: 'new-password-2', now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses an expired link', async () => {
    await ask(SAM.email);
    const token = mailedToken();
    const later = new Date(NOW.getTime() + 61 * 60_000);

    expect(await resetLinkIsLive(token, later)).toBe(false);
    expect(await resetPassword({ token, password: 'new-password-1', now: later })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a short password without spending the link', async () => {
    await ask(SAM.email);
    const token = mailedToken();

    expect(await resetPassword({ token, password: 'short', now: NOW })).toEqual({ ok: false, reason: 'weak-password' });
    expect(await resetLinkIsLive(token, NOW)).toBe(true);
  });

  it('refuses a made-up token', async () => {
    expect(await resetPassword({ token: 'not-a-token', password: 'new-password-1', now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('lifts the sign-in lockout on that email, everywhere and from the address that reset it', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerAccount.limit; i++) {
      await hit(RATE_LIMITS.signInFailuresPerAccount, SAM.email);
    }

    expect((await passwordLockout(SAM.email, '198.51.100.4')).allowed).toBe(false);

    await ask(SAM.email, { now: new Date() });

    await resetPassword({ token: mailedToken(), password: 'new-password-1', ip: '198.51.100.4' });

    expect((await passwordLockout(SAM.email, '198.51.100.4')).allowed).toBe(true);
  });

  it('ends every session the person had — someone else using the account is why people reset', async () => {
    await ask(SAM.email, { now: new Date() });

    await resetPassword({ token: mailedToken(), password: 'new-password-1' });

    const [user] = await db.select({ v: userSchema.sessionVersion }).from(userSchema).where(eq(userSchema.id, SAM.id));

    expect(user?.v).toBe(1);
  });
});
